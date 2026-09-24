/*
 * test.js — run with:  node test.js
 *
 * No dependencies, no build. It reads index.html as text, lifts the <script id="core">
 * block out of it — every rule the walker enforces, with no screen, storage or network —
 * and runs it here. The same shipped bytes, not a copy.
 *
 *   CONTRACT  joeos-core's own vectors (contract/) — the floor matrix and FIRST. A port is
 *             only worth something if it gives the same answers as what it was ported from.
 *   WIRE      every body the phone sends is exactly the shape the live door takes (DOOR.md).
 *   STORE     a 0.9.x phone migrates with nothing lost; a pull never loses what you did.
 *   CLOCK     the dark window and the cutoff lamp, in Eastern time, both sides of DST.
 *   SHIP      no door URL, key or deployment id anywhere public; one namespace; the build tag.
 *
 * The browser half — the real page against a door that behaves like the live one — is
 * test/e2e.mjs.  NOW_INDEX=<path> points this suite at another copy of the page.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const INDEX = process.env.NOW_INDEX || path.join(ROOT, "index.html");
let SRC = fs.readFileSync(INDEX, "utf8");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
/* The page's Content-Security-Policy lets only its own inline scripts run, each pinned by its hash.
   An edit to either script changes its hash; `node test.js --pin-csp` writes the new ones in. */
const scriptHashes = (src) => [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((x) => "'sha256-" + require("crypto").createHash("sha256").update(x[1], "utf8").digest("base64") + "'");
if (process.argv.includes("--pin-csp")) {
  SRC = SRC.replace(/(<meta http-equiv="Content-Security-Policy" content="[^"]*?script-src )[^;]*;/, (_, a) => a + scriptHashes(SRC).join(" ") + ";");
  fs.writeFileSync(INDEX, SRC);
  console.log("CSP pinned: " + scriptHashes(SRC).join(" ") + "\n");
}

const results = {};
function check(group, name, ok, detail) {
  const g = (results[group] = results[group] || { pass: 0, fail: [] });
  if (ok) g.pass++; else g.fail.push(detail === undefined ? name : name + " — " + JSON.stringify(detail));
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const m = SRC.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.log("FAIL: no <script id=\"core\"> block in " + INDEX); process.exit(1); }
const CORE = new Function(m[1] + "\nreturn CORE;")();
const BUILD = (SRC.match(/const BUILD = "([^"]+)"/) || [])[1];

/* ------------------------------------------------------------------ CONTRACT */
const sv = JSON.parse(read("contract/state_vectors.json"));
for (const c of sv.cases) {
  const got = CORE.chipFor(c.vec || {}).st;
  check("CONTRACT", "state · " + c.name, got === c.code, { expected: c.code, got });
}
const fv = JSON.parse(read("contract/first_vectors.json"));
const OPEN = (s) => s !== "done" && s !== "dropped" && s !== "parked";
for (const c of fv.cases) {
  const hour = parseInt(c.now.slice(11, 13), 10);
  const chip = c.vec ? CORE.chipFor(c.vec) : { st: null, red: false };
  // NOW's stop path: 02:00–05:59 is night, a C floor is red.
  const stop = (hour >= 2 && hour < 6) || chip.red;
  let id = null;
  if (!stop) {
    const pool = c.captures.filter((x) => OPEN(x.status));
    const p = CORE.pickFirst(pool, chip.st);
    id = p ? p.item.id : null;
  }
  const ok = stop === !!c.expect_stop && (stop || id === (c.expect_id === undefined ? null : c.expect_id));
  check("CONTRACT", "first · " + c.name, ok, { expect_stop: c.expect_stop, got_stop: stop, expect_id: c.expect_id, got_id: id });
}

