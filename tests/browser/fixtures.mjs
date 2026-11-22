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

export { expect };
