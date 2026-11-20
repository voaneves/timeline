// Service worker for the timeline page.
// Bump VERSION on every release that changes the shell: it renames the caches
// and the activate handler removes every cache that is not current.
// The 3D chunk (assets/js/world/*) is never precached, so it is only fetched
// after the visitor starts the 3D mode.
const VERSION = "v3";
const PRECACHE = `precache-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

// Paths are relative to the worker, so they resolve under /timeline/ as well.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./assets/styles/main.css",
  "./assets/js/boot.min.js",
  "./assets/fonts/schibsted-grotesk.woff2",
  "./assets/fonts/jetbrains-mono.woff2",
  "./assets/brand/mark-duo.svg",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const current = [PRECACHE, RUNTIME];
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => !current.includes(name)).map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // World chunk and anything else under assets/js/world/ goes straight to the network.
  if (url.pathname.includes("/assets/js/world/")) return;

  if (request.mode === "navigate") {
    // Network first, so returning visitors always get the latest page.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("./index.html"))
        )
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
