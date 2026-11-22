export const DEFAULT_TIMERS = {
  rounds: { prepare: 0, work: 60, rest: 10, rounds: 8, cooldown: 10 },
  tabata: { prepare: 5, work: 30, rest: 15, rounds: 8, cycles: 3, cycleRest: 30, cooldown: 30 },
  stopwatch: { prepare: 5, timeLap: 10 },
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
  cycleRest: "Rest between cycles",
  cooldown: "Cooldown",
  finished: "Complete",
};

export const pad = (value) => String(value).padStart(2, "0");

function inRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validTimer(config, mode) {
  if (!inRange(config?.prepare, 0, 3599)) return false;
  if (mode === "stopwatch") return inRange(config.timeLap, 0, 3599);
  return inRange(config.work, 1, 3599) && inRange(config.rest, 0, 3599) &&
    inRange(config.cooldown, 0, 3599) && inRange(config.rounds, 1, 99) &&
    inRange(config.cycles ?? 1, 1, 99) && inRange(config.cycleRest ?? 0, 0, 3599);
}

export function buildTimeline(config) {
  const phases = [];
  let total = 0;
  const cycles = config.cycles ?? 1;

  function add(kind, cycle, round, seconds) {
    if (seconds === 0) return;
    const start = total;
    total += seconds * 1000;
    phases.push({ kind, cycle, round, start, end: total });
  }

  add("prepare", 1, 0, config.prepare);
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (let round = 1; round <= config.rounds; round++) {
      add("work", cycle, round, config.work);
      if (round < config.rounds) add("rest", cycle, round, config.rest);
    }
    if (cycle < cycles) add("cycleRest", cycle, config.rounds, config.cycleRest ?? 0);
  }
  add("cooldown", cycles, config.rounds, config.cooldown);
  return { phases, total, rounds: config.rounds, cycles };
}

export function elapsedTime(clock, now = Date.now()) {
  const running = clock.startedAt === null ? 0 : Math.max(0, now - clock.startedAt);
  return clock.elapsed + running;
}

export function workoutFrame(timeline, elapsed) {
  const index = timeline.phases.findIndex((phase) => elapsed < phase.end);

  if (index < 0) {
    return {
      kind: "finished", index: timeline.phases.length, cycle: timeline.cycles, round: timeline.rounds,
      next: undefined, remaining: 0, totalRemaining: 0, progress: 1, phaseEnd: timeline.total,
    };
  }

  const phase = timeline.phases[index];
  const remaining = phase.end - elapsed;
  return {
    kind: phase.kind,
    index,
    cycle: phase.cycle,
    round: phase.round,
    next: timeline.phases[index + 1],
    remaining,
    totalRemaining: timeline.total - elapsed,
    progress: 1 - remaining / (phase.end - phase.start),
    phaseEnd: phase.end,
  };
}

export function stopwatchFrame(config, elapsed) {
  const start = config.prepare * 1000;
  const remaining = Math.max(0, start - elapsed);
  if (remaining > 3000) return { remaining, elapsed: 0, nextCue: start - 3000 };
  if (remaining > 0) {
    const cueAt = start - Math.ceil(remaining / 1000) * 1000;
    return { remaining, elapsed: 0, cue: "countdown", cueAt, nextCue: cueAt + 1000 };
  }

  const lap = config.timeLap * 1000;
  const running = elapsed - start;
  const laps = lap ? Math.floor(running / lap) : 0;
  const cueAt = start + laps * lap;
  return {
    remaining: 0, elapsed: running, cue: laps ? "rest" : start ? "work" : undefined,
    cueAt, nextCue: lap ? cueAt + lap : undefined,
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
