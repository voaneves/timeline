// Service worker for the timeline page.
// Bump VERSION on every release that changes the shell: it renames the caches
// and the activate handler removes every cache that is not current.
// The 3D chunk (assets/js/world/*) is never precached, so it is only fetched
// after the visitor starts the 3D mode.
const VERSION = "v9";

// Worker scope path (e.g. "/timeline/"). Every bypass rule is anchored to it, so a look-alike
// path elsewhere on the origin (e.g. /other/play/) is never skipped by mistake.
const SCOPE = new URL("./", self.location).pathname;
const BYPASS_DIRS = ["play", "next", "game", "assets/js/world"].map((dir) => SCOPE + dir);
const BYPASS_FILE = /\.(?:glb|wasm|ktx2|mp3|ogg)$/i;

// The 3D game (play/, next/, game/), the world chunk, asset-manifest.* and the game binaries
// are never handled by the worker: no caching, straight to the network.
function isBypassed(pathname) {
  if (!pathname.startsWith(SCOPE)) return false;
  if (BYPASS_DIRS.some((dir) => pathname === dir || pathname.startsWith(dir + "/"))) return true;
  if (pathname.slice(SCOPE.length).startsWith("asset-manifest.")) return true;
  return BYPASS_FILE.test(pathname);
}

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
      .then((names) => {
        const stale = names.filter((name) => !current.includes(name));
        return Promise.all(stale.map((name) => caches.delete(name))).then(() => stale.length);
      })
      .then((staleCount) =>
        self.clients.claim().then(() => {
          // Upgrading from an older release: tabs may be showing an HTML shell
          // served from the old cache whose assets no longer exist. Reload them
          // once so they pick up the current page. A first install has no stale
          // caches, so this never loops.
          if (!staleCount) return;
          return self.clients
            .matchAll({ type: "window" })
            .then((windows) =>
              Promise.all(
                windows.map((client) => {
                  // Game pages are not served by this worker: no stale shell to refresh there.
                  if (isBypassed(new URL(client.url).pathname)) return undefined;
                  return client.navigate(client.url).catch(() => {});
                })
              )
            );
        })
      )
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // World chunk, the 3D game and its binaries, asset manifests: straight to the network.
  if (isBypassed(url.pathname)) return;

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
