import { expect, test as base } from "@playwright/test";
import { startSite } from "./site-server.mjs";

export const test = base.extend({
  site: [async ({}, use) => {
    const site = await startSite();
    try {
      await use(site);
    } finally {
      await site.close();
    }
  }, { scope: "worker" }],

  baseURL: async ({ site }, use) => {
    await use(site.url);
  },

  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });
    await use(page);
    expect(errors, "Uncaught app errors or server errors").toEqual([]);
  },
});

export async function trackScheduledAudio(page) {
  await page.addInitScript(() => {
    // Keep native decoding and scheduling without requiring an audio output device in CI.
    window.AudioContext = class {
      constructor() {
        const audio = new OfflineAudioContext(1, 1, 44_100);
        Object.defineProperty(audio, "state", { value: "running" });
        return audio;
      }
    };
    window.scheduledAudio = [];
    for (const [prototype, kind] of [[OscillatorNode.prototype, "bip"], [AudioBufferSourceNode.prototype, "bell"]]) {
      const start = prototype.start;
      prototype.start = function (...args) {
        start.apply(this, args);
        window.scheduledAudio.push({ kind, time: Date.now(), duration: this.buffer?.duration });
      };
    }
  });
  return () => page.evaluate(() => window.scheduledAudio);
}

export { expect };
