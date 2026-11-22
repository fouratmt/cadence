import {
  buildTimeline, DEFAULT_SETTINGS, DEFAULT_TIMERS, elapsedTime, formatTime,
  pad, PHASE_NAMES, stopwatchValue, validTimer, workoutFrame,
} from "./timer.mjs";
import { ScreenAwake, WorkoutCues } from "./cues.mjs";

const byId = (id) => document.getElementById(id);
const modes = ["rounds", "tabata", "stopwatch", "more"];
const modeNames = { rounds: "Rounds", tabata: "Tabata" };
const storageKey = "sports-timer:v1";
const sessionKey = "sports-timer:session:v1";
const fields = {
  prepare: "Prepare",
  work: "Work",
  rest: "Rest",
  rounds: "Rounds",
  cooldown: "Cooldown",
};

function read(storageName, key) {
  try {
    return JSON.parse(window[storageName].getItem(key)) ?? {};
  } catch {
    return {};
  }
}

function write(storageName, key, data) {
  try {
    window[storageName].setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

const stored = read("localStorage", storageKey);
const settings = { ...DEFAULT_SETTINGS, ...stored.settings };
const baseTimers = Object.fromEntries(Object.entries(DEFAULT_TIMERS).map(([key, config]) =>
  [key, validTimer(stored.baseTimers?.[key]) ? stored.baseTimers[key] : config]
));
let presets = Array.isArray(stored.presets) ? stored.presets.filter((preset) =>
  typeof preset?.name === "string" && typeof preset.id === "string" &&
  Object.hasOwn(modeNames, preset.mode) && validTimer(preset.config)
) : [];
const selected = { ...stored.selected };

function persist() {
  if (!write("localStorage", storageKey, { settings, baseTimers, presets, selected })) {
    announce("Device storage is unavailable. Changes will last until this page closes.");
  }
}

const savedSession = read("sessionStorage", sessionKey);
const savedInterval = savedSession.interval;
let interval = Object.hasOwn(modeNames, savedInterval?.mode) && validTimer(savedInterval.config)
  ? { ...savedInterval, timeline: buildTimeline(savedInterval.config) }
  : null;
let stopwatch = savedSession.stopwatch ?? { elapsed: 0, startedAt: null, laps: [] };
let mode = readMode();
let view = Object.hasOwn(modeNames, mode) ? "interval" : mode;
let editor;
let editorReturn;
let settingsReturn;
let deleteId;
let intervalTimeout;
let stopwatchAnimation;
let lastIndex = interval ? workoutFrame(interval.timeline, elapsedTime(interval)).index : -1;
let lastRoundTrack = "";
let installPrompt;
let offlineStatus = "Preparing offline access";
const cues = new WorkoutCues();
const screenAwake = new ScreenAwake(drawWakeStatus);

function saveSession() {
  const { timeline, ...intervalSnapshot } = interval ?? {};
  write("sessionStorage", sessionKey, { interval: interval ? intervalSnapshot : null, stopwatch });
}

function readMode() {
  const hash = location.hash.slice(1);
  return modes.includes(hash) ? hash : "rounds";
}

function announce(message) {
  byId("announcement").textContent = message;
}

function text(id, value) {
  const element = byId(id);
  if (element.textContent !== value) element.textContent = value;
}

function time(seconds) {
  return formatTime(seconds, settings.timeFormat);
}

function selectedPreset(forMode) {
  return presets.find((preset) => preset.id === selected[forMode] && preset.mode === forMode);
}

function activeInterval() {
  return interval !== null && elapsedTime(interval) < interval.timeline.total;
}

function setMainButton(id, state) {
  const button = byId(id);
  const icon = state === "Pause" ? "pause" : state === "Restart" ? "reset" : "play";
  const href = `#i-${icon}`;
  if (button.querySelector("use").getAttribute("href") !== href) {
    button.querySelector("use").setAttribute("href", href);
  }
  if (button.lastElementChild.textContent !== state) button.lastElementChild.textContent = state;
}

function setClockSize(element, value) {
  element.classList.toggle("long-time", value.length > 5);
  element.classList.toggle("extra-long-time", value.length > 7);
}

function navigate(nextMode) {
  if (readMode() !== nextMode) history.pushState(null, "", `#${nextMode}`);
  setMode(nextMode);
}

function setMode(nextMode, focus = true) {
  mode = nextMode;
  swapView(Object.hasOwn(modeNames, mode) ? "interval" : mode, focus);
}

function swapView(next, focus = true) {
  const changed = view !== next;
  view = next;
  for (const name of ["interval", "stopwatch", "more", "editor", "settings"]) {
    byId(`${name}-view`).hidden = name !== next;
  }
  for (const link of document.querySelectorAll(".tab-bar a")) {
    if (link.dataset.mode === mode) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  syncInterval(true);
  drawStopwatch();
  if (view === "more") {
    drawPresets();
    drawInstall();
  }
  if (focus) {
    byId(`${view}-title`).focus({ preventScroll: true });
    if (changed) window.scrollTo(0, 0);
  }
}

function drawRoundTrack(round, total, finished) {
  const key = `${round}-${total}-${finished}`;
  if (key === lastRoundTrack) return;
  lastRoundTrack = key;
  const whole = Math.min(16, total);
  const current = Math.ceil(round * whole / total);
  byId("round-track").replaceChildren(...Array.from({ length: whole }, (_, index) => {
    const mark = document.createElement("span");
    if (finished || index + 1 < current) mark.className = "done";
    else if (index + 1 === current) mark.className = "current";
    return mark;
  }));
}

let preview;
function intervalPreview() {
  const preset = selectedPreset(mode);
  const config = preset?.config ?? baseTimers[mode];
  if (preview?.config !== config) preview = { config, timeline: buildTimeline(config) };
  return { timeline: preview.timeline, name: preset?.name ?? modeNames[mode] };
}

function drawInterval(now) {
  if (view !== "interval") return;
  const workout = interval?.mode === mode ? interval : null;
  const otherActive = !workout && activeInterval();
  const { timeline, name } = workout ?? intervalPreview();
  const frame = workoutFrame(timeline, workout ? elapsedTime(workout, now) : 0);
  const running = workout && workout.startedAt !== null;
  const finished = frame.kind === "finished";
  const editable = !workout || finished;
  const phasePanel = byId("phase-panel");
  const phaseTime = byId("phase-time");
  const upcoming = frame.next;

  text("interval-title", name);
  text("workout-total", time(Math.ceil(frame.totalRemaining / 1000)));
  text("workout-total-label", !workout ? "total" : "left in workout");
  byId("active-workout").hidden = !otherActive;
  byId("edit-timer").disabled = !editable;
  phasePanel.dataset.phase = frame.kind;
  text("phase-name", PHASE_NAMES[frame.kind]);
  text("phase-status", finished ? "Finished" : running ? "Running" : workout ? "Paused" : "Ready");
  const remaining = time(Math.ceil(frame.remaining / 1000));
  text("phase-time", remaining);
  setClockSize(phaseTime, remaining);
  byId("phase-fill").style.width = `${frame.progress * 100}%`;

  byId("next-panel").dataset.phase = upcoming?.kind ?? "finished";
  text("next-name", upcoming ? PHASE_NAMES[upcoming.kind] : "Finish");
  text("next-time", upcoming ? time((upcoming.end - upcoming.start) / 1000) : "");
  text("round-label", finished ? "Rounds done" : "Round");
  text("round-current", finished ? pad(timeline.rounds) : pad(frame.round || 1));
  text("round-total", pad(timeline.rounds));
  drawRoundTrack(frame.round, timeline.rounds, finished);

  setMainButton("interval-main", finished ? "Restart" : running ? "Pause" : workout ? "Resume" : "Start");
  byId("interval-main").disabled = otherActive;
  byId("interval-skip").disabled = !workout || finished;
  byId("interval-reset").disabled = !workout;
}

function phaseCue(kind) {
  cues.play(kind, settings);
  if (settings.flash && !document.hidden && view === "interval" && interval?.mode === mode) {
    const panel = byId("phase-panel");
    panel.classList.remove("flash");
    void panel.offsetWidth;
    panel.classList.add("flash");
  }
}

function syncInterval(allowCue = false) {
  clearTimeout(intervalTimeout);
  const now = Date.now();

  if (interval && interval.startedAt !== null) {
    const elapsed = elapsedTime(interval, now);
    const frame = workoutFrame(interval.timeline, elapsed);
    if (frame.index !== lastIndex) {
      const start = interval.timeline.phases[frame.index]?.start ?? interval.timeline.total;
      if (allowCue && elapsed - start < 1500) phaseCue(frame.kind);
      lastIndex = frame.index;
    }
    if (frame.kind === "finished") {
      interval.elapsed = interval.timeline.total;
      interval.startedAt = null;
      saveSession();
    } else {
      const remainder = Math.ceil(frame.remaining / 1000);
      const toNextSecond = frame.remaining - (remainder - 1) * 1000;
      const delay = document.hidden || view !== "interval" ? frame.remaining : toNextSecond;
      intervalTimeout = setTimeout(() => syncInterval(true), Math.max(12, delay));
    }
  }

  drawInterval(now);
  syncWake();
}

function toggleInterval() {
  if (activeInterval() && interval.mode !== mode) return;
  const now = Date.now();

  if (interval?.mode === mode && interval.startedAt !== null) {
    interval.elapsed = Math.min(interval.timeline.total, elapsedTime(interval, now));
    interval.startedAt = null;
    cues.stop();
  } else if (interval?.mode === mode && activeInterval()) {
    cues.prepare(settings.voice);
    interval.startedAt = now;
  } else {
    const preset = selectedPreset(mode);
    const config = preset?.config ?? baseTimers[mode];
    interval = {
      mode, config, timeline: buildTimeline(config), name: preset?.name ?? modeNames[mode],
      elapsed: 0, startedAt: now,
    };
    cues.prepare(settings.voice);
    lastIndex = -1;
  }

  saveSession();
  syncInterval(true);
  syncWake(true);
}

function skipInterval() {
  if (!activeInterval() || interval.mode !== mode) return;
  const frame = workoutFrame(interval.timeline, elapsedTime(interval));
  const running = interval.startedAt !== null;
  interval.elapsed = frame.phaseEnd;
  interval.startedAt = running ? Date.now() : null;
  if (!running) lastIndex = frame.index + 1;
  saveSession();
  syncInterval(running);
}

function resetInterval() {
  interval = null;
  lastIndex = -1;
  cues.stop();
  saveSession();
  syncInterval();
}

function drawStopwatch() {
  cancelAnimationFrame(stopwatchAnimation);
  if (view !== "stopwatch") return;
  const elapsed = elapsedTime(stopwatch);
  const value = stopwatchValue(elapsed, settings.timeFormat);
  text("stopwatch-time", value.time);
  text("stopwatch-fraction", value.fraction);
  setClockSize(byId("stopwatch-time").parentElement, value.time);
  const running = stopwatch.startedAt !== null;
  const hasStarted = running || elapsed > 0;

  text("stopwatch-status", running ? "Running" : hasStarted ? "Paused" : "Ready");
  setMainButton("stopwatch-main", running ? "Pause" : hasStarted ? "Resume" : "Start");
  byId("stopwatch-lap").disabled = !running;
  byId("stopwatch-reset").disabled = !hasStarted;
  if (running && !document.hidden) stopwatchAnimation = requestAnimationFrame(drawStopwatch);
}

function drawLaps() {
  const oneTime = (lap) => {
    const { time: whole, fraction } = stopwatchValue(lap, settings.timeFormat);
    return whole + fraction;
  };
  const rows = stopwatch.laps.map((lap, index, laps) => {
    const row = document.createElement("tr");
    [pad(index + 1), oneTime(lap - (laps[index - 1] ?? 0)), oneTime(lap)].forEach((value) => {
      row.insertCell().textContent = value;
    });
    return row;
  });
  byId("laps").replaceChildren(...rows.reverse());
  byId("laps-empty").hidden = rows.length > 0;
  byId("laps-table-wrap").hidden = rows.length === 0;
}

function toggleStopwatch() {
  if (stopwatch.startedAt === null) {
    stopwatch.startedAt = Date.now();
  } else {
    stopwatch.elapsed = elapsedTime(stopwatch);
    stopwatch.startedAt = null;
  }
  saveSession();
  drawStopwatch();
  syncWake(true);
}

function addLap() {
  if (stopwatch.startedAt === null) return;
  stopwatch.laps.push(elapsedTime(stopwatch));
  saveSession();
  drawLaps();
  announce(`Lap ${stopwatch.laps.length} recorded.`);
}

function resetStopwatch() {
  stopwatch = { elapsed: 0, startedAt: null, laps: [] };
  saveSession();
  drawLaps();
  drawStopwatch();
  syncWake();
}

function syncWake(retry = false) {
  const running = (interval?.startedAt != null && activeInterval()) || stopwatch.startedAt !== null;
  screenAwake.update(settings.wake && running, retry);
}

function drawWakeStatus(status) {
  const element = byId("wake-status");
  element.hidden = status !== "unavailable";
  element.lastElementChild.textContent = status === "unavailable"
    ? "The browser could not keep your screen awake. Keep the app visible for workout cues."
    : "";
}

function renderEditorFields(config) {
  byId("duration-list").innerHTML = Object.entries(fields).map(([field, name]) => {
    const value = config[field];
    const count = field === "rounds";
    const inputs = count
      ? `<label>Count<input data-timer-field="${field}" type="number" inputmode="numeric" min="1" max="99" value="${value}" required></label>`
      : `<label>Min<input data-timer-field="${field}" type="number" inputmode="numeric" min="0" max="59" value="${Math.floor(value / 60)}" required></label>
         <label>Sec<input data-timer-field="${field}" type="number" inputmode="numeric" min="0" max="59" value="${value % 60}" required></label>`;
    return `<div class="duration-row" role="group" aria-labelledby="field-${field}">
      <span class="duration-title" id="field-${field}"><span class="phase-dot" data-phase="${field}"></span>${name}</span>
      <div class="duration-inputs">${inputs}</div>
    </div>`;
  }).join("");
}

function editorConfig() {
  const config = {};
  for (const field of Object.keys(fields)) {
    const inputs = byId("duration-list").querySelectorAll(`[data-timer-field="${field}"]`);
    if (Array.from(inputs).some((input) => !input.validity.valid)) return null;
    const amount = inputs[0].valueAsNumber;
    config[field] = field === "rounds" ? amount : amount * 60 + inputs[1].valueAsNumber;
  }
  return config;
}

function refreshEditor() {
  const named = editor.kind !== "base";
  text("editor-title", editor.kind === "new" || editor.kind === "copy" ? "New timer" : "Edit timer");
  byId("preset-fields").hidden = !named;
  byId("preset-name").required = named;
  byId("preset-mode").disabled = editor.kind !== "new";
  document.querySelector('[data-action="save-as"]').hidden = editor.kind === "new" || editor.kind === "copy";
  byId("editor-note").hidden = true;
  const config = editorConfig();
  text("editor-total", validTimer(config) ? time(buildTimeline(config).total / 1000) : "—");
}

function openEditor(kind, preset) {
  editorReturn = view;
  const editorMode = preset?.mode ?? (Object.hasOwn(modeNames, mode) ? mode : "rounds");
  editor = { kind, mode: editorMode, id: preset?.id };
  byId("preset-name").value = preset?.name ?? "";
  byId("preset-mode").value = editorMode;
  renderEditorFields(preset?.config ?? baseTimers[editorMode]);
  refreshEditor();
  swapView("editor");
}

function showEditorNote(message) {
  text("editor-note", message);
  byId("editor-note").hidden = false;
}

function readEditorConfig() {
  if (!byId("timer-form").reportValidity()) return null;
  const config = editorConfig();
  if (!validTimer(config)) {
    showEditorNote("Set Work to at least one second.");
    byId("duration-list").querySelector('[data-timer-field="work"]').focus();
    return null;
  }
  return config;
}

function saveAs() {
  if (!readEditorConfig()) return;
  const input = byId("preset-name");
  input.value = editor.kind === "preset" ? `${input.value.slice(0, 43)} copy` : "";
  editor = { kind: "copy", mode: editor.mode };
  refreshEditor();
  input.focus();
  input.select();
}

function closeEditor() {
  swapView(editorReturn);
}

function saveTimer(event) {
  event.preventDefault();
  const config = readEditorConfig();
  if (!config) return;
  const { kind, mode: editorMode, id } = editor;

  if (kind === "base") {
    baseTimers[editorMode] = config;
    if (interval?.mode === editorMode && !activeInterval()) resetInterval();
  } else {
    const name = byId("preset-name").value.trim();
    if (!name) {
      showEditorNote("Enter a name for this timer.");
      byId("preset-name").focus();
      return;
    }
    const key = id ?? (crypto.randomUUID?.() ?? `timer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const preset = { id: key, name, mode: editorMode, config };
    if (id) presets = presets.map((item) => item.id === id ? preset : item);
    else presets.push(preset);
    if (editorReturn === "interval") {
      selected[editorMode] = key;
      if (interval?.mode === editorMode && !activeInterval()) resetInterval();
    }
  }

  announce("Timer saved.");
  persist();
  closeEditor();
}

function makePresetRow(preset) {
  const item = document.createElement("li");
  item.innerHTML = `<button type="button" class="preset-open" data-action="open-preset">
    <span><strong></strong><small></small></span><svg class="icon" aria-hidden="true"><use href="#i-next"/></svg></button>
    <button type="button" class="button button-quiet button-icon" data-action="edit-preset"><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg></button>
    <button type="button" class="button button-quiet button-icon" data-action="delete-preset"><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button>`;
  item.dataset.preset = preset.id;
  item.querySelector("strong").textContent = preset.name;
  item.querySelector("small").textContent = `${modeNames[preset.mode]} · ${time(buildTimeline(preset.config).total / 1000)}`;
  item.querySelector('[data-action="edit-preset"]').setAttribute("aria-label", `Edit ${preset.name}`);
  item.querySelector('[data-action="delete-preset"]').setAttribute("aria-label", `Delete ${preset.name}`);
  return item;
}

function drawPresets() {
  const rows = presets.map(makePresetRow);
  for (const timerMode of Object.keys(modeNames)) {
    if (!selectedPreset(timerMode)) continue;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-quiet";
    button.dataset.action = "load-default";
    button.dataset.defaultMode = timerMode;
    button.textContent = `Use default ${modeNames[timerMode]}`;
    item.append(button);
    rows.push(item);
  }
  byId("presets").replaceChildren(...rows);
  byId("presets-empty").hidden = presets.length > 0;
}

function loadPreset(preset) {
  if (activeInterval()) {
    navigate(interval.mode);
    announce("Reset the active workout before loading a different timer.");
    return;
  }
  if (preset.id) selected[preset.mode] = preset.id;
  else delete selected[preset.mode];
  resetInterval();
  persist();
  navigate(preset.mode);
}

function confirmDeletion(preset) {
  deleteId = preset.id;
  const dialog = byId("delete-dialog");
  dialog.returnValue = "";
  text("delete-description", `“${preset.name}” will be removed from your saved timers.`);
  dialog.showModal();
}

function deletePreset() {
  presets = presets.filter((preset) => preset.id !== deleteId);
  for (const key of Object.keys(modeNames)) {
    if (selected[key] === deleteId) delete selected[key];
  }
  announce("Timer deleted.");
  persist();
  drawPresets();
  byId("more-title").focus();
}

const settingsForm = byId("settings-form");

function drawSettings() {
  for (const [key, value] of Object.entries(settings)) {
    const control = settingsForm.elements.namedItem(key);
    if (!control) continue;
    if (control.type === "checkbox") control.checked = value;
    else control.value = value;
  }
  text("volume-value", `${settings.volume}%`);
  document.body.classList.toggle("pale", settings.pale);
}

function changeSetting(event) {
  const { name, value, type, checked } = event.target;
  if (!Object.hasOwn(DEFAULT_SETTINGS, name)) return;
  settings[name] = type === "checkbox" ? checked : type === "range" ? Number(value) : value;
  if (["voice", "sound", "volume"].includes(name)) {
    cues.stop();
    if (settings.voice) cues.prepare(true);
  }
  drawSettings();
  drawLaps();
  syncWake(true);
  persist();
}

function drawInstall() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  const firefox = /Firefox/i.test(navigator.userAgent);
  const desktopSafari = /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg/i.test(navigator.userAgent);
  let steps = "Look for Install app or Add to Home Screen in your browser menu.";
  if (standalone) steps = "Sports Timer is open as an installed app.";
  else if (appleMobile) steps = "Open the browser’s Share menu and choose Add to Home Screen. Leave Open as Web App enabled if shown.";
  else if (android && firefox) steps = "Open the Firefox menu, tap Install, then add Sports Timer to your Home Screen.";
  else if (android) steps = "Open the Chrome menu and select Install and create shortcut, then Install. Some versions show Add to Home screen.";
  else if (desktopSafari) steps = "In Safari, choose File → Add to Dock.";
  else if (installPrompt) steps = "Install Sports Timer to open it in its own window.";

  text("install-steps", steps);
  byId("install-button").hidden = standalone || !installPrompt;
  text("offline-status", offlineStatus);
}

async function installApp() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = undefined;
  try {
    await prompt.prompt();
  } catch {
    announce("Use your browser menu to install Sports Timer.");
  }
  drawInstall();
}

async function setupOffline() {
  const updateStatus = (status) => {
    offlineStatus = status;
    drawInstall();
  };
  if (!("serviceWorker" in navigator)) {
    updateStatus("Offline access unavailable");
    return;
  }
  if (navigator.serviceWorker.controller) updateStatus("Available offline");
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (navigator.serviceWorker.controller) updateStatus("Available offline");
  });
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    if (registration.active) updateStatus("Available offline");
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "redundant" && !registration.active) updateStatus("Offline setup failed");
    });
  } catch {
    if (!navigator.serviceWorker.controller) updateStatus("Offline access unavailable");
  }
}

const actions = {
  settings: () => {
    if (view === "settings") return;
    settingsReturn = view;
    swapView("settings");
  },
  "close-settings": () => swapView(settingsReturn),
  "edit-timer": () => {
    const preset = selectedPreset(mode);
    openEditor(preset ? "preset" : "base", preset);
  },
  "return-workout": () => navigate(interval.mode),
  "interval-main": toggleInterval,
  "interval-reset": resetInterval,
  "interval-skip": skipInterval,
  "stopwatch-main": toggleStopwatch,
  "stopwatch-lap": addLap,
  "stopwatch-reset": resetStopwatch,
  "new-timer": () => openEditor("new"),
  "close-editor": closeEditor,
  "save-as": saveAs,
  install: installApp,
  "preview-cues": () => { cues.prepare(settings.voice); cues.play("work", settings); },
  "load-default": (button) => loadPreset({ mode: button.dataset.defaultMode }),
  "open-preset": loadPreset,
  "edit-preset": (preset) => openEditor("preset", preset),
  "delete-preset": confirmDeletion,
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) {
    const row = button.closest("[data-preset]");
    const preset = row && presets.find((item) => item.id === row.dataset.preset);
    actions[button.dataset.action]?.(preset ?? button);
    return;
  }

  const link = event.target.closest(".tab-bar a, .brand");
  if (link && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    navigate(link.dataset.mode ?? "rounds");
  }
});

byId("delete-dialog").addEventListener("close", (event) => {
  if (event.target.returnValue === "delete") deletePreset();
});
byId("timer-form").addEventListener("submit", saveTimer);
byId("duration-list").addEventListener("input", refreshEditor);
byId("preset-mode").addEventListener("change", (event) => {
  editor.mode = event.target.value;
  renderEditorFields(baseTimers[editor.mode]);
  refreshEditor();
});
settingsForm.addEventListener("input", changeSetting);
settingsForm.addEventListener("submit", (event) => event.preventDefault());

window.addEventListener("hashchange", () => setMode(readMode()));
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  drawInstall();
});
window.addEventListener("appinstalled", () => {
  installPrompt = undefined;
  drawInstall();
});
const syncVisibility = () => {
  syncInterval(true);
  drawStopwatch();
  syncWake(true);
};
document.addEventListener("visibilitychange", syncVisibility);
window.addEventListener("pageshow", syncVisibility);
document.addEventListener("pointerdown", () => {
  if (interval?.startedAt != null && (settings.sound || settings.voice)) cues.prepare(settings.voice);
  syncWake(true);
});

drawSettings();
drawLaps();
setMode(mode, false);
setupOffline();
