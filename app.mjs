import {
  buildTimeline, DEFAULT_SETTINGS, DEFAULT_TIMERS, elapsedTime, formatTime,
  pad, PHASE_NAMES, stopwatchFrame, stopwatchValue, validTimer, workoutFrame,
} from "./timer.mjs";
import { ScreenAwake, WorkoutCues } from "./cues.mjs";
import { setupPwa } from "./pwa.mjs";

const byId = (id) => document.getElementById(id);
const modes = ["rounds", "tabata", "stopwatch", "more"];
const modeNames = { rounds: "Rounds", tabata: "Tabata", stopwatch: "Stopwatch" };
const intervalModes = ["rounds", "tabata"];
const storageKey = "cadence:v1";
const sessionKey = "cadence:session:v1";
const installKey = "cadence:install-prompt";
const fields = {
  rounds: ["prepare", "work", "rest", "rounds", "cooldown"],
  tabata: ["prepare", "work", "rest", "rounds", "cycles", "cycleRest", "cooldown"],
  stopwatch: ["prepare", "timeLap"],
};
const fieldLabels = { ...PHASE_NAMES, rounds: "Rounds", cycles: "Cycles", timeLap: "Time lap" };
const fieldDetails = {
  prepare: "Countdown before the timer starts.",
  cycles: "Repeat the full set of rounds.",
  cycleRest: "Recovery between sets of rounds.",
  timeLap: "Ring at each timed lap. Set to zero to turn it off.",
};
const countFields = ["rounds", "cycles"];

