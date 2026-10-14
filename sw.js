// Service worker: lets the installed app open with no connection. Network first — online you always get the latest
// version (and the copy is refreshed); offline the last saved copy is used. Projects aren't here: they live in
// localStorage on the device.
const CACHE = "ribbit-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "fonts/sigmar-latin.woff2",
  "fonts/geist-latin.woff2",
  "icons/plus.svg",
  "icons/x.svg",
  "icons/check.svg",
  "icons/more.svg",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: "no-cache" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }) // revalidate with the server rather than trusting the HTTP cache
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
