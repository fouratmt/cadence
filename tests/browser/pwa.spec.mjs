import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.mjs";
import { startSite } from "./site-server.mjs";
import "../../version.js";

const version = globalThis.CADENCE_VERSION;

test("reloads a subpath with the server stopped and runs an offline workout", async ({ page }) => {
  await page.addInitScript(() => {
    window.playedAudio = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) window.playedAudio.push(this.buffer.duration);
      return start.apply(this, args);
    };
  });
  const site = await startSite();
  try {
    const url = new URL("?preview=1#more", site.url);
    await page.goto(url.href);
    await expect(page.locator("#offline-status")).toHaveText("Available offline");
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    await site.close();
    await page.reload();
    await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
    await expect(page.locator("#offline-status")).toHaveText("Available offline");
    await expect(page.locator("#app-version")).toHaveText(`v${version}`);

    const assets = await page.evaluate(async () => {
      const paths = [
        "./manifest.webmanifest",
        "./assets/icon-192.png",
        "./assets/bebas-neue-digits.woff2",
        "./assets/voice-work.wav",
        "./assets/bell-hand.wav",
        "./assets/bell-tubular.wav",
        "./assets/sport-whistle.wav",
        "./assets/sport-whistle-long.wav",
      ];
      return Promise.all(paths.map(async (path) => {
        const response = await fetch(path);
        return response.ok && (await response.arrayBuffer()).byteLength > 0;
      }));
    });
    expect(assets).toEqual([true, true, true, true, true, true, true, true]);
    const durations = await page.evaluate(async () => {
      const audio = new OfflineAudioContext(1, 1, 44_100);
      const files = ["voice-work", "bell-hand", "bell-tubular", "sport-whistle", "sport-whistle-long"];
      return Object.fromEntries(await Promise.all(files.map(async (file) => {
        const response = await fetch(`./assets/${file}.wav`);
        return [file, (await audio.decodeAudioData(await response.arrayBuffer())).duration];
      })));
    });
    expect(Object.values(durations).every((duration) => duration > 0)).toBe(true);
    expect(durations["sport-whistle"]).toBeLessThan(.25);
    expect(durations["sport-whistle-long"]).toBeGreaterThan(.65);

    const button = (name) => page.getByRole("button", { name, exact: true });
    await button("New timer").click();
    await page.getByLabel("Timer name").fill("Offline practice");
    await button("Save timer").click();
    await page.getByRole("button", { name: /^Offline practice Rounds/ }).click();
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
    await button("Settings").click();
    const style = page.getByLabel("Sound style");
    await style.selectOption({ label: "Sport / Military" });
    await button("Preview").click();
    await expect.poll(() => page.evaluate(() => window.playedAudio.length)).toBe(1);
    expect(await page.evaluate(() => window.playedAudio[0])).toBeGreaterThan(.65);
    await button("Back").click();
    await button("Start").click();
    await expect.poll(() => page.evaluate(() => window.playedAudio.length)).toBe(2);
    await button("Skip interval").click();
    await expect(page.locator("#phase-name")).toHaveText("Rest");
    await button("Pause").click();
    await page.reload();
    await expect(page.locator("#phase-name")).toHaveText("Rest");
    await expect(button("Resume")).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
    await button("Settings").click();
    await expect(style).toHaveValue("sport");
  } finally {
    await site.close();
  }
});

test("each workout cue starts promptly and stays below clipping at full volume", async ({ page }) => {
  await page.goto("./");
  const mixes = await page.evaluate(async () => {
    const { WorkoutCues } = await import("./cues.mjs");
    const { DEFAULT_SETTINGS, PHASE_NAMES } = await import("./timer.mjs");
    const sampleRate = 44_100;
    let audio;
    window.AudioContext = class {
      constructor() {
        audio = new OfflineAudioContext(1, sampleRate * 2, sampleRate);
        Object.defineProperty(audio, "state", { value: "running" });
        return audio;
      }
    };

    const results = [];
    for (const soundStyle of ["bell", "beep", "pulse", "sport"]) {
      for (const phase of Object.keys(PHASE_NAMES)) {
        const cues = new WorkoutCues();
        const settings = { ...DEFAULT_SETTINGS, volume: 100, soundStyle };
        cues.prepare(settings);
        await cues.play(phase, settings);
        const samples = (await audio.startRendering()).getChannelData(0);
        const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        const firstNote = samples.findIndex((sample) => Math.abs(sample) > .01);
        results.push({ phase, soundStyle, peak, firstNote, sampleRate });
      }
    }
    return results;
  });

  expect(mixes).toHaveLength(24);
  for (const { phase, soundStyle, peak, firstNote, sampleRate } of mixes) {
    const cue = `${soundStyle} ${phase}`;
    expect(peak, cue).toBeGreaterThan(.05);
    expect(peak, cue).toBeLessThan(.92);
    expect(firstNote / sampleRate, cue).toBeLessThan(.06);
  }
});

