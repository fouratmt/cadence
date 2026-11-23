import { availableParallelism } from "node:os";
import { defineConfig } from "@playwright/test";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: ci ? 2 : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
  timeout: 30_000,
  retries: ci ? 1 : 0,
  failOnFlakyTests: true,
  use: {
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
