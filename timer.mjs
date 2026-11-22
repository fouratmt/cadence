export const DEFAULT_TIMERS = {
  rounds: { prepare: 0, work: 60, rest: 10, rounds: 8, cooldown: 10 },
  tabata: { prepare: 0, work: 20, rest: 10, rounds: 8, cooldown: 10 },
};

export const DEFAULT_SETTINGS = {
  sound: true,
  soundStyle: "bell",
  voice: false,
  flash: false,
  wake: true,
  pale: false,
  volume: 65,
  timeFormat: "padded",
};

export const PHASE_NAMES = {
  prepare: "Prepare",
  work: "Work",
  rest: "Rest",
  cooldown: "Cooldown",
  finished: "Complete",
};

export const pad = (value) => String(value).padStart(2, "0");

export function validTimer(config) {
  return config && ["prepare", "work", "rest", "cooldown"].every((field) =>
    Number.isInteger(config[field]) && config[field] >= (field === "work" ? 1 : 0) && config[field] <= 3599
  ) && Number.isInteger(config.rounds) && config.rounds >= 1 && config.rounds <= 99;
}

export function buildTimeline(config) {
  const phases = [];
  let total = 0;

  function add(kind, round, seconds) {
    if (seconds === 0) return;
    const start = total;
    total += seconds * 1000;
    phases.push({ kind, round, start, end: total });
  }

  add("prepare", 0, config.prepare);
  for (let round = 1; round <= config.rounds; round++) {
    add("work", round, config.work);
    if (round < config.rounds) add("rest", round, config.rest);
  }
  add("cooldown", config.rounds, config.cooldown);
  return { phases, total, rounds: config.rounds };
}

export function elapsedTime(clock, now = Date.now()) {
  const running = clock.startedAt === null ? 0 : Math.max(0, now - clock.startedAt);
  return clock.elapsed + running;
}

export function workoutFrame(timeline, elapsed) {
  const index = timeline.phases.findIndex((phase) => elapsed < phase.end);

  if (index < 0) {
    return {
      kind: "finished", index: timeline.phases.length, round: timeline.rounds,
      next: undefined, remaining: 0, totalRemaining: 0, progress: 1, phaseEnd: timeline.total,
    };
  }

  const phase = timeline.phases[index];
  const remaining = phase.end - elapsed;
  return {
    kind: phase.kind,
    index,
    round: phase.round,
    next: timeline.phases[index + 1],
    remaining,
    totalRemaining: timeline.total - elapsed,
    progress: 1 - remaining / (phase.end - phase.start),
    phaseEnd: phase.end,
  };
}

export function formatTime(seconds, timeFormat = "padded") {
  const whole = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const remainder = pad(whole % 60);
  if (hours > 0) return `${hours}:${pad(minutes)}:${remainder}`;
  return `${timeFormat === "compact" ? minutes : pad(minutes)}:${remainder}`;
}

export function stopwatchValue(elapsed, timeFormat) {
  return {
    time: formatTime(elapsed / 1000, timeFormat),
    fraction: `.${pad(Math.floor(elapsed / 10) % 100)}`,
  };
}
