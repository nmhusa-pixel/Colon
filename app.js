const storageKey = "prep-companion-v1";
const suflaveTemplateId = "green-mountain-suflave-2025";
const miralaxTemplateId = "green-mountain-miralax-2023";
const nulytelyTemplateId = "green-mountain-nulytely-2022";
const suprepTemplateId = "green-mountain-suprep-2022";
const maxTimerDelay = 12 * 60 * 60 * 1000;
const prepTemplates = {
  suflave: {
    id: suflaveTemplateId,
    label: "SUFLAVE split-dose prep",
    builder: buildSuflaveTemplate,
    loadedMessage: "Green Mountain SUFLAVE schedule loaded."
  },
  miralax: {
    id: miralaxTemplateId,
    label: "MiraLAX / PEG-3350 prep",
    builder: buildMiralaxTemplate,
    loadedMessage: "Green Mountain MiraLAX schedule loaded."
  },
  nulytely: {
    id: nulytelyTemplateId,
    label: "Nulytely prep",
    builder: buildNulytelyTemplate,
    loadedMessage: "Green Mountain Nulytely schedule loaded."
  },
  suprep: {
    id: suprepTemplateId,
    label: "Suprep prep",
    builder: buildSuprepTemplate,
    loadedMessage: "Green Mountain Suprep schedule loaded."
  }
};

const state = {
  procedureTime: "",
  arrivalTime: "",
  templateId: suflaveTemplateId,
  prepType: "suflave",
  repeatMinutes: 10,
  voiceName: "",
  alarmsEnabled: true,
  voiceEnabled: false,
  showFullSchedule: false,
  steps: [],
  spoken: {},
  timers: new Map(),
  audioContext: null,
  wakeLock: null
};

const els = {
  procedureTime: document.querySelector("#procedureTime"),
  arrivalTime: document.querySelector("#arrivalTime"),
  prepSelect: document.querySelector("#prepSelect"),
  voiceSelect: document.querySelector("#voiceSelect"),
  repeatSelect: document.querySelector("#repeatSelect"),
  enableAlarms: document.querySelector("#enableAlarms"),
  resetSchedule: document.querySelector("#resetSchedule"),
  exportCalendar: document.querySelector("#exportCalendar"),
  testAlarm: document.querySelector("#testAlarm"),
  printPlan: document.querySelector("#printPlan"),
  saveStatus: document.querySelector("#saveStatus"),
  nextTitle: document.querySelector("#nextTitle"),
  nextDetail: document.querySelector("#nextDetail"),
  countdown: document.querySelector("#countdown"),
  timeline: document.querySelector("#timeline"),
  timelineTitle: document.querySelector("#timelineTitle"),
  timelineHint: document.querySelector("#timelineHint"),
  toggleFullSchedule: document.querySelector("#toggleFullSchedule"),
  addStep: document.querySelector("#addStep"),
  stepDialog: document.querySelector("#stepDialog"),
  dialogTitle: document.querySelector("#dialogTitle"),
  editingId: document.querySelector("#editingId"),
  stepTitle: document.querySelector("#stepTitle"),
  stepMessage: document.querySelector("#stepMessage"),
  stepTime: document.querySelector("#stepTime"),
  saveStep: document.querySelector("#saveStep"),
  deleteStep: document.querySelector("#deleteStep"),
  toast: document.querySelector("#toast")
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toInputValue(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "T" + [pad(date.getHours()), pad(date.getMinutes())].join(":");
}

function fromInputValue(value) {
  return value ? new Date(value) : null;
}

function formatDateTime(value) {
  const date = fromInputValue(value);
  if (!date || Number.isNaN(date.getTime())) return "No time set";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function deviceType() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchMac = platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || touchMac) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function calendarButtonText() {
  const type = deviceType();
  if (type === "ios") return "Add to iPhone Calendar";
  if (type === "android") return "Add to Android Calendar";
  return "Download calendar file";
}

function timeFromRule(procedureDate, rule) {
  if (!rule) return null;
  if (rule.type === "offset") return toInputValue(addMinutes(procedureDate, rule.minutes));
  if (rule.type === "dayBefore") {
    const date = new Date(procedureDate);
    date.setDate(date.getDate() - rule.days);
    date.setHours(rule.hour, rule.minute, 0, 0);
    return toInputValue(date);
  }
  return null;
}

function save() {
  localStorage.setItem(storageKey, JSON.stringify({
    procedureTime: state.procedureTime,
    arrivalTime: state.arrivalTime,
    templateId: state.templateId,
    prepType: state.prepType,
    repeatMinutes: state.repeatMinutes,
    voiceName: state.voiceName,
    alarmsEnabled: state.alarmsEnabled,
    voiceEnabled: state.voiceEnabled,
    steps: state.steps,
    spoken: state.spoken
  }));
  els.saveStatus.textContent = "Saved locally";
}

function load() {
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      Object.assign(state, JSON.parse(stored));
      state.alarmsEnabled = true;
      state.steps = state.steps.filter(step => step.title !== "Leave for appointment");
      state.prepType = resolvePrepType(state.prepType, state.templateId, state.steps);
      const template = prepTemplates[state.prepType];
      const hasOldTemplate = state.templateId !== template.id;
      if (hasOldTemplate) {
        const procedureDate = fromInputValue(state.procedureTime) || defaultProcedureDate();
        applyPrepTemplate(state.prepType, procedureDate);
      }
      return;
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  const procedureDate = defaultProcedureDate();
  applyPrepTemplate("suflave", procedureDate);
}

function resolvePrepType(prepType, templateId, steps) {
  if (prepTemplates[prepType]) return prepType;
  if (templateId === miralaxTemplateId) return "miralax";
  if (templateId === nulytelyTemplateId) return "nulytely";
  if (templateId === suprepTemplateId) return "suprep";
  if (templateId === suflaveTemplateId) return "suflave";
  if (steps.some(step => /suprep/i.test(`${step.title} ${step.message}`))) return "suprep";
  if (steps.some(step => /nulytely/i.test(`${step.title} ${step.message}`))) return "nulytely";
  if (steps.some(step => /miralax|peg-3350|bisacodyl|dulcolax|polyethylene glycol/i.test(`${step.title} ${step.message}`))) {
    return "miralax";
  }
  return "suflave";
}

function applyPrepTemplate(prepType, procedureDate) {
  const template = prepTemplates[prepType] || prepTemplates.suflave;
  state.prepType = prepType;
  state.templateId = template.id;
  state.procedureTime = toInputValue(procedureDate);
  state.arrivalTime = toInputValue(addMinutes(procedureDate, -45));
  state.steps = template.builder(procedureDate);
  state.spoken = {};
  state.showFullSchedule = false;
}

function defaultProcedureDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(9, 0, 0, 0);
  return date;
}

