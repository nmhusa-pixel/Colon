const storageKey = "prep-companion-v1";
const maxTimerDelay = 12 * 60 * 60 * 1000;
const standardStepRules = {
  "Review medication instructions": { type: "dayBefore", days: 5, hour: 9, minute: 0 },
  "Start clear liquid diet": { type: "dayBefore", days: 1, hour: 0, minute: 0 },
  "Begin MiraLAX prep": { type: "dayBefore", days: 1, hour: 17, minute: 0 },
  "Continue prep fluids": { type: "dayBefore", days: 1, hour: 20, minute: 0 },
  "Finish second dose window": { type: "offset", minutes: -360 },
  "Stop liquids if instructed": { type: "offset", minutes: -240 }
};

const state = {
  procedureTime: "",
  arrivalTime: "",
  repeatMinutes: 10,
  voiceName: "",
  alarmsEnabled: true,
  voiceEnabled: false,
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
  loadTemplate: document.querySelector("#loadTemplate"),
  testAlarm: document.querySelector("#testAlarm"),
  printPlan: document.querySelector("#printPlan"),
  saveStatus: document.querySelector("#saveStatus"),
  nextTitle: document.querySelector("#nextTitle"),
  nextDetail: document.querySelector("#nextDetail"),
  countdown: document.querySelector("#countdown"),
  timeline: document.querySelector("#timeline"),
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
      return;
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);
  tomorrow.setHours(9, 0, 0, 0);
  state.procedureTime = toInputValue(tomorrow);
  state.arrivalTime = toInputValue(addMinutes(tomorrow, -60));
  state.steps = buildTemplate(tomorrow);
}

function buildTemplate(procedureDate) {
  const dayBefore = new Date(procedureDate);
  dayBefore.setDate(dayBefore.getDate() - 1);

  const fiveDaysBefore = new Date(procedureDate);
  fiveDaysBefore.setDate(fiveDaysBefore.getDate() - 5);

  const steps = [
    {
      rule: standardStepRules["Review medication instructions"],
      time: toInputValue(new Date(fiveDaysBefore.setHours(9, 0, 0, 0))),
      title: "Review medication instructions",
      message: "Review your colonoscopy prep instructions today. Call your care team if you take blood thinners, diabetes medicines, iron, or medicines that affect kidneys."
    },
    {
      rule: standardStepRules["Start clear liquid diet"],
      time: toInputValue(new Date(dayBefore.setHours(0, 0, 0, 0))),
      title: "Start clear liquid diet",
      message: "Start the clear liquid diet now. Do not eat solid food unless your clinician gave different instructions."
    },
    {
      rule: standardStepRules["Begin MiraLAX prep"],
      time: toInputValue(new Date(dayBefore.setHours(17, 0, 0, 0))),
      title: "Begin MiraLAX prep",
      message: "Begin the MiraLAX or polyethylene glycol 3350 prep according to your printed instructions. Drink the first portion at the pace your care team prescribed."
    },
    {
      rule: standardStepRules["Continue prep fluids"],
      time: toInputValue(new Date(dayBefore.setHours(20, 0, 0, 0))),
      title: "Continue prep fluids",
      message: "Continue the prep fluids and clear liquids as directed. Stay near a bathroom and keep drinking approved clear liquids unless told otherwise."
    },
    {
      rule: standardStepRules["Finish second dose window"],
      time: toInputValue(addMinutes(procedureDate, -360)),
      title: "Finish second dose window",
      message: "It is time for the second dose window if your instructions use split dosing. Follow the exact timing from your care team."
    },
    {
      rule: standardStepRules["Stop liquids if instructed"],
      time: toInputValue(addMinutes(procedureDate, -240)),
      title: "Stop liquids if instructed",
      message: "Check your instructions for when to stop all liquids before anesthesia. Many centers use a cutoff several hours before arrival, but your printed plan controls."
    }
  ];

  return steps.map(step => ({ ...step, id: uid(), done: false }));
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
  notify(step);
  if (state.voiceEnabled) {
    chime();
    speak(`${repeat ? "Reminder. " : ""}${step.title}. ${step.message}`);
  }
  showToast(`${step.title}: ${step.message}`);
  state.spoken[step.id] = Date.now();
  save();

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
  state.arrivalTime = toInputValue(addMinutes(newProcedure, -60));

  if (state.steps.length === 0) {
    state.steps = buildTemplate(newProcedure);
  } else if (deltaMs !== 0) {
    state.steps = state.steps.map(step => ({
      ...step,
      rule: step.rule || standardStepRules[step.title] || null,
      time: timeFromRule(newProcedure, step.rule || standardStepRules[step.title]) || shiftDateTime(step.time, deltaMs)
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

  const now = Date.now();
  els.timeline.innerHTML = "";
  sortedSteps().forEach(step => {
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
  state.steps = buildTemplate(procedureDate);
  state.spoken = {};
  save();
  scheduleAlarms();
  render();
  showToast("Template loaded. Edit any step to match the clinic instructions.");
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
  els.loadTemplate.addEventListener("click", refreshTemplate);
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
