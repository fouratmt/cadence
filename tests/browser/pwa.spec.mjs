import { expect, test } from "./fixtures.mjs";
import { startSite } from "./site-server.mjs";

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