function makeSuflaveStep(procedureDate, rule, title, message) {
  return {
    id: uid(),
    rule,
    time: timeFromRule(procedureDate, rule),
    title,
    message,
    done: false
  };
}

function makePrepStep(procedureDate, rule, title, message) {
  return {
    id: uid(),
    rule,
    time: timeFromRule(procedureDate, rule),
    title,
    message,
    done: false
  };
}

function buildSuflaveTemplate(procedureDate) {
  const steps = [
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 5, hour: 9, minute: 0 },
      "Avoid nuts, seeds, and popcorn",
      "Starting today, do not eat nuts, seeds, or popcorn unless your clinician gave different instructions."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 7, minute: 0 },
      "Low residue breakfast window",
      "You may have a low residue breakfast between 7 AM and 9 AM. Examples include eggs, white bread, cottage cheese, yogurt, grits, coffee, or tea. Do not eat solid food after 9 AM."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 9, minute: 0 },
      "Clear liquids only",
      "Do not eat any food after 9 AM. Use clear liquids only. Avoid milk, alcohol, and anything red or purple."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 16, minute: 0 },
      "Mix SUFLAVE Dose 1",
      "Open one flavor packet, pour it into one SUFLAVE bottle, fill with lukewarm water to the fill line, cap, and shake until dissolved. Refrigerate for best taste if time allows."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 0 },
      "Start SUFLAVE Dose 1",
      "Start Dose 1. Drink 8 ounces of SUFLAVE solution every 15 minutes until the bottle is empty. Do not take oral medications within one hour of starting this dose."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 15 },
      "Dose 1: drink 8 ounces",
      "Drink the next 8 ounces of SUFLAVE solution. If nausea, bloating, or cramping occurs, pause or slow down until symptoms diminish."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 30 },
      "Dose 1: drink 8 ounces",
      "Drink the next 8 ounces of SUFLAVE solution."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 45 },
      "Dose 1: finish bottle",
      "Drink the next 8 ounces of SUFLAVE solution and continue every 15 minutes until the bottle is empty."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 19, minute: 0 },
      "Drink 16 ounces of water",
      "Drink an additional 16 ounces of water during the evening."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "offset", minutes: -330 },
      "Mix SUFLAVE Dose 2",
      "Mix the second SUFLAVE bottle with the second flavor packet and lukewarm water to the fill line, then shake until dissolved."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "offset", minutes: -300 },
      "Start SUFLAVE Dose 2",
      "Start Dose 2. This default is 5 hours before the procedure. Drink 8 ounces every 15 minutes. Do not start Dose 2 sooner than 4 hours after starting Dose 1."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "offset", minutes: -285 },
      "Dose 2: drink 8 ounces",
      "Drink the next 8 ounces of SUFLAVE solution."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "offset", minutes: -270 },
      "Dose 2: drink 8 ounces",
      "Drink the next 8 ounces of SUFLAVE solution."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "offset", minutes: -255 },
      "Dose 2: finish bottle",
      "Drink the next 8 ounces of SUFLAVE solution and continue every 15 minutes until the bottle is empty."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "offset", minutes: -225 },
      "Drink 16 ounces of water",
      "Drink an additional 16 ounces of water during the morning."
    ),
    makeSuflaveStep(
      procedureDate,
      { type: "offset", minutes: -120 },
      "Stop drinking liquids",
      "Stop drinking all liquids at least 2 hours before the colonoscopy unless your care team gave different instructions."
    )
  ];

  return steps;
}

