import { expect, test, trackScheduledAudio } from "./fixtures.mjs";

async function openWithClock(page, path = "./") {
  const start = new Date("2026-01-01T12:00:00Z");
  await page.clock.install({ time: start });
  await page.goto(path);
  await page.clock.pauseAt(new Date(start.getTime() + 60_000));
}

test("plays iPhone Home Screen cues through the media element unlocked by Start", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone) AppleWebKit FxiOS" });
    Object.defineProperty(navigator, "standalone", { value: true });
    Object.defineProperty(navigator, "audioSession", { value: { type: "auto" } });
    localStorage.setItem("cadence:v1", JSON.stringify({
      settings: { soundStyle: "sport", volume: 60 },
      baseTimers: { rounds: { prepare: 0, work: 4, rest: 0, cooldown: 0, rounds: 1 } },
    }));
    window.AudioContext = class { constructor() { throw new Error("Live audio unavailable"); } };
    window.mediaClips = [];
    let unlocked = new WeakSet();
    let hidden = false;
    Object.defineProperty(document, "hidden", { get: () => hidden });
    window.interruptMedia = () => {
      unlocked = new WeakSet();
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    HTMLMediaElement.prototype.play = function () {
      if (!unlocked.has(this) && !navigator.userActivation.isActive) {
        return Promise.reject(new DOMException("A tap is required", "NotAllowedError"));
      }
      unlocked.add(this);
      window.mediaClips.push(fetch(this.src).then(async (response) => {
        const audio = new DataView(await response.arrayBuffer());
        const samples = audio.getUint32(40, true) / 2;
        let peak = 0;
        for (let index = 0; index < samples; index++) {
          peak = Math.max(peak, Math.abs(audio.getInt16(44 + index * 2, true)) / 32767);
        }
        return { seconds: samples / audio.getUint32(24, true), peak };
      }));
      return Promise.resolve();
    };
  });
  await openWithClock(page);
  const clips = () => page.evaluate(() => Promise.all(window.mediaClips));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await button("Start").click();
  await expect.poll(async () => (await clips()).length).toBe(2);
  const [activation, work] = await clips();
  expect(activation.peak).toBe(0);
  expect(work.seconds).toBeCloseTo(.697, 2);
  expect(work.peak).toBeCloseTo(.63 * .78 * .6, 2);
  expect(await page.evaluate(() => navigator.audioSession.type)).toBe("playback");

  for (const count of [3, 4, 5]) {
    await page.clock.runFor(1000);
    await expect.poll(async () => (await clips()).length).toBe(count);
    const bip = (await clips()).at(-1);
    expect(bip.seconds).toBeCloseTo(.09, 2);
    expect(bip.peak).toBeGreaterThan(.1);
  }
  await page.clock.runFor(1000);
  await expect(page.locator("#phase-name")).toHaveText("Complete");
  await expect.poll(async () => (await clips()).length).toBe(6);
  expect((await clips()).at(-1).seconds).toBeGreaterThan(.5);

  await page.evaluate(() => window.interruptMedia());
  await button("Settings").click();
  await button("Preview").click();
  await expect.poll(async () => (await clips()).length).toBe(8);
  expect((await clips()).at(-1).seconds).toBeCloseTo(.697, 2);
});

test("sounds one bip at 3, 2, and 1 seconds before the next phase bell", async ({ page }) => {
  const scheduled = await trackScheduledAudio(page);
  const audio = async () => (await scheduled()).map(({ kind, time }) => ({ kind, time }));
  await openWithClock(page);
  const button = (name) => page.getByRole("button", { name, exact: true });
  await button("Start").click();
  await expect.poll(async () => (await audio()).map(({ kind }) => kind)).toEqual(["bell", "bell", "bell"]);

  await page.clock.fastForward(56_000);
  await expect(page.locator("#phase-time")).toHaveText("00:04");
  expect(await audio()).toHaveLength(3);
  const countdownStart = await page.evaluate(() => Date.now() + 1000);

  await page.clock.runFor(1000);
  await button("Pause").click();
  await page.clock.runFor(5000);
  await button("Resume").click();
  expect((await audio()).slice(3)).toEqual([{ kind: "bip", time: countdownStart }]);

  await page.getByRole("link", { name: "Stopwatch", exact: true }).click();
  await page.clock.runFor(3000);
  await expect.poll(async () => (await audio()).slice(3)).toEqual([
    { kind: "bip", time: countdownStart },
    { kind: "bip", time: countdownStart + 6000 },
    { kind: "bip", time: countdownStart + 7000 },
    { kind: "bell", time: countdownStart + 8000 },
    { kind: "bell", time: countdownStart + 8000 },
  ]);
});