/* ------------------------------------------------------------------ WIRE */
const KEY = "k-not-a-live-key";
const env = (op, body, id) => ({ id: id || "3f1c2a4e-9b7d-4c1e-8f2a-6d5b4c3a2e1f", op, at: "2026-09-24T14:00:00.000Z", body });
{
  const d = CORE.wire(env("dump", { text: "call the plumber" }), KEY, BUILD);
  check("WIRE", "dump: exact field set", eq(Object.keys(d).sort(), ["key", "origin_surface", "receipt_id", "schema", "surface_version", "text"]), Object.keys(d));
  check("WIRE", "dump: no op (the door reads an op-less body as a dump)", !("op" in d));
  check("WIRE", "dump: schema lab.intake.raw/v1", d.schema === "lab.intake.raw/v1");
  check("WIRE", "dump: origin_surface walker", d.origin_surface === "walker");
  check("WIRE", "dump: receipt_id is the envelope id (retries de-dup)", d.receipt_id === "3f1c2a4e-9b7d-4c1e-8f2a-6d5b4c3a2e1f");
  check("WIRE", "dump: surface_version is the build, door-legal", d.surface_version === BUILD && /^[A-Za-z0-9._-]{1,32}$/.test(d.surface_version), d.surface_version);
  check("WIRE", "dump: key rides in the body", d.key === KEY);

  const a = CORE.wire(env("card_answer", { card_id: "c-17", choice: "Yes" }, "ans-1"), KEY, BUILD);
  check("WIRE", "card_answer: exact field set", eq(Object.keys(a).sort(), ["at", "choice", "id", "key", "op"]), Object.keys(a));
  check("WIRE", "card_answer: id is the card, at is the tap", a.op === "card_answer" && a.id === "c-17" && a.choice === "Yes" && a.at === "2026-09-24T14:00:00.000Z");

  const reading = { at: "2026-09-24T13:00:00.000Z", v: { family: 3, energy: 3, recharge: 3, balance: 3, harmony: 3, control: 3 } };
  const NOW = Date.parse("2026-09-24T14:00:00.000Z");          // one hour after the reading
  const p = CORE.pullBody(KEY, reading, NOW);
  check("WIRE", "cards pull: exact field set", eq(Object.keys(p).sort(), ["floor", "key", "op", "since"]), Object.keys(p));
  check("WIRE", "cards pull: since is always \"0\" (door defects D1/D2)", p.since === "0");
  check("WIRE", "cards pull: floor is a JSON string of the band", typeof p.floor === "string" && JSON.parse(p.floor).state === "ok");
  check("WIRE", "cards pull: never the six numbers", !/energy|family|control/.test(p.floor));
  check("WIRE", "band: never logged → unknown", eq(CORE.floorBand(null), { state: "unknown" }));
  const R = (v, at) => ({ at: at || "2026-09-24T13:00:00.000Z", v: v });
  check("WIRE", "band: B → thin", CORE.floorBand(R({ family: 3, energy: 2, recharge: 3, balance: 3, harmony: 4, control: 4 }), NOW).state === "thin");
  check("WIRE", "band: C → fail, red", (() => { const b = CORE.floorBand(R({ family: 3, energy: 3, recharge: 3, balance: 3, harmony: 1, control: 2 }), NOW); return b.state === "fail" && b.red; })());
  check("WIRE", "band: partial F → thin", CORE.floorBand(R({ energy: 3, control: 3 }), NOW).state === "thin");
  const thinV = { family: 3, energy: 2, recharge: 3, balance: 3, harmony: 4, control: 4 };
  check("WIRE", "band: a reading 11 h 59 m old still speaks", CORE.floorBand(R(thinV, "2026-09-24T02:01:00.000Z"), NOW).state === "thin");
  check("WIRE", "band: a reading 12 h old says nothing — exactly {state:\"unknown\"}", eq(CORE.floorBand(R(thinV, "2026-09-24T02:00:00.000Z"), NOW), { state: "unknown" }));
  check("WIRE", "band: an old Redline no longer holds the door", CORE.floorBand(R({ family: 3, energy: 3, recharge: 3, balance: 3, harmony: 1, control: 2 }, "2026-09-21T13:00:00.000Z"), NOW).state === "unknown");
  check("WIRE", "band: an unreadable time is not fresh", CORE.floorBand(R(thinV, "x"), NOW).state === "unknown");
  check("WIRE", "floorFresh is the one 12 h rule", CORE.FLOOR_FRESH_MS === 12 * 3600e3 && CORE.floorFresh(R(thinV), NOW) && !CORE.floorFresh(null, NOW));

  const f = CORE.wire(env("floor", { v: reading.v }, "fl-1"), KEY, BUILD);
  check("WIRE", "floor (proposed): op, event_id, at, origin, v", f.op === "floor" && f.event_id === "fl-1" && f.origin_surface === "walker" && eq(f.v, reading.v) && f.key === KEY);

  check("WIRE", "live door takes only dump + card_answer", eq(CORE.LIVE_OPS, ["dump", "card_answer"]));
  check("WIRE", "an unlisted op is never sendable (live door reads it as a dump)", !CORE.canSend("floor", []) && !CORE.canSend("done", null) && !CORE.canSend("lane", ["floor"]));
  check("WIRE", "a listed op is sendable", CORE.canSend("floor", ["floor", "done"]) && CORE.canSend("dump", []));

  const verdicts = { network: "stop", offline: "stop", unauthorized: "stop", bad_response: "stop", rate_limited: "stop", server: "stop", write_failed: "stop", http_503: "stop",
    expired: "final", not_found: "final", choice_invalid: "final", schema_or_origin: "final", receipt_id_invalid: "final", payload_too_large: "final",
    unknown_op: "refused", weird: "retry", "400": "retry" };
  for (const [code, want] of Object.entries(verdicts)) check("WIRE", "classify " + code + " → " + want, CORE.classify(code) === want, CORE.classify(code));
  // A web page where the door's JSON should be: a few plain words, never a link, host or token.
  const page = '<!DOCTYPE html><html><head><title>Error</title><style>body{color:red}</style><script>var k="zzzzzzzzzzzzzzzzzzzz"</script></head>' +
    '<body><div>Sorry, unable to open the file at this time.</div><p>See https://door.example.invalid/x/abcdefghijklmnopqrstu and door.example.invalid/y</p></body></html>';
  const hint = CORE.errorHint(page, 200);
  check("WIRE", "error page hint: the words, with the status", /^HTTP 200: Error Sorry, unable to open the file at this time\./.test(hint), hint);
  check("WIRE", "error page hint: no link, host, token, script or markup", !/example|invalid|abcdefghij|zzzz|https|<|>|color/.test(hint), hint);
  check("WIRE", "error page hint: at most 80 characters of words", CORE.errorHint("word ".repeat(100), 0).length <= 80 && CORE.errorHint("", 502) === "HTTP 502");

  check("WIRE", "door URL: https ok", CORE.doorUrlProblem("https://example.invalid/door/exec") === null);
  check("WIRE", "door URL: local test door ok", CORE.doorUrlProblem("http://127.0.0.1:9/exec") === null);
  check("WIRE", "door URL: plain http refused", CORE.doorUrlProblem("http://example.invalid/exec") === "not https");
  check("WIRE", "door URL: a key in it refused", /key/.test(CORE.doorUrlProblem("https://example.invalid/exec?key=abc") || ""));
  check("WIRE", "door URL: junk refused", CORE.doorUrlProblem("door please") === "not a URL");
  check("WIRE", "dump cap under the door's 32 KB", CORE.DUMP_MAX_BYTES <= 32768 - 512);
  {
    const K64 = "k".repeat(64);
    const plain = "a".repeat(CORE.DUMP_MAX_BYTES);
    const escaped = 'say "hi"\n'.repeat(2800).trim();                        // 25,199 bytes of text, ~33.8 KB as JSON
    check("WIRE", "the body is measured, not the text: a full-cap plain dump fits", CORE.dumpWireBytes(plain, K64, BUILD) <= CORE.DOOR_MAX_BODY, CORE.dumpWireBytes(plain, K64, BUILD));
    check("WIRE", "a dump under the text cap whose JSON escaping passes 32 KB does not fit", Buffer.byteLength(escaped) < CORE.DUMP_MAX_BYTES && CORE.dumpWireBytes(escaped, K64, BUILD) > CORE.DOOR_MAX_BODY, CORE.dumpWireBytes(escaped, K64, BUILD));
    const d = CORE.wire(env("dump", { text: "café ☕\n\"x\"" }), KEY, BUILD);
    check("WIRE", "bodyBytes is the UTF-8 length of the JSON the phone sends", CORE.bodyBytes(d) === Buffer.byteLength(JSON.stringify(d)));
    check("WIRE", "dumpWireBytes never under-counts the real body (short key, UUID id)", CORE.dumpWireBytes(escaped, "short", BUILD) >= CORE.bodyBytes(CORE.wire(env("dump", { text: escaped }), "short", BUILD)));
  }
}