function buildMiralaxTemplate(procedureDate) {
  return [
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 5, hour: 9, minute: 0 },
      "Stop supplements and modify diet",
      "Stop all vitamins, herbal supplements, and iron supplements. Avoid nuts, seeds, popcorn, and similar foods. If you are diabetic, call your primary care clinician to discuss medications before prep."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 3, hour: 9, minute: 0 },
      "Purchase MiraLAX prep supplies",
      "Purchase PEG-3350 powdered laxative: one 238 gram bottle and one 119 gram bottle, two bisacodyl laxative tablets, and 96 ounces total of electrolyte solution such as Gatorade or Powerade. Do not use red or purple liquids."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 2, hour: 18, minute: 0 },
      "Mix 119 gram PEG-3350 bottle",
      "Between 6 PM and 9 PM, mix the 119 gram PEG-3350 bottle with 32 ounces of electrolyte solution and shake well."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 2, hour: 18, minute: 15 },
      "Drink 8 ounces of PEG-3350",
      "Drink 8 ounces of the mixed PEG-3350 solution. Continue every 15 to 30 minutes until done. If you feel like you may vomit, take a break until the feeling calms down, then resume more slowly."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 2, hour: 18, minute: 30 },
      "Drink 8 ounces of PEG-3350",
      "Drink the next 8 ounces of the mixed PEG-3350 solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 2, hour: 18, minute: 45 },
      "Drink 8 ounces of PEG-3350",
      "Drink the next 8 ounces of the mixed PEG-3350 solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 2, hour: 19, minute: 0 },
      "Finish 119 gram PEG-3350 dose",
      "Drink the remaining 8 ounces of the mixed PEG-3350 solution, or continue every 15 to 30 minutes until done."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 7, minute: 0 },
      "Clear liquid diet all day",
      "Do not eat solid food today. Start a clear liquid diet when you wake up. Avoid milk, milk products, anything you cannot see through, and anything red or purple."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 15, minute: 0 },
      "Take bisacodyl tablets",
      "At 3 PM, take two bisacodyl laxative tablets with 8 ounces of water."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 0 },
      "Mix half of 238 gram PEG-3350 bottle",
      "At 5 PM, mix half of the 238 gram PEG-3350 bottle with 32 ounces of electrolyte solution. Drink 8 ounces every 15 to 30 minutes until done."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 15 },
      "Drink 8 ounces of PEG-3350",
      "Drink the next 8 ounces of the mixed PEG-3350 solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 30 },
      "Drink 8 ounces of PEG-3350",
      "Drink the next 8 ounces of the mixed PEG-3350 solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 45 },
      "Finish evening PEG-3350 dose",
      "Drink the remaining 8 ounces of the mixed PEG-3350 solution, or continue every 15 to 30 minutes until done. Continue drinking clear liquids until bedtime."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -360 },
      "Mix remaining PEG-3350 dose",
      "Five to six hours before the procedure, mix the remaining PEG-3350 with 32 ounces of electrolyte solution. Drink 8 ounces every 15 to 30 minutes until done."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -345 },
      "Drink 8 ounces of PEG-3350",
      "Drink the next 8 ounces of the mixed PEG-3350 solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -330 },
      "Drink 8 ounces of PEG-3350",
      "Drink the next 8 ounces of the mixed PEG-3350 solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -315 },
      "Finish morning PEG-3350 dose",
      "Drink the remaining 8 ounces of the mixed PEG-3350 solution, or continue every 15 to 30 minutes until done."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -270 },
      "Drink clear liquids",
      "Continue drinking an 8 ounce glass of clear liquid every half hour until 2 hours before the procedure."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -120 },
      "Stop drinking liquids",
      "Stop drinking all liquids 2 hours before the procedure. You may take essential morning medications with a sip of water if your care team instructed you to do so."
    )
  ];
}