test("runs prepare, work, rest, and cooldown with pause, reload, skip, and reset", async ({ page }) => {
  await openWithClock(page, "./#tabata");
  const phase = page.locator("#phase-name");
  const time = page.locator("#phase-time");
  const button = (name) => page.getByRole("button", { name, exact: true });
  await expect(time).toHaveText("00:05");
  await expect(page.locator("#workout-total")).toHaveText("18:50");
  await expect(page.locator("#workout-total-label")).toHaveText("Workout total");

  await button("Edit timer").click();
  for (const [name, seconds] of [["Prepare", "2"], ["Work", "3"], ["Rest", "2"], ["Cooldown", "1"]]) {
    await page.getByRole("group", { name, exact: true }).getByLabel("Sec").fill(seconds);
  }
  await page.getByRole("group", { name: "Rounds", exact: true }).getByLabel("Count").fill("2");
  await page.getByRole("group", { name: "Cycles", exact: true }).getByLabel("Count").fill("1");
  await expect(page.locator("#editor-total")).toHaveText("00:11");
  await button("Save timer").click();
  await expect(phase).toHaveText("Prepare");

  await button("Start").click();
  await page.clock.runFor(2000);
  await expect(phase).toHaveText("Work");
  await expect(page.locator("#next-name")).toHaveText("Rest");
  await expect(page.locator("#workout-total-label")).toHaveText("Workout left");
  await expect(page.locator("#workout-total")).toHaveText("00:09");
  await expect(button("Edit timer")).toBeHidden();
  await page.clock.runFor(1000);
  await expect(time).toHaveText("00:02");
  await button("Pause").click();
  await page.clock.fastForward(60_000);
  await page.reload();

  await expect(phase).toHaveText("Work");
  await expect(time).toHaveText("00:02");
  await expect(page.locator("#phase-status")).toHaveText("Paused");
  await button("Skip interval").click();
  await expect(phase).toHaveText("Rest");
  await expect(button("Resume")).toBeEnabled();

  await button("Resume").click();
  await page.clock.runFor(2000);
  await expect(phase).toHaveText("Work");
  await expect(page.locator("#round-current")).toHaveText("02");
  await expect(page.locator("#next-name")).toHaveText("Cooldown");
  await page.clock.runFor(3000);
  await expect(phase).toHaveText("Cooldown");
  await page.clock.runFor(1000);
  await expect(phase).toHaveText("Complete");
  await expect(time).toHaveText("00:00");
  await expect(button("Skip interval")).toBeDisabled();

  await button("Restart").click();
  await expect(phase).toHaveText("Prepare");
  await button("Reset timer").click();
  await expect(button("Start")).toBeEnabled();
  await expect(time).toHaveText("00:02");
});

test("saves Tabata cycles and starts a new round after cycle recovery", async ({ page }) => {
  await openWithClock(page, "./#tabata");
  const button = (name) => page.getByRole("button", { name, exact: true });
  const field = (name) => page.getByRole("group", { name, exact: true });
  await button("Edit timer").click();
  await expect(field("Cycles").getByLabel("Count")).toHaveValue("3");
  await expect(field("Rest between cycles").getByLabel("Sec")).toHaveValue("30");
  for (const [name, seconds] of [["Prepare", "0"], ["Work", "2"], ["Rest between cycles", "3"], ["Cooldown", "0"]]) {
    await field(name).getByLabel("Sec").fill(seconds);
  }
  await field("Rounds").getByLabel("Count").fill("1");
  await field("Cycles").getByLabel("Count").fill("2");
  await button("Save timer").click();
  await page.reload();
  await expect(page.locator("#workout-total")).toHaveText("00:07");
  await expect(page.locator("#cycle-summary")).toHaveText("Cycle 1 / 2");
  await button("Start").click();
  await page.clock.runFor(2000);
  await expect(page.locator("#phase-name")).toHaveText("Rest between cycles");
  await expect(page.locator("#phase-time")).toHaveText("00:03");
  await page.clock.runFor(3000);
  await expect(page.locator("#cycle-summary")).toHaveText("Cycle 2 / 2");
  await expect(page.locator("#round-current")).toHaveText("01");
  await page.clock.runFor(2000);
  await expect(page.locator("#phase-name")).toHaveText("Complete");
});