/* ------------------------------------------------------------------ STORE */
{
  const v0 = {
    items: {
      a1: { id: "a1", text: "Pack lunches", at: "2026-09-20T12:00:00Z", state: "landed" },
      a2: { id: "a2", text: "Fix the gate", at: "2026-09-20T13:00:00Z", state: "started", started_at: "2026-09-20T13:01:00Z", timer_end: "2026-09-20T13:26:00Z" },
      a3: { id: "a3", text: "Garage", at: "2026-09-19T12:00:00Z", state: "parked", broken_down: true },
      a4: { id: "a4", text: "Someday", at: "2026-09-19T12:00:00Z", state: "parked" },
    },
    cards: {},
    decisions: {
      c1: { id: "c1", door: true, text: "Renew?", recommend: "Yes", options: ["Yes", "No"], kind: "SPEND", at: "2026-09-23T10:00:00Z", ttl_h: 48, state: "answered", answered: true, choice: "No", answered_at: "2026-09-23T11:00:00Z", pending_answer: { choice: "No", at: "2026-09-23T11:00:00Z" } },
      c2: { id: "c2", door: true, text: "Send it?", at: "2026-09-23T10:00:00Z", state: "answered", answered: true, choice: "Yes", answered_at: "2026-09-23T12:00:00Z" },
      c3: { id: "c3", door: true, text: "Open one", at: "2026-09-23T10:00:00Z", state: "open", later: true },
      x9: { card: "old", decision: "Yes", at: "2026-09-01T00:00:00Z" },
    },
    floor: { f1: { at: "2026-09-23T01:00:00Z", v: { family: 3, energy: 3, recharge: 3, balance: 3, harmony: 3, control: 3 } } },
    receipts: { r1: { at: "2026-09-23T01:00:00Z", receipt_id: "r1", bytes: 12 } },
    counters: { "2026-09-23": { day: "2026-09-23", done: 4 } },
  };
  const held = [
    { text: "held one", at: "2026-09-23T03:00:00Z", receipt_id: "11111111-2222-4333-8444-555555555555" },
    { text: "held two", at: "2026-09-23T03:05:00Z", k: "kx" },
  ];
  const s = CORE.migrate(v0, held, "2026-09-23T09:00:00Z");
  check("STORE", "migrate: landed → waiting", s.starts.a1.state === "waiting" && s.starts.a1.text === "Pack lunches");
  check("STORE", "migrate: started keeps its timer", s.starts.a2.state === "started" && s.starts.a2.timer_end === "2026-09-20T13:26:00Z");
  check("STORE", "migrate: broken-down parent → split", s.starts.a3.state === "split");
  check("STORE", "migrate: parked stays parked", s.starts.a4.state === "parked");
  check("STORE", "migrate: unsent answer → answered, not sent", s.cards.c1.answered && s.cards.c1.answered.choice === "No" && s.cards.c1.answered.sent === false);
  const ans = s.outbox.filter((e) => e.op === "card_answer");
  check("STORE", "migrate: unsent answer → one card_answer envelope", ans.length === 1 && ans[0].body.card_id === "c1" && ans[0].body.choice === "No", ans);
  check("STORE", "migrate: sent answer → answered, sent", s.cards.c2.answered && s.cards.c2.answered.sent === true && s.cards.c2.answered.choice === "Yes");
  check("STORE", "migrate: open door card stays open", s.cards.c3 && !s.cards.c3.answered);
  check("STORE", "migrate: artifact-era local decisions are not cards", !s.cards.x9 && !s.cards.old);
  const dumps = s.outbox.filter((e) => e.op === "dump");
  check("STORE", "migrate: held dumps → dump envelopes, in order", dumps.length === 2 && dumps[0].body.text === "held one" && dumps[1].body.text === "held two");
  check("STORE", "migrate: a held receipt_id is kept (the door sees it once)", dumps[0].id === "11111111-2222-4333-8444-555555555555");
  check("STORE", "migrate: a held dump without one gets a door-legal id", /^[A-Za-z0-9_-]{8,64}$/.test(dumps[1].id), dumps[1].id);
  check("STORE", "migrate: floor, receipts, counters carried", s.floor.f1 && s.receipts.r1 && s.counters["2026-09-23"].done === 4);
  check("STORE", "migrate: stamp carried", s.sync.stamp === "2026-09-23T09:00:00Z");
  check("STORE", "migrate: fresh phone → empty store", eq(CORE.migrate(null, [], null), CORE.emptyStore()));
  check("STORE", "migrate: junk held entries ignored", CORE.migrate(null, [null, { at: "x" }, 7], null).outbox.length === 0);
  check("STORE", "normalize: junk → empty", eq(CORE.normalize("junk"), CORE.emptyStore()));
  check("STORE", "normalize: round-trips a store", eq(CORE.normalize(JSON.parse(JSON.stringify(s))), s));
  check("STORE", "normalize: words moved back to the box survive a relaunch; junk there does not", CORE.normalize({ boxed: { text: "a thought", at: "t" } }).boxed.text === "a thought" && CORE.normalize({ boxed: { text: 7 } }).boxed === null && CORE.normalize({ boxed: { text: "" } }).boxed === null);
  { const st = CORE.emptyStore(); st.sync.ops = ["floor", "done"]; st.sync.door = "walker-door@4";
    CORE.mergePull(st, { ok: true, cards: [] }, "2026-09-24T14:00:00.000Z", { state: "ok" });
    check("STORE", "mergePull: a pull that lists no ops means none (a rolled-back door takes no floor/done/lane)", eq(st.sync.ops, []) && st.sync.door === null, st.sync); }

  const now = "2026-09-24T14:00:00.000Z";
  const card = (id, extra) => Object.assign({ id, at: "2026-09-24T12:00:00Z", kind: "WORD", text: "Q " + id, options: ["Yes", "No"], recommend: "Yes", ttl_h: 24 }, extra || {});
  let t = CORE.emptyStore();
  CORE.mergePull(t, { ok: true, cards: [card("k1"), card("k2"), card("k3")], stamp: "s1" }, now, { state: "ok" });
  check("STORE", "pull: cards land", Object.keys(t.cards).length === 3 && t.sync.stamp === "s1" && t.sync.pulled_at === now);
  t.cards.k1.answered = { choice: "Yes", at: now, sent: false };
  t.cards.k2.later = true;
  CORE.mergePull(t, { ok: true, cards: [card("k1", { text: "Q k1 v2" }), card("k2"), card("k3")] }, now, { state: "ok" });
  check("STORE", "pull: a re-sent card keeps your answer", t.cards.k1.answered && t.cards.k1.answered.choice === "Yes" && t.cards.k1.text === "Q k1 v2");
  check("STORE", "pull: a re-sent card keeps 'later'", t.cards.k2.later === true);
  CORE.mergePull(t, { ok: true, cards: [] }, now, { state: "thin" });
  check("STORE", "pull: a thin pull (door holding) retires nothing", !!t.cards.k2 && !!t.cards.k3);
  CORE.mergePull(t, { ok: true, cards: [card("k2")] }, now, { state: "ok" });
  check("STORE", "pull: a whole set retires a card answered elsewhere", !t.cards.k3);
  check("STORE", "pull: your own answered card is kept for Decided", !!t.cards.k1);
  CORE.mergePull(t, { ok: true, cards: [card("k2")], ops: ["floor", "done"], door: "walker-door@4", starts: [{ id: "st1", text: "Call the vendor", why: "the stack asked" }], brief: "Two things today." }, now, { state: "ok" });
  check("STORE", "pull (proposed): ops and door recorded", eq(t.sync.ops, ["floor", "done"]) && t.sync.door === "walker-door@4");
  check("STORE", "pull (proposed): a stack start lands waiting, marked stack", t.starts.st1 && t.starts.st1.state === "waiting" && t.starts.st1.from === "stack");
  check("STORE", "pull (proposed): brief", t.brief && t.brief.text === "Two things today.");
  delete t.starts.st1; t.gone.st1 = now;
  CORE.mergePull(t, { ok: true, cards: [card("k2")], starts: [{ id: "st1", text: "Call the vendor" }], brief: null }, now, { state: "ok" });
  check("STORE", "pull (proposed): a finished stack start is never re-filed", !t.starts.st1);
  check("STORE", "pull (proposed): brief cleared", t.brief === null);
  CORE.mergePull(t, { ok: true, cards: [{ text: "no id" }, null] }, now, { state: "thin" });
  check("STORE", "pull: cards without an id are ignored", Object.keys(t.cards).every((k) => k !== "undefined"));

  const ms = Date.parse(now);
  const u = CORE.emptyStore();
  u.cards = { e: card("e", { at: "2026-09-20T00:00:00Z" }), o: card("o", { at: "2026-09-24T09:00:00Z" }), n: card("n", { at: "2026-09-24T11:00:00Z" }), a: card("a", { answered: { choice: "x" } }), d: card("d", { dismissed: true }) };
  const order = CORE.openCards(u, ms).map((c) => c.id);
  check("STORE", "open cards: live oldest first, expired last, answered/dismissed out", eq(order, ["o", "n", "e"]), order);
  check("STORE", "expiry: at + ttl_h", CORE.cardExpired(u.cards.e, ms) && !CORE.cardExpired(u.cards.n, ms));
}