function buildNulytelyTemplate(procedureDate) {
  return [
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 5, hour: 9, minute: 0 },
      "Stop supplements and pick up Nulytely",
      "Stop all vitamins, herbal supplements, and iron supplements. Avoid nuts, seeds, and popcorn. Pick up your Nulytely prescription up to 5 days before the appointment and read the warning information enclosed with the packet. If you are diabetic, call your primary care clinician to discuss medications before prep."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 7, minute: 0 },
      "Clear liquid diet all day",
      "Do not eat solid food today. Start a clear liquid diet when you wake up. Clear liquids include water, clear strained juice, clear broth, soda, sports drinks, black coffee, Jello, and popsicles. Avoid milk, milk products, anything you cannot see through, and anything red or purple."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 0 },
      "Start Nulytely evening dose",
      "At 5 PM, drink 8 ounces of Nulytely solution every 15 to 20 minutes until the bottle is half empty. Refrigerate the remaining solution. If you experience nausea, slow down and continue clear liquids during the evening."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 20 },
      "Drink 8 ounces of Nulytely",
      "Drink the next 8 ounces of Nulytely solution. Continue every 15 to 20 minutes until the bottle is half empty."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 40 },
      "Drink 8 ounces of Nulytely",
      "Drink the next 8 ounces of Nulytely solution. Slow down if nausea occurs."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 18, minute: 0 },
      "Continue Nulytely evening dose",
      "Continue drinking 8 ounces every 15 to 20 minutes until the bottle is half empty, then refrigerate the remaining solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 20, minute: 0 },
      "Continue clear liquids",
      "Continue drinking plenty of clear liquids until you go to bed."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -360 },
      "Start remaining Nulytely",
      "Five to six hours before the procedure, start drinking the remaining Nulytely solution. Drink 8 ounces every 15 to 20 minutes until the bottle is empty. You must drink all the solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -340 },
      "Drink 8 ounces of Nulytely",
      "Drink the next 8 ounces of Nulytely solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -320 },
      "Drink 8 ounces of Nulytely",
      "Drink the next 8 ounces of Nulytely solution."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -300 },
      "Continue remaining Nulytely",
      "Continue drinking 8 ounces every 15 to 20 minutes until the bottle is empty."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -270 },
      "Drink clear liquids",
      "Continue drinking an 8 ounce glass of clear liquid every half hour until 2 hours before the procedure."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -120 },
      "Stop drinking liquids",
      "Stop drinking all liquids 2 hours before the procedure. You may take essential morning medications with a sip of water if your care team instructed you to do so."
    )
  ];
}