test("catches up after an interruption and protects an active workout when changing modes", async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "hidden", { get: () => hidden });
    window.setWorkoutHidden = (value) => {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    window.wakeRequests = [];
    Object.defineProperty(navigator, "wakeLock", {
      value: { async request(type) {
        window.wakeRequests.push(type);
        const sentinel = new EventTarget();
        sentinel.release = async () => window.wakeRequests.push("release");
        return sentinel;
      } },
    });
  });
  await openWithClock(page);
  const start = page.getByRole("button", { name: "Start", exact: true });
  await start.click();
  await expect.poll(() => page.evaluate(() => window.wakeRequests)).toEqual(["screen"]);

  await page.evaluate(() => window.setWorkoutHidden(true));
  await page.clock.fastForward(65_000);
  await page.evaluate(() => window.setWorkoutHidden(false));
  await expect(page.locator("#phase-name")).toHaveText("Rest");
  await expect(page.locator("#phase-time")).toHaveText("00:05");
  await expect.poll(() => page.evaluate(() => window.wakeRequests)).toEqual(["screen", "release", "screen"]);

  await page.getByRole("link", { name: "Tabata", exact: true }).click();
  await expect(start).toBeHidden();
  await page.getByRole("button", { name: "Return to workout" }).click();
  await expect(page.getByRole("heading", { name: "Rounds", exact: true })).toBeVisible();
  await expect(page.locator("#phase-time")).toHaveText("00:05");

  await page.clock.fastForward(600_000);
  await expect(page.locator("#phase-name")).toHaveText("Complete");
  await expect.poll(() => page.evaluate(() => window.wakeRequests)).toEqual(["screen", "release", "screen", "release"]);
});

test("records split and total stopwatch times, restores laps after reload, and resets", async ({ page }) => {
  await openWithClock(page, "./#stopwatch");
  const button = (name) => page.getByRole("button", { name, exact: true });
  const time = page.getByRole("timer");
  await button("Edit timer").click();
  for (const name of ["Prepare", "Time lap"]) {
    await page.getByRole("group", { name, exact: true }).getByLabel("Sec").fill("0");
  }
  await button("Save timer").click();
  await expect(button("Lap")).toBeDisabled();
  await button("Start").click();
  await page.clock.runFor(1250);
  await button("Lap").click();
  await page.clock.runFor(1500);
  await button("Lap").click();
  await button("Pause").click();

  await expect(page.locator("#latest-split")).toHaveText("00:01.50");
  await expect(page.locator("#latest-total")).toHaveText("00:02.75");
  await button("Lap history").click();
  const laps = page.getByRole("table");
  await expect(laps.getByRole("row").nth(1).getByRole("cell")).toHaveText(["02", "00:01.50", "00:02.75"]);
  await expect(laps.getByRole("row").nth(2).getByRole("cell")).toHaveText(["01", "00:01.25", "00:01.25"]);
  await button("Back").click();
  await expect(time).toHaveText("00:02.75");

  await page.clock.fastForward(60_000);
  await page.reload();
  await expect(time).toHaveText("00:02.75");
  await button("Lap history").click();
  await expect(laps.getByRole("row")).toHaveCount(3);
  await button("Back").click();

  await button("Resume").click();
  await page.clock.runFor(1250);
  await button("Pause").click();
  await expect(time).toHaveText("00:04.00");
  await button("Reset stopwatch").click();
  await expect(time).toHaveText("00:00.00");
  await expect(button("Lap history")).toBeHidden();
});

test("counts down before starting the stopwatch and rings at each timed lap", async ({ page }) => {
  const audio = await trackScheduledAudio(page);
  await openWithClock(page, "./#stopwatch");
  const button = (name) => page.getByRole("button", { name, exact: true });
  const time = page.getByRole("timer");
  await button("Edit timer").click();
  const field = (name) => page.getByRole("group", { name, exact: true }).getByLabel("Sec");
  await expect(field("Prepare")).toHaveValue("5");
  await expect(field("Time lap")).toHaveValue("10");
  await field("Time lap").fill("4");
  await button("Save as new timer").click();
  await page.getByLabel("Timer name").fill("Timed laps");
  await button("Save timer").click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Timed laps" })).toBeVisible();
  await expect(time).toHaveText("00:05");
  await button("Start").click();
  await expect(button("Lap")).toBeDisabled();
  const sounds = async () => (await audio()).map(({ kind }) => kind);
  await page.clock.runFor(2000);
  await expect.poll(sounds).toEqual(["bip"]);
  await page.clock.runFor(3000);
  await expect(time).toHaveText("00:00.00");
  await expect(button("Lap")).toBeEnabled();
  const start = ["bip", "bip", "bip", "bell", "bell", "bell"];
  await expect.poll(sounds).toEqual(start);

  await page.clock.runFor(4000);
  await expect.poll(sounds).toEqual([...start, "bell", "bell"]);
  await expect(button("Lap history")).toBeHidden();
  await button("Lap").click();
  await expect(page.locator("#latest-split")).toHaveText("00:04.00");
  await expect(page.locator("#latest-total")).toHaveText("00:04.00");
  await page.clock.runFor(4000);
  await expect.poll(sounds).toEqual([...start, "bell", "bell", "bell", "bell"]);
});