test("Chromium identifies Cadence by its subpath and resolves its install icons", async ({ page, context, browserName, site }) => {
  test.skip(browserName !== "chromium", "Chromium DevTools exposes these diagnostics");
  await page.goto("./");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const devtools = await context.newCDPSession(page);
  await devtools.send("Page.enable");
  const { url, manifest } = await devtools.send("Page.getAppManifest");
  expect(url).toBe(`${site.url}manifest.webmanifest`);
  expect(manifest).toMatchObject({ id: site.url, startUrl: site.url, scope: site.url });
  expect(manifest.icons.map(({ url: icon }) => icon)).toEqual([
    `${site.url}assets/icon-192.png`, `${site.url}assets/icon-512.png`, `${site.url}assets/icon-maskable.png`,
  ]);
  expect(await page.locator('link[rel="apple-touch-icon"]').evaluate((link) => link.href))
    .toBe(`${site.url}assets/icon-180.png`);
  const { installabilityErrors } = await devtools.send("Page.getInstallabilityErrors");
  expect(installabilityErrors.filter(({ errorId }) => errorId !== "in-incognito")).toEqual([]);
});

test("waits for Cadence's own worker on a site with a root service worker", async ({ page }) => {
  const worker = await readFile(new URL("../../sw.js", import.meta.url), "utf8");
  const { promise, resolve } = Promise.withResolvers();
  const site = await startSite(new Map([
    ["/main.html", "<title>Main app</title>"],
    ["/main-worker.js", `
      self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
      self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
    `],
    ["sw.js", promise],
  ]));
  try {
    await page.goto(new URL("/main.html", site.url).href);
    await page.evaluate(() => navigator.serviceWorker.register("/main-worker.js"));
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/main-worker.js"));

    await page.goto(`${site.url}#more`);
    await expect(page.locator("#app-version")).toHaveText(`v${version}`);
    await expect(page.locator("#offline-status")).toHaveText("Preparing offline access");
    resolve(worker);

    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/cadence/sw.js"));
    await expect(page.locator("#offline-status")).toHaveText("Available offline");
    await expect(page.getByRole("complementary", { name: "Update available" })).toBeHidden();
  } finally {
    resolve(worker);
    await site.close();
  }
});

test("prompts iOS visitors with install steps and remembers their choice", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone) AppleWebKit Safari" });
    window.addEventListener("beforeinstallprompt", (event) => event.stopImmediatePropagation(), { capture: true });
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./");
  const notice = page.getByRole("complementary", { name: "Install Cadence" });
  await expect(notice).toBeVisible();
  await expect(page.locator("#app-version")).toHaveText(`v${version}`);
  await notice.getByRole("button", { name: "Show steps", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Install app", exact: true })).toBeFocused();
  await expect(page.locator("#install-steps")).toContainText("Add to Home Screen");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator("#announcement")).not.toHaveText("A Cadence update is available.");
  await page.reload();
  await expect(notice).toBeHidden();
  await expect(page.getByRole("heading", { name: "Install app", exact: true })).toBeVisible();
});

test("uses the browser install prompt only after the user taps Install", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => {
    window.installRequests = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => {
      window.installRequests++;
      return { outcome: "dismissed" };
    };
    window.dispatchEvent(event);
  });
  const notice = page.getByRole("complementary", { name: "Install Cadence" });
  await expect(notice).toBeVisible();
  expect(await page.evaluate(() => window.installRequests)).toBe(0);
  await notice.getByRole("button", { name: "Install", exact: true }).click();
  await expect(notice).toBeHidden();
  expect(await page.evaluate(() => window.installRequests)).toBe(1);
});

test("omits the install prompt in a standalone app", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
  });
  await page.goto("./#more");
  await expect(page.getByRole("complementary", { name: "Install Cadence" })).toBeHidden();
  await expect(page.locator("#install-steps")).toHaveText("Cadence is open as an installed app.");
});

test("offers a newly downloaded version after pausing and reloads only the accepting tab", async ({ page, context }) => {
  const overrides = new Map();
  const site = await startSite(overrides);
  try {
    const otherTab = await context.newPage();
    for (const tab of [page, otherTab]) {
      await tab.goto(site.url);
      await tab.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await expect(tab.locator("#app-version")).toHaveText(`v${version}`);
      await tab.getByRole("button", { name: "Start", exact: true }).click();
    }

    const next = `${Number(version.split(".")[0]) + 1}.0.0`;
    overrides.set("version.js", `globalThis.CADENCE_VERSION = "${next}";\n`);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
    const updateNotice = (tab) => tab.getByRole("complementary", { name: "Update available" });
    await expect(updateNotice(page)).toBeHidden();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(updateNotice(page)).toBeVisible();
    await expect(page.locator("#app-version")).toHaveText(`v${version}`);

    await updateNotice(page).getByRole("button", { name: "Dismiss update prompt" }).click();
    await expect(updateNotice(page)).toBeHidden();
    await page.reload();
    await expect(updateNotice(page)).toBeVisible();
    await updateNotice(page).getByRole("button", { name: "Update", exact: true }).click();
    await expect(page.locator("#app-version")).toHaveText(`v${next}`);
    await expect(updateNotice(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();

    await expect(otherTab.locator("#app-version")).toHaveText(`v${version}`);
    await expect(otherTab.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
    await otherTab.getByRole("button", { name: "Pause", exact: true }).click();
    await updateNotice(otherTab).getByRole("button", { name: "Update", exact: true }).click();
    await expect(otherTab.locator("#app-version")).toHaveText(`v${next}`);
  } finally {
    await site.close();
  }
});
