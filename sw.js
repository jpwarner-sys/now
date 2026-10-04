/*
 * sw.js — lets the home-screen walker open with no signal.
 *
 * Without this, a phone in a dead zone gets a browser error page instead of the
 * DUMP bar, and the outbox (which is built to hold dumps until the door answers)
 * never gets a chance to hold anything.
 *
 * Network first for the page, so a new build shows up the moment there is signal
 * and the version tag in the header can be trusted. The cache is only the fallback.
 * Only same-origin GETs are touched: the door is another origin and every door
 * call is a POST, so nothing here can ever answer for the stack.
 */
var CACHE = "now-shell-v1";
var SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

/* Offline fallback. A navigation uses the cached page. Every other miss, and any cache throw,
   fulfills as a network error so the worker itself never throws. */
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    if (req.mode !== "navigate") return Response.error();
    return caches.match("index.html").then(function (shell) { return shell || Response.error(); });
  }).catch(function () { return Response.error(); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // A navigation revalidates with the server every time (no-cache), so a new build is never hidden
  // behind the browser's HTTP cache and the version tag in the header stays true.
  // The throw path is narrow. respondWith's promise always fulfills:
  //   - a good response is returned even if writing the cache throws;
  //   - a navigation with no network falls back to the cached page, then to a network error only
  //     when that page is missing too — never to undefined, which throws inside respondWith;
  //   - anything that is not a navigation, and is not cached, is the one path that fails the
  //     request (Response.error). A cache read that throws takes that same path, and does not reject.
  e.respondWith(
    fetch(req, req.mode === "navigate" ? { cache: "no-cache" } : undefined)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          // Cache.put throws on a navigate-mode request. Store a plain GET of the same URL.
          var stored = req.mode === "navigate" ? new Request(req.url) : req;
          caches.open(CACHE).then(function (c) { return c.put(stored, copy); }).catch(function () {});
        }
        return res;
      })
      .catch(function () { return fromCache(req); })
  );
});

/* Ask every open walker to sync now. */
function pullAll() {
  return self.clients.matchAll({ type: "window" }).then(function (list) {
    list.forEach(function (c) { c.postMessage({ type: "pull" }); });
  });
}
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "pull") pullAll();
});

/* Stage 2 (not live): the stack's relay sends a push whose whole payload is
   {"type":"card_waiting"} — never the card itself. The walker wakes and pulls through
   the door like always. Inert until a push subscription exists. */
self.addEventListener("push", function (e) {
  e.waitUntil(Promise.all([
    pullAll(),
    self.registration.showNotification("Walker", { body: "A card is waiting on you.", tag: "card_waiting", icon: "icon-192.png", badge: "icon-192.png" }),
  ]));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(function (list) {
    if (list.length) { list[0].postMessage({ type: "pull", route: "cards" }); return list[0].focus(); }
    return self.clients.openWindow("./#cards");
  }));
});
