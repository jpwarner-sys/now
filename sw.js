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
/* The browser installs a new worker only when THIS file's bytes change. With a fixed cache name a
   deploy that touched only index.html installed nothing, fired no event, and the phone kept the old
   build — so the tag is stamped by hand here and held equal to index.html's BUILD by the suite. */
var TAG = "1.1.9";                      // bumped with BUILD in index.html; the suite holds them equal
var PREFIX = "now-shell-";
var CACHE = PREFIX + TAG;
var SHELL = ["./", "index.html", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  /* The page itself must cache or the install fails on purpose: an aborted install leaves the previous
     worker and its shell in control, which is the safe outcome for a phone with no signal. Everything
     else is best-effort — one slow icon must not cost the new build. cache:"reload" so the host's HTTP
     cache cannot fill a new build's shell with the previous deploy's files. */
  e.waitUntil(caches.open(CACHE).then(function (c) {
    function put(url, required) {
      return fetch(url, { cache: "reload" }).then(function (res) {
        if (res && res.ok) return c.put(url, res);
        if (required) throw new TypeError("shell: " + url);
        return null;
      }).catch(function (err) { if (required) throw err; return null; });
    }
    return Promise.all(SHELL.map(function (url) { return put(url, url === "./" || url === "index.html"); }));
  }));
  /* No skipWaiting() here, on purpose: "a new build is offered, never taken" has to be true of the
     WORKER too. An unconditional skip took the worker with no tap, swept the running build's shell
     out from under the page that was still running it, and left registration.waiting empty — which
     made the page's waiting branch dead code and left it nothing to ask the new build's TAG. The page
     promotes this worker by sending SKIP_WAITING from the LOAD line, and only then. */
});

self.addEventListener("activate", function (e) {
  /* The sweep is scoped to this app's own prefix. walker.ontologyhome.ca is a dedicated origin (see
     CNAME) with scope "/", so the old unscoped sweep could only ever have deleted walker's own
     caches — this is hygiene against a future co-tenant, NOT a live bug fix, and no comment, README
     line or PR body should say otherwise. */
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
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
  // The browser checks this file for a new build. Never answer it from the shell cache.
  if (url.pathname.endsWith("/sw.js")) return;
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
  if (!e.data) return;
  if (e.data.type === "pull") pullAll();
  // The page sends this from the LOAD line. It is the ONLY thing that promotes a waiting worker.
  else if (e.data.type === "SKIP_WAITING") self.skipWaiting();
  /* Which build am I? The page asks this before it offers anything, because a cold launch after a
     deploy is already the new build and must not be told a new build is ready. Answered down the
     port the page sent, so the reply reaches the one asker and nothing is broadcast. */
  else if (e.data.type === "TAG") {
    var port = e.ports && e.ports[0];
    if (port) port.postMessage({ type: "TAG", tag: TAG });
    else if (e.source && e.source.postMessage) e.source.postMessage({ type: "TAG", tag: TAG });
  }
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
