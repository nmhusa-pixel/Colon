const storageKey = "prep-companion-v1";
const suflaveTemplateId = "green-mountain-suflave-2025";
const maxTimerDelay = 12 * 60 * 60 * 1000;

const state = {
  procedureTime: "",
  arrivalTime: "",
  templateId: suflaveTemplateId,
  repeatMinutes: 10,
  voiceName: "",
  alarmsEnabled: true,
  voiceEnabled: false,
  showFullSchedule: false,
  steps: [],
  spoken: {},
  timers: new Map(),
  wakeLock: null
};

const els = {
  procedureTime: document.querySelector("#procedureTime"),
  arrivalTime: document.querySelector("#arrivalTime"),
  voiceSelect: document.querySelector("#voiceSelect"),
  repeatSelect: document.querySelector("#repeatSelect"),
  enableAlarms: document.querySelector("#enableAlarms"),
  loadSuflaveTemplate: document.querySelector("#loadSuflaveTemplate"),
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
      const hasOldTemplate = state.templateId !== suflaveTemplateId
        || state.steps.some(step => /miralax|polyethylene glycol|finish second dose/i.test(`${step.title} ${step.message}`))
        || !state.steps.some(step => /suflave/i.test(`${step.title} ${step.message}`));
      if (hasOldTemplate) {
        const procedureDate = fromInputValue(state.procedureTime) || defaultProcedureDate();
        state.templateId = suflaveTemplateId;
        state.procedureTime = toInputValue(procedureDate);
        state.arrivalTime = toInputValue(addMinutes(procedureDate, -45));
        state.steps = buildSuflaveTemplate(procedureDate);
        state.spoken = {};
        save();
      }
      return;
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  const procedureDate = defaultProcedureDate();
  state.templateId = suflaveTemplateId;
  state.procedureTime = toInputValue(procedureDate);
  state.arrivalTime = toInputValue(addMinutes(procedureDate, -45));
  state.steps = buildSuflaveTemplate(procedureDate);
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

function chime() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
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
  save();
  render();
  showToast("Voice alarms are on. Future reminders will play at their scheduled times.");
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
    state.steps = buildSuflaveTemplate(newProcedure);
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
  els.procedureTime.value = state.procedureTime || "";
  els.arrivalTime.value = state.arrivalTime || "";
  els.repeatSelect.value = String(state.repeatMinutes);
  els.voiceSelect.value = state.voiceName || "";
  els.enableAlarms.textContent = state.voiceEnabled ? "Voice alarms on" : "Voice alarms off";
  els.enableAlarms.setAttribute("aria-pressed", String(state.voiceEnabled));
  els.toggleFullSchedule.textContent = state.showFullSchedule ? "Hide full schedule" : "Show full schedule";
  els.toggleFullSchedule.setAttribute("aria-pressed", String(state.showFullSchedule));
  els.timelineTitle.textContent = state.showFullSchedule ? "Full prep schedule" : "Current instruction";
  els.timelineHint.textContent = state.showFullSchedule
    ? "Review all steps. Voice alarms still follow the scheduled times."
    : "Showing only the next step to follow.";

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

function refreshTemplate() {
  const procedureDate = fromInputValue(state.procedureTime);
  if (!procedureDate || Number.isNaN(procedureDate.getTime())) {
    showToast("Set the procedure date and time first.");
    return;
  }
  state.templateId = suflaveTemplateId;
  state.arrivalTime = toInputValue(addMinutes(procedureDate, -45));
  state.steps = buildSuflaveTemplate(procedureDate);
  state.spoken = {};
  save();
  scheduleAlarms();
  render();
  showToast("Green Mountain SUFLAVE schedule loaded. Edit any step to match your clinic instructions.");
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
  els.loadSuflaveTemplate.addEventListener("click", refreshTemplate);
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