function buildSuprepTemplate(procedureDate) {
  return [
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 5, hour: 9, minute: 0 },
      "Stop supplements and pick up Suprep",
      "Stop all vitamins, herbal supplements, and iron supplements. Do not eat nuts, seeds, or popcorn. Pick up your Suprep prescription up to 5 days before the appointment. If you are diabetic, call your primary care clinician to discuss medications before prep."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 7, minute: 0 },
      "Clear liquid diet all day",
      "Do not eat solid food today. Start a clear liquid diet when you wake up. Clear liquids include water, clear strained juice, clear broth, soda, sports drinks, black coffee, Jello, and popsicles. Avoid milk, milk products, anything you cannot see through, and anything red or purple."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 0 },
      "Start Suprep Dose 1",
      "At 5 PM, pour one 6 ounce bottle of Suprep into the mixing container, add cool water to the 16 ounce line, and drink the entire amount. If nausea occurs, slow down and continue clear liquids during the evening."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 20 },
      "Drink water after Suprep",
      "Drink water now. You need to drink 32 ounces of water over the next hour after the first Suprep dose."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 17, minute: 40 },
      "Continue 32 ounces of water",
      "Continue drinking water after the first Suprep dose. Finish 32 ounces total over the hour."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 18, minute: 0 },
      "Finish water after Dose 1",
      "Finish the 32 ounces of water after the first Suprep dose."
    ),
    makePrepStep(
      procedureDate,
      { type: "dayBefore", days: 1, hour: 20, minute: 0 },
      "Continue clear liquids",
      "Continue drinking plenty of clear liquids until you go to bed."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -360 },
      "Start Suprep Dose 2",
      "Five to six hours before the procedure, pour the second 6 ounce bottle of Suprep into the mixing container, add cool water to the 16 ounce line, and drink the entire amount."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -340 },
      "Drink water after Suprep",
      "Drink water now. You need to drink 32 ounces of water over the next hour after the second Suprep dose."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -320 },
      "Continue 32 ounces of water",
      "Continue drinking water after the second Suprep dose. Finish 32 ounces total over the hour."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -300 },
      "Finish water after Dose 2",
      "Finish the 32 ounces of water after the second Suprep dose."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -270 },
      "Drink clear liquids",
      "Continue drinking an 8 ounce glass of clear liquid every half hour until 2 hours before the procedure."
    ),
    makePrepStep(
      procedureDate,
      { type: "offset", minutes: -120 },
      "Stop drinking liquids",
      "Stop drinking all liquids 2 hours before the procedure. You may take essential morning medications with a sip of water if your care team instructed you to do so."
    )
  ];
}

function populateVoices() {
  const voices = speechSynthesis.getVoices();
  els.voiceSelect.innerHTML = "";
  const defaultOption = new Option("System default", "");
  els.voiceSelect.add(defaultOption);
  voices.forEach(voice => {
    els.voiceSelect.add(new Option(`${voice.name} (${voice.lang})`, voice.name));
  });
  els.voiceSelect.value = state.voiceName || "";
}

function selectedVoice() {
  return speechSynthesis.getVoices().find(voice => voice.name === state.voiceName) || null;
}

async function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  if (!state.audioContext) state.audioContext = new AudioContext();
  if (state.audioContext.state === "suspended") await state.audioContext.resume();

  const gain = state.audioContext.createGain();
  const osc = state.audioContext.createOscillator();
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(state.audioContext.destination);
  osc.start();
  osc.stop(state.audioContext.currentTime + 0.03);
}

function chime() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = state.audioContext || new AudioContext();
  state.audioContext = context;
  const gain = context.createGain();
  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);
  osc.connect(gain).connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + 0.6);
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    showToast("Voice speech is not supported in this browser.");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = selectedVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.92;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

function notify(step) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(step.title, { body: step.message, tag: step.id });
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  setTimeout(() => els.toast.classList.remove("is-visible"), 5000);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    state.wakeLock = null;
  }
}

async function enableAlarms() {
  state.voiceEnabled = !state.voiceEnabled;

  if (!state.voiceEnabled) {
    speechSynthesis.cancel();
    scheduleAlarms();
    save();
    render();
    showToast("Voice alarms are off.");
    return;
  }

  state.alarmsEnabled = true;
  await unlockAudio();
  save();
  render();
  showToast("Voice alarms are on. On iPhone, keep this app open and the screen awake, or add Calendar alerts.");
  scheduleAlarms();

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  requestWakeLock();
}

function triggerAlarm(step, repeat = false) {
  if (step.done) return;
  state.showFullSchedule = false;
  notify(step);
  if (state.voiceEnabled) {
    chime();
    speak(`${repeat ? "Reminder. " : ""}${step.title}. ${step.message}`);
  }
  showToast(`${step.title}: ${step.message}`);
  state.spoken[step.id] = Date.now();
  save();
  render();

  if (state.repeatMinutes > 0 && state.voiceEnabled) {
    const repeatId = `${step.id}:repeat`;
    clearTimeout(state.timers.get(repeatId));
    state.timers.set(repeatId, setTimeout(() => triggerAlarm(step, true), state.repeatMinutes * 60 * 1000));
  }
}

