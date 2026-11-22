import { expect, test } from "./fixtures.mjs";
import { startSite } from "./site-server.mjs";
import "../../version.js";

const version = globalThis.CADENCE_VERSION;

test("reloads a subpath with the server stopped and runs an offline workout", async ({ page }) => {
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
      ];
      return Promise.all(paths.map(async (path) => {
        const response = await fetch(path);
        return response.ok && (await response.arrayBuffer()).byteLength > 0;
      }));
    });
    expect(assets).toEqual([true, true, true, true]);
    const speechDuration = await page.evaluate(async () => {
      const response = await fetch("./assets/voice-work.wav");
      const audio = new OfflineAudioContext(1, 1, 44_100);
      return (await audio.decodeAudioData(await response.arrayBuffer())).duration;
    });
    expect(speechDuration).toBeGreaterThan(0);

    const button = (name) => page.getByRole("button", { name, exact: true });
    await button("New timer").click();
    await page.getByLabel("Timer name").fill("Offline practice");
    await button("Save timer").click();
    await page.getByRole("button", { name: /^Offline practice Rounds/ }).click();
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
    await button("Start").click();
    await button("Skip interval").click();
    await expect(page.locator("#phase-name")).toHaveText("Rest");
    await button("Pause").click();
    await page.reload();
    await expect(page.locator("#phase-name")).toHaveText("Rest");
    await expect(button("Resume")).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
  } finally {
    await site.close();
  }
});

test("meets Chromium installability checks", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium DevTools exposes these diagnostics");
  await page.goto("./");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const devtools = await context.newCDPSession(page);
  await devtools.send("Page.enable");
  const { installabilityErrors } = await devtools.send("Page.getInstallabilityErrors");
  expect(installabilityErrors.filter(({ errorId }) => errorId !== "in-incognito")).toEqual([]);
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