/* ------------------------------------------------------------------ CLOCK */
{
  const at = (iso) => new Date(iso);
  check("CLOCK", "01:59 EDT is not night", !CORE.isNight(at("2026-09-24T05:59:00Z")));
  check("CLOCK", "02:00 EDT is night", CORE.isNight(at("2026-09-24T06:00:00Z")));
  check("CLOCK", "05:59 EDT is night", CORE.isNight(at("2026-09-24T09:59:00Z")));
  check("CLOCK", "06:00 EDT is first light", !CORE.isNight(at("2026-09-24T10:00:00Z")));
  check("CLOCK", "02:00 EST is night (winter, not a fixed UTC hour)", CORE.isNight(at("2026-12-01T07:00:00Z")));
  check("CLOCK", "06:00 UTC in winter is 01:00 EST — not night", !CORE.isNight(at("2026-12-01T06:00:00Z")));
  check("CLOCK", "cutoff lamp absent at noon", CORE.minutesToCutoff(at("2026-09-24T16:00:00Z")) === null);
  check("CLOCK", "cutoff lamp 180 min at 23:00", CORE.minutesToCutoff(at("2026-09-25T03:00:00Z")) === 180);
  check("CLOCK", "cutoff lamp 30 min at 01:30", CORE.minutesToCutoff(at("2026-09-25T05:30:00Z")) === 30);
  check("CLOCK", "walker day: 00:30 ET still belongs to the day before", CORE.walkerDay(at("2026-09-25T04:30:00Z")) === "2026-09-24");
  check("CLOCK", "walker day: 06:00 ET is the new day", CORE.walkerDay(at("2026-09-25T10:00:00Z")) === "2026-09-25");
  check("CLOCK", "walker day: 23:59 ET is still today", CORE.walkerDay(at("2026-09-25T03:59:00Z")) === "2026-09-24");
  check("CLOCK", "fall-back night: at 00:30 EDT the cutoff is 150 real minutes away, not 90", CORE.minutesToCutoff(at("2026-11-01T04:30:00Z")) === 150, CORE.minutesToCutoff(at("2026-11-01T04:30:00Z")));
  check("CLOCK", "spring-forward night: at 01:30 EST the cutoff is 30 minutes away", CORE.minutesToCutoff(at("2026-03-08T06:30:00Z")) === 30, CORE.minutesToCutoff(at("2026-03-08T06:30:00Z")));
  check("CLOCK", "ET day rolls at ET midnight", CORE.et(at("2026-09-25T03:59:00Z")).day === "2026-09-24" && CORE.et(at("2026-09-25T04:00:00Z")).day === "2026-09-25");
  // lanes: school skips weekends — Fri + Mon done, Sat/Sun stepped over → streak 2 on Monday
  const log = { "2026-09-18": { school: true }, "2026-09-21": { school: true } };
  check("CLOCK", "lane streak steps over skip days", CORE.laneStreak(log, "school", "2026-09-21") === 2);
  check("CLOCK", "lane streak: today untouched does not break it", CORE.laneStreak({ "2026-09-23": { laundry: true } }, "laundry", "2026-09-24") === 1);
}

