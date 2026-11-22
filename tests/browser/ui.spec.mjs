import axe from "axe-core";
import { expect, test } from "./fixtures.mjs";

test("keeps the oversized countdown and controls visible across viewport sizes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cadence:install-prompt", '{"dismissed":true}'));
  await page.goto("./");
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 600, height: 900 },
    { width: 667, height: 375 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    await test.step(`${viewport.width} × ${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      const measurements = await page.evaluate(async () => {
        const digits = await document.fonts.load('400 100px "Bebas Neue"', "01:00");
        const clock = document.querySelector("#phase-time");
        const panel = document.querySelector("#phase-panel").getBoundingClientRect();
        const text = clock.getBoundingClientRect();
        const style = getComputedStyle(clock);
        const canvas = document.createElement("canvas").getContext("2d");
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const ink = canvas.measureText(clock.textContent);
        return {
          fontLoaded: digits.length > 0,
          documentWidth: document.documentElement.scrollWidth,
          panelWidth: panel.width,
          clockFits: text.left >= panel.left && text.right <= panel.right &&
            text.top >= panel.top && text.bottom <= panel.bottom,
          startBottom: document.querySelector("#interval-main").getBoundingClientRect().bottom,
          navTop: document.querySelector(".tab-bar").getBoundingClientRect().top,
          digitWidth: (ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight) / innerWidth,
          digitHeight: (ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent) / innerWidth,
        };
      });
      expect(measurements.fontLoaded).toBe(true);
      expect(measurements.documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(measurements.clockFits).toBe(true);
      expect(measurements.startBottom).toBeLessThanOrEqual(measurements.navTop);
      if (viewport.width <= 430) {
        expect(measurements.panelWidth).toBe(viewport.width);
        expect(measurements.digitWidth).toBeGreaterThanOrEqual(0.91);
        expect(measurements.digitWidth).toBeLessThan(0.99);
        expect(measurements.digitHeight).toBeGreaterThanOrEqual(0.37);
      }
    });
  }
});

test("fits each timer with prompts, a long title, and saved laps", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone) AppleWebKit Safari" });
    window.addEventListener("beforeinstallprompt", (event) => event.stopImmediatePropagation(), { capture: true });
    const config = { prepare: 0, work: 60, rest: 10, rounds: 1, cycles: 2, cycleRest: 60, cooldown: 0 };
    sessionStorage.setItem("cadence:session:v1", JSON.stringify({
      interval: { mode: "tabata", name: "A really long title for my Tabata preset", config, elapsed: 62_000, startedAt: null },
      stopwatch: { elapsed: 12_000, startedAt: null, laps: Array.from({ length: 100 }, (_, index) => (index + 1) * 120) },
    }));
  });
  await page.goto("./");
  await expect(page.getByRole("complementary", { name: "Install Cadence" })).toBeVisible();

  const viewports = [
    { width: 320, height: 460 }, { width: 320, height: 568 }, { width: 390, height: 700 },
    { width: 568, height: 280 }, { width: 844, height: 390 }, { width: 1440, height: 900 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const mode of ["Rounds", "Tabata", "Stopwatch"]) {
      await test.step(`${mode} at ${viewport.width} × ${viewport.height}`, async () => {
        await page.getByRole("link", { name: mode, exact: true }).click();
        await page.evaluate(() => document.fonts.ready);
        const problems = await page.evaluate(() => {
          const doc = document.documentElement;
          const main = document.querySelector("main");
          const view = main.querySelector(".timer-view:not([hidden])");
          const bounds = main.getBoundingClientRect();
          const elements = view.querySelectorAll("button, .phase-header, .phase-time, .next-panel, .round-panel, .laps-panel");
          function contentOverflows(element, rect) {
            if (!(element instanceof HTMLButtonElement)) return element.scrollWidth > element.clientWidth + 1;
            return Array.from(element.childNodes).some((node) => {
              if (node instanceof Element && getComputedStyle(node).clipPath !== "none") return false;
              const contents = document.createRange();
              contents.selectNode(node);
              return Array.from(contents.getClientRects()).some((part) =>
                part.width > 1 && (part.left < rect.left - 1 || part.right > rect.right + 1)
              );
            });
          }
          const clipped = Array.from(elements).filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
              rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1 || contentOverflows(element, rect));
          });
          return [
            ...(doc.scrollWidth > doc.clientWidth || doc.scrollHeight > doc.clientHeight ? ["page scrolls"] : []),
            ...(main.scrollWidth > main.clientWidth || main.scrollHeight > main.clientHeight ? ["timer scrolls"] : []),
            ...(view.querySelector(".phase-time").getBoundingClientRect().height < 20 ? ["clock is too small"] : []),
            ...clipped.map((element) => "clipped " + (element.id || element.className)),
          ];
        });
        expect(problems).toEqual([]);
      });
    }
  }
});

test("pins the header and mode bar as settings and lap history scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.setItem("cadence:install-prompt", '{"dismissed":true}');
    sessionStorage.setItem("cadence:session:v1", JSON.stringify({
      stopwatch: { elapsed: 100_000, startedAt: null, laps: Array.from({ length: 100 }, (_, index) => (index + 1) * 1000) },
    }));
  });
  await page.goto("./#stopwatch");
  const main = page.locator("main");
  const chrome = () => page.evaluate(() => [".masthead", ".tab-bar"].map((selector) => {
    const { top, bottom } = document.querySelector(selector).getBoundingClientRect();
    return { top, bottom };
  }));
  const initialChrome = await chrome();

  for (const label of ["Settings", "Lap history"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await chrome()).toEqual(initialChrome);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    expect(await main.evaluate((element) => element.scrollTop)).toBe(0);
  }
});

test("supports keyboard navigation and marks the active timer mode", async ({ page }) => {
  await page.goto("./");
  const tabata = page.getByRole("link", { name: "Tabata", exact: true });
  await tabata.focus();
  await page.keyboard.press("Enter");
  await expect(tabata).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Tabata", exact: true })).toBeFocused();

  const start = page.getByRole("button", { name: "Start", exact: true });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeFocused();
});

test("suppresses a phase flash when the browser requests reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: /Screen flash/ }).check();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();

  const panel = page.locator("#phase-panel");
  await expect(panel).toHaveClass(/flash/);
  const style = () => panel.evaluate((element) => getComputedStyle(element, "::after").animationName);
  expect(await style()).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await style()).toBe("flash");
});

async function checkAccessibility(page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    await document.fonts.ready;
    const result = await window.axe.run({
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
  });
  expect(violations).toEqual([]);
}

test.describe("accessibility", () => {
  for (const [view, route] of [["Rounds", "./"], ["Stopwatch", "./#stopwatch"], ["More", "./#more"]]) {
    test(view, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
      await checkAccessibility(page);
    });
  }

  for (const view of ["Edit timer", "Settings"]) {
    test(view, async ({ page }) => {
      await page.goto("./");
      await page.getByRole("button", { name: view, exact: true }).click();
      await checkAccessibility(page);
    });
  }

  for (const mode of ["tabata", "stopwatch"]) {
    test(`${mode} timer editor`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(`./#${mode}`);
      await page.getByRole("button", { name: "Edit timer", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await checkAccessibility(page);
    });
  }

  test("delete preset dialog", async ({ page }) => {
    await page.goto("./#more");
    await page.getByRole("button", { name: "New timer", exact: true }).click();
    await page.getByLabel("Timer name").fill("Accessibility timer");
    await page.getByRole("button", { name: "Save timer", exact: true }).click();
    await page.getByRole("button", { name: "Delete Accessibility timer", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkAccessibility(page);
  });
});