function scheduleAlarms() {
  state.timers.forEach(timer => clearTimeout(timer));
  state.timers.clear();
  if (!state.voiceEnabled) return;

  const now = Date.now();
  state.steps.forEach(step => {
    if (step.done) return;
    const due = fromInputValue(step.time);
    if (!due || Number.isNaN(due.getTime())) return;
    const delay = due.getTime() - now;
    if (delay > maxTimerDelay) {
      state.timers.set(step.id, setTimeout(scheduleAlarms, maxTimerDelay));
    } else if (delay > 0) {
      state.timers.set(step.id, setTimeout(() => triggerAlarm(step), delay));
    }
  });
}

function shiftDateTime(value, deltaMs) {
  const date = fromInputValue(value);
  if (!date || Number.isNaN(date.getTime())) return value;
  return toInputValue(new Date(date.getTime() + deltaMs));
}

function movePlanToProcedure(newProcedureValue) {
  const oldProcedure = fromInputValue(state.procedureTime);
  const newProcedure = fromInputValue(newProcedureValue);
  if (!newProcedure || Number.isNaN(newProcedure.getTime())) return false;

  const oldTime = oldProcedure && !Number.isNaN(oldProcedure.getTime()) ? oldProcedure.getTime() : null;
  const deltaMs = oldTime === null ? 0 : newProcedure.getTime() - oldTime;
  state.procedureTime = newProcedureValue;
  state.arrivalTime = toInputValue(addMinutes(newProcedure, -45));

  if (state.steps.length === 0) {
    state.steps = (prepTemplates[state.prepType] || prepTemplates.suflave).builder(newProcedure);
  } else if (deltaMs !== 0) {
    state.steps = state.steps.map(step => ({
      ...step,
      time: timeFromRule(newProcedure, step.rule) || shiftDateTime(step.time, deltaMs)
    }));
  }

  state.spoken = {};
  return true;
}

function sortedSteps() {
  return [...state.steps].sort((a, b) => fromInputValue(a.time) - fromInputValue(b.time));
}

function nextStep() {
  const now = Date.now();
  return sortedSteps().find(step => !step.done && fromInputValue(step.time)?.getTime() >= now)
    || sortedSteps().find(step => !step.done)
    || null;
}

