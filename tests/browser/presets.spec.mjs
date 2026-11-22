import { expect, test } from "./fixtures.mjs";

test("creates, renames, loads, copies, and deletes named presets", async ({ page }) => {
  await page.goto("./#more");
  const button = (name) => page.getByRole("button", { name, exact: true });
  const name = page.getByLabel("Timer name");
  const more = page.getByRole("link", { name: "More", exact: true });
  const savedTimer = (label) => page.getByRole("button", { name: new RegExp(`^${label} Tabata`) });

  await button("New timer").click();
  await page.getByLabel("Mode", { exact: true }).selectOption("tabata");
  await name.fill("  Speed work  ");
  await page.getByRole("group", { name: "Work", exact: true }).getByLabel("Sec").fill("15");
  await button("Save timer").click();
  await expect(savedTimer("Speed work")).toBeVisible();

  await button("Edit Speed work").click();
  await name.fill("Speed session");
  await button("Save timer").click();
  await savedTimer("Speed session").click();
  await expect(page.getByRole("heading", { name: "Speed session", exact: true })).toBeVisible();
  await expect(page.locator("#phase-time")).toHaveText("00:15");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Speed session", exact: true })).toBeVisible();

  await button("Edit timer").click();
  await button("Save as new timer").click();
  await expect(name).toHaveValue("Speed session copy");
  await name.fill("Warmup");
  await button("Save timer").click();
  await expect(page.getByRole("heading", { name: "Warmup", exact: true })).toBeVisible();

  await more.click();
  await expect(savedTimer("Speed session")).toBeVisible();
  await button("Delete Warmup").click();
  const dialog = page.getByRole("dialog", { name: "Delete timer?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(savedTimer("Warmup")).toBeVisible();

  await button("Delete Warmup").click();
  await dialog.getByRole("button", { name: "Delete timer", exact: true }).click();
  await expect(savedTimer("Warmup")).toHaveCount(0);
  await page.getByRole("link", { name: "Tabata", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tabata", exact: true })).toBeVisible();
  await expect(page.locator("#phase-time")).toHaveText("00:20");
});

test("keeps the editor open for invalid work durations and whitespace-only names", async ({ page }) => {
  await page.goto("./#more");
  await page.getByRole("button", { name: "New timer" }).click();
  const work = page.getByRole("group", { name: "Work", exact: true });
  const save = page.getByRole("button", { name: "Save timer", exact: true });
  await page.getByLabel("Timer name").fill("   ");
  await save.click();
  await expect(page.getByText("Enter a name for this timer.")).toBeVisible();

  await page.getByLabel("Timer name").fill("Sprint");
  await work.getByLabel("Min").fill("0");
  await save.click();
  await expect(page.getByText("Set Work to at least one second.")).toBeVisible();
  await expect(page.locator("#editor-total")).toHaveText("—");

  await work.getByLabel("Sec").fill("1");
  await save.click();
  await expect(page.getByRole("button", { name: /^Sprint Rounds/ })).toBeVisible();
});

test("restores preferences and uses the chosen time format and colors", async ({ page }) => {
  await page.goto("./#tabata");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await page.getByRole("switch", { name: /Spoken cues/ }).check();
  await page.getByRole("switch", { name: /Screen flash/ }).check();
  await page.getByRole("switch", { name: /Muted phase colors/ }).check();
  await page.getByLabel("Time format").selectOption("compact");
  await page.getByLabel("Sound style").selectOption("bell");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#phase-time")).toHaveText("0:20");
  await expect(page.locator("body")).toHaveClass("pale");

  await page.reload();
  await settings.click();
  for (const name of [/Spoken cues/, /Screen flash/, /Muted phase colors/]) {
    await expect(page.getByRole("switch", { name })).toBeChecked();
  }
  await expect(page.getByLabel("Time format")).toHaveValue("compact");
  await expect(page.getByLabel("Sound style")).toHaveValue("bell");
});

test("migrates existing presets, preferences, and a paused workout to Cadence", async ({ page }) => {
  await page.addInitScript(() => {
    const config = { prepare: 0, work: 30, rest: 10, rounds: 2, cooldown: 0 };
    localStorage.setItem("sports-timer:v1", JSON.stringify({
      settings: { timeFormat: "compact" },
      presets: [{ id: "saved", name: "Hill repeats", mode: "rounds", config }],
    }));
    sessionStorage.setItem("sports-timer:session:v1", JSON.stringify({
      interval: { mode: "rounds", name: "Hill repeats", config, elapsed: 31_000, startedAt: null },
    }));
  });
  await page.goto("./");
  await expect(page).toHaveTitle("Cadence");
  await expect(page.getByRole("heading", { name: "Hill repeats", exact: true })).toBeVisible();
  await expect(page.locator("#phase-name")).toHaveText("Rest");
  await expect(page.locator("#phase-time")).toHaveText("0:09");
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Time format").selectOption("padded");
  await page.reload();
  await expect(page.locator("#phase-time")).toHaveText("00:09");

  await page.getByRole("link", { name: "More", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Hill repeats Rounds/ })).toBeVisible();
  expect(await page.evaluate(() => Boolean(sessionStorage.getItem("cadence:session:v1")))).toBe(true);
});
