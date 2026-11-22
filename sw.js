const prefix = `sports-timer:${self.registration.scope}:`;
const cacheName = `${prefix}v2`;
const files = [
  "./index.html", "./styles.css", "./app.mjs", "./timer.mjs", "./cues.mjs",
  "./manifest.webmanifest", "./assets/icon.svg",
  "./assets/icon-180.png", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable.png",
  "./assets/barlow-condensed-800.woff2",
  "./assets/voice-prepare.wav", "./assets/voice-work.wav", "./assets/voice-rest.wav",
  "./assets/voice-cooldown.wav", "./assets/voice-finished.wav",
];
const urls = new Set(files.map((file) => new URL(file, self.registration.scope).href));
const index = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) =>
    cache.addAll([...urls].map((url) => new Request(url, { cache: "reload" })))
  ));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!url.href.startsWith(self.registration.scope)) return;
  url.search = "";
  url.hash = "";

  const cachedUrl = url.href === self.registration.scope ? index : url.href;
  if (!urls.has(cachedUrl)) return;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(cachedUrl)) ?? fetch(request);
  })());
});