function updateNext() {
  const next = nextStep();
  if (!next) {
    els.nextTitle.textContent = "Prep plan complete";
    els.nextDetail.textContent = "All steps have been checked off.";
    els.countdown.textContent = "Done";
    return;
  }

  const due = fromInputValue(next.time);
  const diff = due.getTime() - Date.now();
  els.nextTitle.textContent = next.title;
  els.nextDetail.textContent = `${formatDateTime(next.time)}. ${next.message}`;

  if (diff <= 0) {
    els.countdown.textContent = "Due now";
    return;
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  els.countdown.textContent = days > 0
    ? `${days}d ${pad(hours)}:${pad(minutes)}`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function render() {
  const template = prepTemplates[state.prepType] || prepTemplates.suflave;
  els.prepSelect.value = state.prepType;
  els.procedureTime.value = state.procedureTime || "";
  els.arrivalTime.value = state.arrivalTime || "";
  els.repeatSelect.value = String(state.repeatMinutes);
  els.voiceSelect.value = state.voiceName || "";
  els.enableAlarms.textContent = state.voiceEnabled ? "Voice alarms on" : "Voice alarms off";
  els.enableAlarms.setAttribute("aria-pressed", String(state.voiceEnabled));
  els.exportCalendar.textContent = calendarButtonText();
  els.toggleFullSchedule.textContent = state.showFullSchedule ? "Hide full schedule" : "Show full schedule";
  els.toggleFullSchedule.setAttribute("aria-pressed", String(state.showFullSchedule));
  els.timelineTitle.textContent = state.showFullSchedule ? "Full prep schedule" : "Current instruction";
  els.timelineHint.textContent = state.showFullSchedule
    ? "Review all steps. Voice alarms still follow the scheduled times."
    : "Showing only the next step to follow.";
  els.resetSchedule.textContent = `Reset ${template.label}`;

  const now = Date.now();
  const visibleSteps = state.showFullSchedule ? sortedSteps() : [nextStep()].filter(Boolean);
  els.timeline.innerHTML = "";
  visibleSteps.forEach(step => {
    const due = fromInputValue(step.time);
    const item = document.createElement("article");
    item.className = "step";
    item.dataset.stepId = step.id;
    if (step.done) item.classList.add("is-done");
    if (!step.done && due && due.getTime() <= now) item.classList.add("is-due");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(step.done);
    checkbox.setAttribute("aria-label", `Mark ${step.title} complete`);
    checkbox.addEventListener("change", () => {
      step.done = checkbox.checked;
      clearTimeout(state.timers.get(`${step.id}:repeat`));
      if (checkbox.checked) state.showFullSchedule = false;
      save();
      scheduleAlarms();
      render();
    });

    const content = document.createElement("div");
    content.innerHTML = `
      <time datetime="${step.time}">${formatDateTime(step.time)}</time>
      <h3></h3>
      <p></p>
    `;
    content.querySelector("h3").textContent = step.title;
    content.querySelector("p").textContent = step.message;

    const buttons = document.createElement("div");
    buttons.className = "step-buttons";
    const speakButton = document.createElement("button");
    speakButton.className = "secondary-button";
    speakButton.type = "button";
    speakButton.textContent = "Speak";
    speakButton.addEventListener("click", () => {
      chime();
      speak(`${step.title}. ${step.message}`);
    });
    const editButton = document.createElement("button");
    editButton.className = "ghost-button";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => openDialog(step));
    buttons.append(speakButton, editButton);

    item.append(checkbox, content, buttons);
    els.timeline.append(item);
  });

  updateNext();
}

function refreshUrgency() {
  const now = Date.now();
  const current = nextStep();
  const focusedItem = !state.showFullSchedule && current
    ? els.timeline.querySelector(`[data-step-id="${CSS.escape(current.id)}"]`)
    : null;
  if (!state.showFullSchedule && current && !focusedItem) render();

  state.steps.forEach(step => {
    const item = els.timeline.querySelector(`[data-step-id="${CSS.escape(step.id)}"]`);
    const due = fromInputValue(step.time);
    if (!item || !due) return;
    item.classList.toggle("is-due", !step.done && due.getTime() <= now);
    item.classList.toggle("is-done", Boolean(step.done));
  });
}

function openDialog(step = null) {
  const isNew = !step;
  const fallbackTime = state.procedureTime || toInputValue(addMinutes(new Date(), 60));
  els.dialogTitle.textContent = isNew ? "Add step" : "Edit step";
  els.editingId.value = step?.id || "";
  els.stepTitle.value = step?.title || "";
  els.stepMessage.value = step?.message || "";
  els.stepTime.value = step?.time || fallbackTime;
  els.deleteStep.style.visibility = isNew ? "hidden" : "visible";
  els.stepDialog.showModal();
}

function saveDialogStep() {
  if (!els.stepTitle.value.trim() || !els.stepMessage.value.trim() || !els.stepTime.value) {
    showToast("Please complete the step title, message, and time.");
    return;
  }

  const id = els.editingId.value;
  const existing = state.steps.find(step => step.id === id);
  const values = {
    title: els.stepTitle.value.trim(),
    message: els.stepMessage.value.trim(),
    time: els.stepTime.value,
    done: existing?.done || false
  };

  if (existing) {
    Object.assign(existing, values);
    delete state.spoken[existing.id];
  } else {
    state.steps.push({ id: uid(), ...values });
  }

  els.stepDialog.close();
  save();
  scheduleAlarms();
  render();
}

function deleteDialogStep() {
  const id = els.editingId.value;
  state.steps = state.steps.filter(step => step.id !== id);
  delete state.spoken[id];
  clearTimeout(state.timers.get(id));
  clearTimeout(state.timers.get(`${id}:repeat`));
  els.stepDialog.close();
  save();
  scheduleAlarms();
  render();
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsLocal(value) {
  const date = fromInputValue(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "T" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    "00"
  ].join("");
}

function foldIcsLine(line) {
  const chunks = [];
  let remaining = line;
  while (remaining.length > 74) {
    chunks.push(remaining.slice(0, 74));
    remaining = " " + remaining.slice(74);
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

async function exportCalendar() {
  const activeSteps = sortedSteps().filter(step => !step.done && fromInputValue(step.time));
  if (activeSteps.length === 0) {
    showToast("There are no active prep steps to export.");
    return;
  }

  const template = prepTemplates[state.prepType] || prepTemplates.suflave;
  const generated = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Green Mountain Prep Companion//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`Green Mountain ${template.label}`)}`
  ];

  activeSteps.forEach(step => {
    const start = formatIcsLocal(step.time);
    const end = formatIcsLocal(toInputValue(addMinutes(fromInputValue(step.time), 5)));
    lines.push(
      "BEGIN:VEVENT",
      `UID:${step.id}@green-mountain-prep-companion`,
      `DTSTAMP:${generated}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcsText(step.title)}`,
      `DESCRIPTION:${escapeIcsText(step.message)}`,
      "BEGIN:VALARM",
      "TRIGGER:PT0S",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(step.title)}`,
      "END:VALARM",
      "END:VEVENT"
    );
  });

  lines.push("END:VCALENDAR");
  const body = lines.map(foldIcsLine).join("\r\n");
  const filename = `green-mountain-${state.prepType}-prep-alarms.ics`;
  const file = new File([body], filename, { type: "text/calendar" });
  const type = deviceType();

  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({
        files: [file],
        title: "Green Mountain prep alarms",
        text: "Add these colonoscopy prep reminders to your calendar."
      });
      showToast(type === "android"
        ? "Choose Calendar or your preferred app to add the prep alerts."
        : "Open the shared calendar file and add the prep alerts.");
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (type === "ios") {
    showToast("Calendar file created. Open it and add the events to iPhone Calendar.");
  } else if (type === "android") {
    showToast("Calendar file created. Open it with Calendar to add the prep alerts.");
  } else {
    showToast("Calendar file downloaded. Import it into your calendar app.");
  }
}

function refreshTemplate() {
  const procedureDate = fromInputValue(state.procedureTime);
  if (!procedureDate || Number.isNaN(procedureDate.getTime())) {
    showToast("Set the procedure date and time first.");
    return;
  }
  applyPrepTemplate(state.prepType, procedureDate);
  save();
  scheduleAlarms();
  render();
  showToast(`${prepTemplates[state.prepType].loadedMessage} Edit any step to match your clinic instructions.`);
}

function bindEvents() {
  els.procedureTime.addEventListener("change", () => {
    if (!movePlanToProcedure(els.procedureTime.value)) {
      showToast("Enter a valid procedure date and time.");
      render();
      return;
    }
    save();
    scheduleAlarms();
    render();
    showToast("Procedure time updated. Arrival and prep alarms were adjusted.");
  });
  els.arrivalTime.addEventListener("change", () => {
    state.arrivalTime = els.arrivalTime.value;
    save();
  });
  els.prepSelect.addEventListener("change", () => {
    const procedureDate = fromInputValue(state.procedureTime) || defaultProcedureDate();
    applyPrepTemplate(els.prepSelect.value, procedureDate);
    save();
    scheduleAlarms();
    render();
    showToast(`${prepTemplates[state.prepType].loadedMessage} Arrival remains 45 minutes before procedure.`);
  });
  els.repeatSelect.addEventListener("change", () => {
    state.repeatMinutes = Number(els.repeatSelect.value);
    save();
    scheduleAlarms();
  });
  els.voiceSelect.addEventListener("change", () => {
    state.voiceName = els.voiceSelect.value;
    save();
  });
  els.enableAlarms.addEventListener("click", enableAlarms);
  els.resetSchedule.addEventListener("click", refreshTemplate);
  els.exportCalendar.addEventListener("click", exportCalendar);
  els.testAlarm.addEventListener("click", () => {
    const testStep = {
      id: uid(),
      title: "Test alarm",
      message: "This is a test of the colonoscopy prep voice reminder.",
      time: toInputValue(addMinutes(new Date(), 1)),
      done: false
    };
    showToast("Test alarm scheduled for 10 seconds from now.");
    setTimeout(() => triggerAlarm(testStep), 10000);
  });
  els.printPlan.addEventListener("click", () => window.print());
  els.addStep.addEventListener("click", () => openDialog());
  els.toggleFullSchedule.addEventListener("click", () => {
    state.showFullSchedule = !state.showFullSchedule;
    render();
  });
  els.saveStep.addEventListener("click", saveDialogStep);
  els.deleteStep.addEventListener("click", deleteDialogStep);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.alarmsEnabled) requestWakeLock();
  });
}

load();
populateVoices();
bindEvents();
render();
scheduleAlarms();
setInterval(() => {
  updateNext();
  refreshUrgency();
}, 1000);

if ("speechSynthesis" in window) {
  speechSynthesis.addEventListener("voiceschanged", populateVoices);
}
