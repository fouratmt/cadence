import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

const root = new URL("../../", import.meta.url);
const scope = "https://example.test/cadence/";
const cachePrefix = `cadence:${scope}:`;
const previousCache = `sports-timer:${scope}:v3`;
const code = await readFile(new URL("sw.js", root), "utf8");
const versionCode = await readFile(new URL("version.js", root), "utf8");
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));

function worker() {
  const handlers = new Map();
  const cached = new Map();
  const installed = [];
  const deleted = [];
  const fetched = [];
  const state = { cacheName: "", claimed: false, skippedWaiting: false };
  const cache = {
    async addAll(requests) {
      installed.push(...requests);
    },
    async match(url) {
      return cached.get(url);
    },
  };

  const context = createContext({
    URL,
    Request,
    importScripts(source) {
      assert.equal(source, "./version.js");
      runInContext(versionCode, context);
    },
    self: {
      registration: { scope },
      clients: { async claim() { state.claimed = true; } },
      async skipWaiting() { state.skippedWaiting = true; },
      addEventListener: (event, callback) => handlers.set(event, callback),
    },
    caches: {
      async open(name) {
        state.cacheName = name;
        return cache;
      },
      async keys() {
        return [state.cacheName, `${cachePrefix}old`, previousCache, "sports-timer:https://example.test/another/:v3", "another-app-cache"];
      },
      async delete(name) {
        deleted.push(name);
      },
    },
    async fetch(request) {
      fetched.push(request.url);
      return new Response("network response");
    },
  });
  runInContext(code, context);

  return {
    installed,
    deleted,
    cached,
    fetched,
    async install() {
      await new Promise((resolve) => handlers.get("install")({ waitUntil: resolve }));
      return state.cacheName;
    },
    async activate() {
      await new Promise((resolve) => handlers.get("activate")({ waitUntil: resolve }));
      return state.claimed;
    },
    async send(data) {
      let confirmation;
      handlers.get("message")({ data, waitUntil: (promise) => { confirmation = promise; } });
      await confirmation;
      return state.skippedWaiting;
    },
    request(url, method = "GET") {
      let response;
      handlers.get("fetch")({
        request: new Request(url, { method }),
        respondWith: (result) => { response = result; },
      });
      return response;
    },
  };
}

test("manifest configures a standalone app that can be hosted in a repository subpath", () => {
  assert.equal(manifest.name, "Cadence");
  assert.equal(manifest.short_name, "Cadence");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.id, "/cadence/");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./");
  const startUrl = new URL(manifest.start_url, `${scope}manifest.webmanifest`);
  assert.equal(startUrl.href, scope);
  assert.equal(new URL(manifest.id, startUrl.origin).href, scope);
});

test("manifest points to usable PNG icons with the declared sizes and a maskable icon", async () => {
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith("./assets/"));
    assert.equal(icon.type, "image/png");
    const bytes = await readFile(new URL(icon.src, root));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  for (const size of ["192x192", "512x512"]) {
    assert.ok(manifest.icons.some((icon) => icon.purpose === "any" && icon.sizes === size));
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});

test("precaches all shipped UI, font, icon and voice assets with unique scoped URLs", async () => {
  const serviceWorker = worker();
  const cacheName = await serviceWorker.install();
  assert.ok(cacheName.startsWith(cachePrefix));
  assert.match(cacheName.slice(cachePrefix.length), /^v\d+\.\d+\.\d+$/);
  const cached = serviceWorker.installed.map((request) => request.url);
  assert.equal(new Set(cached).size, cached.length);

  for (const request of serviceWorker.installed) {
    assert.ok(request.url.startsWith(scope));
    assert.equal(request.cache, "reload");
    await access(new URL(request.url.slice(scope.length), root));
  }

  const html = await readFile(new URL("index.html", root), "utf8");
  const css = await readFile(new URL("styles.css", root), "utf8");
  const sounds = (await readdir(new URL("assets/", root))).filter((file) => file.endsWith(".wav"));
  const references = [
    "./index.html", "./timer.mjs", "./cues.mjs", "./pwa.mjs", "./version.js",
    ...Array.from(html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g), (match) => match[1]),
    ...Array.from(css.matchAll(/url\("\.\/([^"]+)"\)/g), (match) => `./${match[1]}`),
    ...manifest.icons.map((icon) => icon.src),
    ...sounds.map((sound) => `./assets/${sound}`),
  ];
  for (const reference of references) {
    assert.ok(cached.includes(new URL(reference, scope).href), `${reference} is missing offline`);
  }
});

test("activation removes only stale caches owned by this app", async () => {
  const serviceWorker = worker();
  await serviceWorker.install();
  assert.equal(await serviceWorker.activate(), true);
  assert.deepEqual(serviceWorker.deleted, [`${cachePrefix}old`, previousCache]);
});

test("a waiting worker activates only when asked", async () => {
  const serviceWorker = worker();
  assert.equal(await serviceWorker.send("other"), false);
  assert.equal(await serviceWorker.send("activate-update"), true);
});

test("serves cached navigation at the repository root with a query and hash", async () => {
  const serviceWorker = worker();
  serviceWorker.cached.set(`${scope}index.html`, new Response("cached app"));
  const response = await serviceWorker.request(`${scope}?review=1#tabata`);
  assert.equal(await response.text(), "cached app");
  assert.deepEqual(serviceWorker.fetched, []);
});

test("uses the network for a cache miss on a known asset and leaves other requests alone", async () => {
  const serviceWorker = worker();
  const stylesheet = `${scope}styles.css?version=3`;
  assert.equal(await (await serviceWorker.request(stylesheet)).text(), "network response");
  assert.deepEqual(serviceWorker.fetched, [stylesheet]);
  assert.equal(serviceWorker.request(`${scope}index.html`, "POST"), undefined);
  assert.equal(serviceWorker.request("https://example.test/other/styles.css"), undefined);
  assert.equal(serviceWorker.request(`${scope}missing.css`), undefined);
});