function read(storageName, key, previousKey) {
  try {
    const storage = window[storageName];
    const saved = storage.getItem(key);
    if (saved !== null) return JSON.parse(saved) ?? {};

    const previous = previousKey ? storage.getItem(previousKey) : null;
    if (previous === null) return {};
    const data = JSON.parse(previous) ?? {};
    write(storageName, key, data);
    return data;
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

const stored = read("localStorage", storageKey, "sports-timer:v1");
const settings = { ...DEFAULT_SETTINGS, ...stored.settings };
const baseTimers = Object.fromEntries(Object.entries(DEFAULT_TIMERS).map(([key, config]) =>
  [key, validTimer(stored.baseTimers?.[key], key) ? stored.baseTimers[key] : config]
));
let presets = Array.isArray(stored.presets) ? stored.presets.filter((preset) =>
  typeof preset?.name === "string" && typeof preset.id === "string" &&
  Object.hasOwn(modeNames, preset.mode) && validTimer(preset.config, preset.mode)
) : [];
const selected = { ...stored.selected };

function persist() {
  if (!write("localStorage", storageKey, { settings, baseTimers, presets, selected })) {
    announce("Device storage is unavailable. Changes will last until this page closes.");
  }
}

const savedSession = read("sessionStorage", sessionKey, "sports-timer:session:v1");
const savedInterval = savedSession.interval;
let interval = intervalModes.includes(savedInterval?.mode) && validTimer(savedInterval.config)
  ? { ...savedInterval, timeline: buildTimeline(savedInterval.config) }
  : null;
let stopwatch = { elapsed: 0, startedAt: null, laps: [], ...savedSession.stopwatch };
if (!validTimer(stopwatch.config, "stopwatch")) {
  // Sessions saved before stopwatch settings measured elapsed time from zero.
  stopwatch.config = stopwatch.startedAt !== null || stopwatch.elapsed > 0 || stopwatch.laps.length
    ? { prepare: 0, timeLap: 0 } : undefined;
}
let mode = readMode();
let view = intervalModes.includes(mode) ? "interval" : mode;
let editor;
let editorReturn;
let settingsReturn;
let deleteId;
let intervalTimeout;
let stopwatchAnimation;
let stopwatchTimeout;
let lastStopwatchCue = stopwatch.config ? stopwatchFrame(stopwatch.config, elapsedTime(stopwatch)).cueAt : undefined;
const savedFrame = interval && workoutFrame(interval.timeline, elapsedTime(interval));
let lastIndex = savedFrame?.index ?? -1;
let lastCountdownSecond = Math.ceil((savedFrame?.remaining ?? 0) / 1000);
let lastRoundTrack = "";
const cues = new WorkoutCues();
const stopwatchCues = new WorkoutCues();
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
  swapView(intervalModes.includes(mode) ? "interval" : mode, focus);
}

function swapView(next, focus = true) {
  const changed = view !== next;
  view = next;
  for (const name of ["interval", "stopwatch", "laps", "more", "editor", "settings"]) {
    byId(`${name}-view`).hidden = name !== next;
  }
  for (const link of document.querySelectorAll(".tab-bar a")) {
    if (link.dataset.mode === mode) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  syncInterval(true);
  syncStopwatch();
  if (view === "more") drawPresets();
  if (view === "laps") drawLaps();
  if (focus) {
    byId(`${view}-title`).focus({ preventScroll: true });
    if (changed) byId("main").scrollTop = 0;
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
  byId("interval-detail").hidden = otherActive;
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
  byId("cycle-summary").hidden = timeline.cycles === 1;
  text("cycle-progress", `${frame.cycle} / ${timeline.cycles}`);
  drawRoundTrack(frame.round, timeline.rounds, finished);

  setMainButton("interval-main", finished ? "Restart" : running ? "Pause" : workout ? "Resume" : "Start");
  byId("return-workout").hidden = !otherActive;
  byId("interval-main").hidden = otherActive;
  byId("interval-skip").hidden = otherActive;
  byId("interval-reset").hidden = otherActive;
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
      lastCountdownSecond = 0;
    }
    if (frame.kind === "finished") {
      interval.elapsed = interval.timeline.total;
      interval.startedAt = null;
      saveSession();
    } else {
      const seconds = Math.ceil(frame.remaining / 1000);
      const toNextSecond = frame.remaining - (seconds - 1) * 1000;
      // Skip stale bips when the browser wakes up partway through a second.
      if (allowCue && seconds <= 3 && seconds !== lastCountdownSecond && toNextSecond >= 700) {
        cues.countdown(settings);
      }
      lastCountdownSecond = seconds;
      const delay = (document.hidden || view !== "interval") && seconds > 3
        ? frame.remaining - 3000 : toNextSecond;
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
    cues.prepare(settings);
    interval.startedAt = now;
  } else {
    const preset = selectedPreset(mode);
    const config = preset?.config ?? baseTimers[mode];
    interval = {
      mode, config, timeline: buildTimeline(config), name: preset?.name ?? modeNames[mode],
      elapsed: 0, startedAt: now,
    };
    cues.prepare(settings);
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
  if (!running) {
    lastIndex = frame.index + 1;
    lastCountdownSecond = 0;
  }
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
  const preset = selectedPreset("stopwatch");
  const config = stopwatch.config ?? preset?.config ?? baseTimers.stopwatch;
  const frame = stopwatchFrame(config, elapsedTime(stopwatch));
  const preparing = Boolean(frame.remaining);
  const value = preparing ? { time: time(Math.ceil(frame.remaining / 1000)), fraction: "" }
    : stopwatchValue(frame.elapsed, settings.timeFormat);
  text("stopwatch-title", stopwatch.name ?? preset?.name ?? modeNames.stopwatch);
  text("stopwatch-detail", config.timeLap ? `Lap cue every ${time(config.timeLap)}` : "Elapsed time and laps");
  text("stopwatch-phase", preparing ? "Prepare" : "Elapsed");
  const panel = byId("stopwatch-panel");
  const phase = preparing ? "prepare" : "stopwatch";
  if (panel.dataset.phase !== phase) panel.dataset.phase = phase;
  text("stopwatch-time", value.time);
  text("stopwatch-fraction", value.fraction);
  setClockSize(byId("stopwatch-time").parentElement, value.time);
  const running = stopwatch.startedAt !== null;
  const hasStarted = Boolean(stopwatch.config);

  text("stopwatch-status", running ? "Running" : hasStarted ? "Paused" : "Ready");
  setMainButton("stopwatch-main", running ? "Pause" : hasStarted ? "Resume" : "Start");
  byId("stopwatch-lap").disabled = !running || preparing;
  byId("stopwatch-reset").disabled = !hasStarted;
  byId("edit-stopwatch").disabled = hasStarted;
  if (running && !document.hidden) stopwatchAnimation = requestAnimationFrame(drawStopwatch);
}

function stopwatchAudioSettings() {
  return { ...settings, voice: false };
}

function syncStopwatch() {
  clearTimeout(stopwatchTimeout);
  drawStopwatch();
  if (stopwatch.startedAt === null) return;
  const elapsed = elapsedTime(stopwatch);
  const { cue, cueAt, nextCue } = stopwatchFrame(stopwatch.config, elapsed);
  if (cue && cueAt !== lastStopwatchCue && elapsed - cueAt <= 300) {
    const audio = stopwatchAudioSettings();
    if (cue === "countdown") stopwatchCues.countdown(audio);
    else stopwatchCues.play(cue, audio);
  }
  lastStopwatchCue = cueAt;
  if (nextCue !== undefined) stopwatchTimeout = setTimeout(syncStopwatch, Math.max(12, nextCue - elapsed));
}

function drawLaps() {
  const oneTime = (lap) => {
    const { time: whole, fraction } = stopwatchValue(lap, settings.timeFormat);
    return whole + fraction;
  };
  const { laps } = stopwatch;
  const count = laps.length;
  byId("laps-empty").hidden = count > 0;
  byId("latest-lap").hidden = count === 0;
  byId("show-laps").hidden = count === 0;
  text("latest-lap-title", count ? `Lap ${pad(count)}` : "Laps");
  if (count) {
    text("latest-split", oneTime(laps.at(-1) - (laps.at(-2) ?? 0)));
    text("latest-total", oneTime(laps.at(-1)));
  }
  if (view !== "laps") return;

  const rows = laps.map((lap, index) => {
    const row = document.createElement("tr");
    [pad(index + 1), oneTime(lap - (laps[index - 1] ?? 0)), oneTime(lap)].forEach((value) => {
      row.insertCell().textContent = value;
    });
    return row;
  });
  byId("laps").replaceChildren(...rows.reverse());
}

function toggleStopwatch() {
  if (stopwatch.startedAt === null) {
    if (!stopwatch.config) {
      const preset = selectedPreset("stopwatch");
      stopwatch.config = preset?.config ?? baseTimers.stopwatch;
      stopwatch.name = preset?.name;
      lastStopwatchCue = undefined;
    }
    stopwatchCues.prepare(stopwatchAudioSettings());
    stopwatch.startedAt = Date.now();
  } else {
    stopwatch.elapsed = elapsedTime(stopwatch);
    stopwatch.startedAt = null;
    stopwatchCues.stop();
  }
  saveSession();
  syncStopwatch();
  syncWake(true);
}

function addLap() {
  if (stopwatch.startedAt === null) return;
  const frame = stopwatchFrame(stopwatch.config, elapsedTime(stopwatch));
  if (frame.remaining) return;
  stopwatch.laps.push(frame.elapsed);
  saveSession();
  drawLaps();
  announce(`Lap ${stopwatch.laps.length} recorded.`);
}

function resetStopwatch() {
  stopwatch = { elapsed: 0, startedAt: null, laps: [] };
  stopwatchCues.stop();
  syncStopwatch();
  saveSession();
  drawLaps();
  syncWake();
}

function timerRunning() {
  return (interval?.startedAt != null && activeInterval()) || stopwatch.startedAt !== null;
}

function syncWake(retry = false) {
  screenAwake.update(settings.wake && timerRunning(), retry);
  pwa.refresh();
}

function drawWakeStatus(status) {
  const element = byId("wake-status");
  element.hidden = status !== "unavailable";
  element.lastElementChild.textContent = status === "unavailable"
    ? "Screen lock can interrupt audio cues."
    : "";
}

function renderEditorFields(config) {
  byId("duration-list").innerHTML = fields[editor.mode].map((field) => {
    const name = fieldLabels[field];
    const count = countFields.includes(field);
    const value = config[field] ?? (count ? 1 : 0);
    const detail = fieldDetails[field];
    const inputs = count
      ? `<label>Count<input data-timer-field="${field}" type="number" inputmode="numeric" min="1" max="99" value="${value}" required></label>`
      : `<label>Min<input data-timer-field="${field}" type="number" inputmode="numeric" min="0" max="59" value="${Math.floor(value / 60)}" required></label>
         <label>Sec<input data-timer-field="${field}" type="number" inputmode="numeric" min="0" max="59" value="${value % 60}" required></label>`;
    return `<div class="duration-row" role="group" aria-labelledby="field-${field}"${detail ? ` aria-describedby="detail-${field}"` : ""}>
      <div><span class="duration-title" id="field-${field}"><span class="phase-dot" data-phase="${field}"></span>${name}</span>
      ${detail ? `<small class="duration-detail" id="detail-${field}">${detail}</small>` : ""}</div>
      <div class="duration-inputs">${inputs}</div>
    </div>`;
  }).join("");
}

function editorConfig() {
  const config = {};
  for (const field of fields[editor.mode]) {
    const inputs = byId("duration-list").querySelectorAll(`[data-timer-field="${field}"]`);
    if (Array.from(inputs).some((input) => !input.validity.valid)) return null;
    const amount = inputs[0].valueAsNumber;
    config[field] = countFields.includes(field) ? amount : amount * 60 + inputs[1].valueAsNumber;
  }
  return config;
}

function refreshEditor() {
  const named = editor.kind !== "base";
  const creating = editor.kind === "new" || editor.kind === "copy";
  text("editor-title", creating ? "New timer" : modeNames[editor.mode]);
  byId("preset-fields").hidden = !named;
  byId("preset-name").required = named;
  byId("preset-mode").disabled = editor.kind !== "new";
  document.querySelector('[data-action="save-as"]').hidden = creating;
  byId("editor-note").hidden = true;
  const isStopwatch = editor.mode === "stopwatch";
  byId("editor-total-wrap").hidden = isStopwatch;
  const config = editorConfig();
  text("editor-total", !isStopwatch && validTimer(config, editor.mode) ? time(buildTimeline(config).total / 1000) : "—");
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
  if (!validTimer(config, editor.mode)) {
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
    if (editorReturn === "interval" || editorReturn === "stopwatch") {
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
  const detail = preset.mode === "stopwatch"
    ? (preset.config.timeLap ? `lap cue every ${time(preset.config.timeLap)}` : "manual laps")
    : time(buildTimeline(preset.config).total / 1000);
  item.querySelector("small").textContent = `${modeNames[preset.mode]} · ${detail}`;
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
  const isStopwatch = preset.mode === "stopwatch";
  if (isStopwatch && stopwatch.config) {
    navigate("stopwatch");
    announce("Reset the stopwatch before loading a different timer.");
    return;
  }
  if (!isStopwatch && activeInterval()) {
    navigate(interval.mode);
    announce("Reset the active workout before loading a different timer.");
    return;
  }
  if (preset.id) selected[preset.mode] = preset.id;
  else delete selected[preset.mode];
  if (!isStopwatch) resetInterval();
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
  if (["voice", "sound", "soundStyle", "volume"].includes(name)) {
    cues.stop();
    cues.prepare(settings);
    if (stopwatch.startedAt !== null) {
      stopwatchCues.stop();
      stopwatchCues.prepare(stopwatchAudioSettings());
    }
  }
  drawSettings();
  drawLaps();
  syncWake(true);
  persist();
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
  "show-laps": () => swapView("laps"),
  "close-laps": () => {
    swapView("stopwatch");
    byId("show-laps").focus({ preventScroll: true });
  },
  "new-timer": () => openEditor("new"),
  "close-editor": closeEditor,
  "save-as": saveAs,
  install: () => pwa.install(),
  "dismiss-install": () => pwa.dismissInstall(),
  update: () => pwa.applyUpdate(),
  "dismiss-update": () => pwa.dismissUpdate(),
  "preview-cues": () => { cues.prepare(settings); cues.play("work", settings); },
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
const syncVisibility = () => {
  syncInterval(true);
  syncStopwatch();
  syncWake(true);
};
document.addEventListener("visibilitychange", syncVisibility);
window.addEventListener("pageshow", syncVisibility);
document.addEventListener("pointerdown", () => {
  if (interval?.startedAt != null) cues.prepare(settings);
  if (stopwatch.startedAt !== null) stopwatchCues.prepare(stopwatchAudioSettings());
  syncWake(true);
});

const pwa = setupPwa({
  canReload: () => !timerRunning() && view !== "editor" && !(view === "settings" && settingsReturn === "editor"),
  openInstallGuide: () => {
    navigate("more");
    byId("install-title").focus();
    byId("install-title").scrollIntoView({ block: "nearest" });
  },
  installDismissed: read("localStorage", installKey).dismissed === true,
  onDismissInstall: () => write("localStorage", installKey, { dismissed: true }),
  announce,
});

drawSettings();
drawLaps();
setMode(mode, false);
