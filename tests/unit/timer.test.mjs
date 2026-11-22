import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTimeline, DEFAULT_TIMERS, elapsedTime, formatTime, stopwatchValue, validTimer, workoutFrame,
} from "../../timer.mjs";

const config = { prepare: 2, work: 3, rest: 2, rounds: 2, cooldown: 1 };

test("accepts both minimum and maximum supported interval values", () => {
  assert.ok(validTimer({ prepare: 0, work: 1, rest: 0, rounds: 1, cooldown: 0 }));
  assert.ok(validTimer({ prepare: 3599, work: 3599, rest: 3599, rounds: 99, cooldown: 3599 }));
});

test("rejects incomplete timers, invalid rounds and durations outside the editor range", () => {
  const invalid = [
    null, {}, { ...config, prepare: -1 }, { ...config, work: 0 }, { ...config, rest: 3600 },
    { ...config, cooldown: 0.5 }, { ...config, rounds: 0 }, { ...config, rounds: 100 },
    { ...config, rounds: "2" }, { ...config, rounds: NaN },
  ];

  for (const timer of invalid) {
    assert.ok(!validTimer(timer), JSON.stringify(timer));
  }
});

test("keeps the advertised defaults at 9:20 for Rounds and 4:00 for Tabata", () => {
  assert.equal(buildTimeline(DEFAULT_TIMERS.rounds).total, 560_000);
  assert.equal(buildTimeline(DEFAULT_TIMERS.tabata).total, 240_000);
});

test("builds contiguous phases with rest between work rounds only", () => {
  assert.deepEqual(buildTimeline(config), {
    phases: [
      { kind: "prepare", round: 0, start: 0, end: 2000 },
      { kind: "work", round: 1, start: 2000, end: 5000 },
      { kind: "rest", round: 1, start: 5000, end: 7000 },
      { kind: "work", round: 2, start: 7000, end: 10_000 },
      { kind: "cooldown", round: 2, start: 10_000, end: 11_000 },
    ],
    total: 11_000,
    rounds: 2,
  });
});

test("omits optional phases set to zero, including a one-round workout", () => {
  const { phases, total } = buildTimeline({ prepare: 0, work: 1, rest: 0, rounds: 1, cooldown: 0 });
  assert.deepEqual(phases, [{ kind: "work", round: 1, start: 0, end: 1000 }]);
  assert.equal(total, 1000);
});

test("handles the full 99-round range without adding a final rest", () => {
  const timeline = buildTimeline({ prepare: 1, work: 3599, rest: 3599, rounds: 99, cooldown: 1 });
  assert.equal(timeline.phases.filter(({ kind }) => kind === "work").length, 99);
  assert.equal(timeline.phases.filter(({ kind }) => kind === "rest").length, 98);
  assert.equal(timeline.total, (3599 * 197 + 2) * 1000);
  assert.equal(timeline.phases.at(-2).round, 99);
});

test("changes phases exactly at their boundary and exposes the upcoming interval", () => {
  const timeline = buildTimeline(config);
  assert.equal(workoutFrame(timeline, 1999).remaining, 1);
  assert.deepEqual(workoutFrame(timeline, 2000), {
    kind: "work",
    index: 1,
    round: 1,
    next: { kind: "rest", round: 1, start: 5000, end: 7000 },
    remaining: 3000,
    totalRemaining: 9000,
    progress: 0,
    phaseEnd: 5000,
  });
  assert.equal(workoutFrame(timeline, 5000).kind, "rest");
  assert.equal(workoutFrame(timeline, 7000).round, 2);
});

test("derives phase progress from elapsed time, even when updates were missed", () => {
  const timeline = buildTimeline(config);
  const frame = workoutFrame(timeline, 8500);
  assert.equal(frame.kind, "work");
  assert.equal(frame.round, 2);
  assert.equal(frame.progress, 0.5);
  assert.equal(frame.remaining, 1500);
  assert.equal(frame.totalRemaining, 2500);
  assert.equal(frame.next.kind, "cooldown");
});

test("holds the completed state on and after the end boundary", () => {
  const timeline = buildTimeline(config);
  const finished = {
    kind: "finished", index: 5, round: 2, next: undefined,
    remaining: 0, totalRemaining: 0, progress: 1, phaseEnd: 11_000,
  };
  assert.deepEqual(workoutFrame(timeline, 11_000), finished);
  assert.deepEqual(workoutFrame(timeline, 3_600_000), finished);
});

test("paused clocks keep their accumulated time and running clocks use their start time", () => {
  assert.equal(elapsedTime({ elapsed: 1500, startedAt: null }, 100_000), 1500);
  assert.equal(elapsedTime({ elapsed: 1500, startedAt: 10_000 }, 13_000), 4500);
  assert.equal(elapsedTime({ elapsed: 1500, startedAt: 10_000 }, 9000), 1500);
});

test("formats padded, compact, and multi-hour times", () => {
  assert.equal(formatTime(-1), "00:00");
  assert.equal(formatTime(4.9), "00:04");
  assert.equal(formatTime(4, "compact"), "0:04");
  assert.equal(formatTime(3609), "1:00:09");
  assert.equal(formatTime(360_009, "compact"), "100:00:09");
});

test("formats stopwatch hundredths consistently across a second boundary", () => {
  assert.deepEqual(stopwatchValue(999), { time: "00:00", fraction: ".99" });
  assert.deepEqual(stopwatchValue(1000), { time: "00:01", fraction: ".00" });
  assert.deepEqual(stopwatchValue(61_257, "compact"), { time: "1:01", fraction: ".25" });
});
