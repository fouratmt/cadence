import { expect, test } from "./fixtures.mjs";

async function openWithClock(page, path = "./") {
  const start = new Date("2026-01-01T12:00:00Z");
  await page.clock.install({ time: start });
  await page.goto(path);
  await page.clock.pauseAt(new Date(start.getTime() + 60_000));
}

test("runs prepare, work, rest, and cooldown with pause, reload, skip, and reset", async ({ page }) => {
  await openWithClock(page, "./#tabata");
  const phase = page.locator("#phase-name");
  const time = page.locator("#phase-time");
  const button = (name) => page.getByRole("button", { name, exact: true });
  await expect(time).toHaveText("00:20");
  await expect(page.locator("#workout-total")).toHaveText("04:00");

  await button("Edit timer").click();
  for (const [name, seconds] of [["Prepare", "2"], ["Work", "3"], ["Rest", "2"], ["Cooldown", "1"]]) {
    await page.getByRole("group", { name, exact: true }).getByLabel("Sec").fill(seconds);
  }
  await page.getByRole("group", { name: "Rounds", exact: true }).getByLabel("Count").fill("2");
  await expect(page.locator("#editor-total")).toHaveText("00:11");
  await button("Save timer").click();
  await expect(phase).toHaveText("Prepare");

  await button("Start").click();
  await page.clock.runFor(2000);
  await expect(phase).toHaveText("Work");
  await expect(page.locator("#next-name")).toHaveText("Rest");
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
  await expect(start).toBeDisabled();
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
  await expect(button("Lap")).toBeDisabled();
  await button("Start").click();
  await page.clock.runFor(1250);
  await button("Lap").click();
  await page.clock.runFor(1500);
  await button("Lap").click();
  await button("Pause").click();

  const laps = page.getByRole("table");
  await expect(laps.getByRole("row").nth(1).getByRole("cell")).toHaveText(["02", "00:01.50", "00:02.75"]);
  await expect(laps.getByRole("row").nth(2).getByRole("cell")).toHaveText(["01", "00:01.25", "00:01.25"]);
  await expect(time).toHaveText("00:02.75");

  await page.clock.fastForward(60_000);
  await page.reload();
  await expect(time).toHaveText("00:02.75");
  await expect(laps.getByRole("row")).toHaveCount(3);

  await button("Resume").click();
  await page.clock.runFor(1250);
  await button("Pause").click();
  await expect(time).toHaveText("00:04.00");
  await button("Reset stopwatch").click();
  await expect(time).toHaveText("00:00.00");
  await expect(laps).toBeHidden();
});
