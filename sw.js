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

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      })
      .catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error());
        });
      })
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