/* ------------------------------------------------------------------ SHIP */
{
  const shipped = { "index.html": SRC, "sw.js": read("sw.js"), "README.md": read("README.md"), "DOOR.md": read("DOOR.md"), "RECONCILIATION.md": read("RECONCILIATION.md"), "manifest.webmanifest": read("manifest.webmanifest") };
  for (const [name, blob] of Object.entries(shipped)) {
    check("SHIP", name + ": no Apps Script host", !/script\.google(usercontent)?\.com/i.test(blob));
    check("SHIP", name + ": no deployment id", !/AKfycb/.test(blob));
    check("SHIP", name + ": no /macros/s/ exec path", !/macros\/s\//.test(blob));
    check("SHIP", name + ": no key= in a query string", !/[?&]key=[^\s"'`)]/.test(blob));
    check("SHIP", name + ": no op=cards in a URL", !/[?&]op=cards/.test(blob));
    const bare = blob.replace(/'sha256-[A-Za-z0-9+/]{43}='/g, "");       // the CSP's script hashes are not secrets
    check("SHIP", name + ": no long opaque tokens", !/[A-Za-z0-9]{40,}/.test(bare), (bare.match(/[A-Za-z0-9]{40,}/) || [])[0]);
  }
  check("SHIP", "build tag set", !!BUILD);
  check("SHIP", "build tag on the first screen matches", SRC.includes('id="verNum">' + BUILD + "<"), BUILD);
  const keys = [...SRC.matchAll(/:\s*"(now\.[a-z0-9_.]+)"/g)].map((x) => x[1]);
  const K = (SRC.match(/const K = \{([^}]*)\}/) || [])[1] || "";
  const kvals = [...K.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  check("SHIP", "every storage key is in now.*", kvals.length >= 8 && kvals.every((k) => /^now\./.test(k)), kvals);
  check("SHIP", "door stays in now.door_url / now.door_key", kvals.includes("now.door_url") && kvals.includes("now.door_key"));
  check("SHIP", "localStorage only through the one helper", (SRC.match(/localStorage\./g) || []).length === 4, (SRC.match(/localStorage\./g) || []).length);
  check("SHIP", "0.9.x keys are read, never written", kvals.includes("now.walker.v0") && kvals.includes("now.walker.held") && !/ls\.set\(K\.(v0|held|stamp)\b/.test(SRC));
  check("SHIP", "exactly three network calls: the door POST, the keyless GET, and the same-origin build check", (SRC.match(/\bfetch\(/g) || []).length === 3 && /fetch\("\.\/\?build=" \+ Date\.now\(\), \{ cache: "no-store" \}\)/.test(SRC));
  check("SHIP", "door POST is text/plain (no preflight)", /method: "POST", headers: \{ "Content-Type": "text\/plain;charset=utf-8" \}/.test(SRC));
  check("SHIP", "the keyless GET carries no body", /fetch\(url, \{ method: "GET", cache: "no-store" \}\)/.test(SRC));
  check("SHIP", "no artifact runtime, no Google sign-in, no third-party script", !/window\.claude|accounts\.google|googleapis|<script src=/.test(SRC));
  check("SHIP", "no PIN lock", !/LOCK_PIN|now\.lock_fails|id="lock"/.test(SRC));
  check("SHIP", "no test harness in the shipped page", !/__t\b/.test(SRC));
  check("SHIP", "raw door fields present", SRC.includes('id="doorUrlBox"') && SRC.includes('id="doorKeyBox"'));
  const sw = read("sw.js");
  check("SHIP", "service worker touches only same-origin GETs", /req\.method !== "GET"/.test(sw) && /url\.origin !== self\.location\.origin/.test(sw));
  check("SHIP", "service worker is registered", /serviceWorker\.register\("sw\.js"\)/.test(SRC));
  const csp = (SRC.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || "";
  const dir = (d) => ((csp.match(new RegExp("(?:^|;\\s*)" + d + " ([^;]*)")) || [])[1] || "").trim().split(/\s+/).filter(Boolean);
  check("SHIP", "CSP: set in the page, before any script", !!csp && SRC.indexOf("Content-Security-Policy") < SRC.indexOf("<script"));
  check("SHIP", "CSP: only this page's own scripts run — the pinned hashes match (node test.js --pin-csp)", eq(dir("script-src").slice().sort(), scriptHashes(SRC).sort()), { pinned: dir("script-src"), actual: scriptHashes(SRC) });
  check("SHIP", "CSP: nothing else by default; no base, no forms, no plugins", eq(dir("default-src"), ["'none'"]) && eq(dir("base-uri"), ["'none'"]) && eq(dir("form-action"), ["'none'"]) && !dir("object-src").length);
  check("SHIP", "CSP: the network is this page and the door (https; plain http only on this machine)", eq(dir("connect-src"), ["'self'", "https:", "http://127.0.0.1:*", "http://localhost:*"]), dir("connect-src"));
  check("SHIP", "no inline event handlers or javascript: URLs (the CSP would block them)", !/<[^>]+\son[a-z]+\s*=/i.test(SRC.replace(/<script[\s\S]*?<\/script>/g, "")) && !/javascript:/i.test(SRC));
  check("SHIP", "manifest: Walker at the root scope", (() => { const mf = JSON.parse(read("manifest.webmanifest")); return mf.id === "/" && mf.scope === "/" && mf.start_url === "/"; })());
  // cache.addAll fails atomically — one missing SHELL path and the install never caches any of them.
  const shellSrc = (sw.match(/var SHELL = \[([^\]]*)\]/) || [])[1] || "";
  const shell = [...shellSrc.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const missingShell = shell.filter((p) => !fs.existsSync(path.join(ROOT, p === "./" ? "index.html" : p)));
  check("SHIP", "every sw.js SHELL path exists on disk", shell.length > 0 && missingShell.length === 0, missingShell);
}

/* ------------------------------------------------------------------ report */
let total = 0, bad = 0;
for (const [g, r] of Object.entries(results)) {
  const n = r.pass + r.fail.length;
  total += n; bad += r.fail.length;
  console.log((g + "        ").slice(0, 9) + " " + r.pass + "/" + n + (r.fail.length ? "   FAIL" : ""));
  for (const f of r.fail) console.log("   ✗ " + f);
}
const c = results.CONTRACT || { pass: 0, fail: [] };
console.log("\nTOTAL " + (total - bad) + "/" + total + (bad ? "  — FAILED" : "  — the port agrees with the brain (" + c.pass + " contract cases), and the wire matches the door"));
process.exit(bad ? 1 : 0);
