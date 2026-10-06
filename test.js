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
 *             The walker day rolls at 02:00 ET, including both DST nights.
 *   CLOCKVEC  contract/clock_vectors.json, the one clock every surface that faces the operator loads (R-096):
 *             the dark window and the operator day against every vector, and the file against an
 *             independent derivation. None of it is skipped.
 *   SHIP      no door URL, key or deployment id anywhere public; one namespace; the build tag.
 *   SW        the service worker's throw path: a fulfilled response, a cached page, or a network error.
 *   UPDATE    the shell's update path: a new build is OFFERED to a page that is already open, held in the
 *             dark window, and never taken without a tap.
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
   An edit to either script changes its hash; `node test.js --pin-csp` writes the new ones in.
   Pages serves the LF bytes git holds, so the pin is taken on LF — a CRLF copy (Windows,
   core.autocrlf) hashes bytes the phone never gets, and the phone runs no script at all (1.1.3). */
const scriptHashes = (src) => [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((x) => "'sha256-" + require("crypto").createHash("sha256").update(x[1], "utf8").digest("base64") + "'");
if (process.argv.includes("--pin-csp")) {
  SRC = SRC.replace(/\r\n/g, "\n");
  SRC = SRC.replace(/(<meta http-equiv="Content-Security-Policy" content="[^"]*?script-src )[^;]*;/, (_, a) => a + scriptHashes(SRC).join(" ") + ";");
  fs.writeFileSync(INDEX, SRC);
  console.log("CSP pinned: " + scriptHashes(SRC).join(" ") + "\n");
}

const results = {};
function check(group, name, ok, detail) {
  const g = (results[group] = results[group] || { pass: 0, fail: [] });
  if (ok) g.pass++; else g.fail.push(detail === undefined ? name : name + " — " + JSON.stringify(detail));
}
/* A check that cannot be asked yet. It is neither a pass nor a failure: it is counted and printed on its own, with
   its reason, so a skip never passes for a green check and never fails a suite that is honest about it. */
const skipped = [];
function skip(group, name, why) {
  results[group] = results[group] || { pass: 0, fail: [] };
  skipped.push({ group, name, why });
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
  const ar = CORE.wire(env("card_answer", { card_id: "c-17", choice: "Yes", rev: 4 }, "ans-rev"), KEY, BUILD);
  check("WIRE", "card_answer sends the rev the phone displayed, and nothing else", eq(Object.keys(ar).sort(), ["at", "choice", "id", "key", "op", "rev"]) && ar.rev === 4, ar);
  check("WIRE", "card_answer: rev 0 is a rev", CORE.wire(env("card_answer", { card_id: "c-17", choice: "Yes", rev: 0 }, "ans-0"), KEY, BUILD).rev === 0);
  check("WIRE", "card_answer: a token rev is sent as itself", CORE.wire(env("card_answer", { card_id: "c-17", choice: "Yes", rev: "r2" }, "ans-r"), KEY, BUILD).rev === "r2");
  const az = CORE.wire(env("card_answer", { card_id: "c-17", choice: "Yes", rev: "" }, "ans-e"), KEY, BUILD);
  check("WIRE", "card_answer omits rev when the card carried none", !("rev" in az) && eq(Object.keys(az).sort(), ["at", "choice", "id", "key", "op"]), az);
  check("WIRE", "card_answer omits a rev that is not a number or a token", !("rev" in CORE.wire(env("card_answer", { card_id: "c-17", choice: "Yes", rev: { n: 1 } }, "ans-j"), KEY, BUILD)));
  const shown = { id: "c", text: "old", rev: 1, answered: { choice: "Yes", at: "t", sent: false } };
  const cleared = CORE.applyAnswerFinal(shown, "stale");
  check("WIRE", "stale drops the tap so the re-pulled card can show", cleared.answered === null && cleared.rev === 1 && shown.answered.choice === "Yes");
  const kept = CORE.applyAnswerFinal(shown, "expired");
  check("WIRE", "a final answer other than stale stays, marked not taken", kept.answered.choice === "Yes" && kept.answered.refused === "expired" && !shown.answered.refused);
  check("WIRE", "stale is final and asks for a re-pull; expired is final and does not", CORE.classify("stale") === "final" && CORE.answerFollowup("stale").repull === true && CORE.answerFollowup("expired").verdict === "final" && CORE.answerFollowup("expired").repull === false);

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
  check("WIRE", "the parked cap is 300", CORE.PARKED_CAP === 300);
  {
    const box = [{ id: "d", op: "dump" }];
    for (let i = 0; i < 305; i++) box.push({ id: "p" + i, op: "floor" });
    const capped = CORE.capParked(box, []);
    const floors = capped.filter((e) => e.op === "floor");
    check("WIRE", "past 300 parked, the oldest parked records go and every sendable stays", floors.length === 300 && floors[0].id === "p5" && floors[floors.length - 1].id === "p304" && capped.some((e) => e.op === "dump"), floors.length);
    check("WIRE", "at the cap, nothing parked is dropped", CORE.capParked(box.slice(0, 301), []).length === 301);
  }

  const verdicts = { network: "stop", offline: "stop", unauthorized: "stop", bad_response: "stop", rate_limited: "stop", server: "stop", write_failed: "stop", http_503: "stop",
    expired: "final", not_found: "final", choice_invalid: "final", schema_or_origin: "final", receipt_id_invalid: "final", payload_too_large: "final", stale: "final",
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
  { const st = CORE.emptyStore();
    Object.assign(st.sync, { err_in: "bad_response", err_in_at: "2026-09-25T03:39:20.000Z", err_in_hint: "HTTP 200: walker-door",
      err_out: "bad_response", err_out_at: "2026-09-25T03:30:00.000Z", err_out_hint: "HTTP 200: Error Sorry" });
    CORE.mergePull(st, { ok: true, cards: [] }, "2026-09-25T03:39:40.000Z", { state: "ok" });
    check("STORE", "mergePull: a good pull clears IN's error, its time and its reply — and leaves OUT's own untouched",
      st.sync.err_in === null && st.sync.err_in_at === null && st.sync.err_in_hint === null &&
      st.sync.err_out === "bad_response" && st.sync.err_out_at === "2026-09-25T03:30:00.000Z" && st.sync.err_out_hint === "HTTP 200: Error Sorry", st.sync); }

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
  {
    const st = CORE.emptyStore();
    CORE.mergePull(st, { ok: true, cards: [card("r1", { rev: 2, text: "First" })] }, now, { state: "ok" });
    check("STORE", "pull keeps the rev the phone will display", st.cards.r1.rev === 2 && st.cards.r1.text === "First");
    st.cards.r1.answered = { choice: "Yes", at: now, sent: false };
    CORE.mergePull(st, { ok: true, cards: [card("r1", { rev: 3, text: "Second" })] }, now, { state: "ok" });
    check("STORE", "a newer pull replaces the displayed rev and keeps the tap", st.cards.r1.rev === 3 && st.cards.r1.text === "Second" && st.cards.r1.answered.choice === "Yes");
    CORE.mergePull(st, { ok: true, cards: [card("r1", { text: "No rev" })] }, now, { state: "ok" });
    check("STORE", "a pull that carries no rev leaves none to send", !("rev" in st.cards.r1) && st.cards.r1.text === "No rev");
  }

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
  check("CLOCK", "walker day: 01:59 ET still belongs to the day before", CORE.walkerDay(at("2026-09-24T05:59:00Z")) === "2026-09-23");
  check("CLOCK", "walker day: 02:00 ET is the new day", CORE.walkerDay(at("2026-09-24T06:00:00Z")) === "2026-09-24");
  check("CLOCK", "walker day: 06:00 ET is that same day", CORE.walkerDay(at("2026-09-24T10:00:00Z")) === "2026-09-24");
  check("CLOCK", "walker day: 23:59 ET is still today", CORE.walkerDay(at("2026-09-25T03:59:00Z")) === "2026-09-24");
  check("CLOCK", "spring-forward night: 01:59 EST is the day before and 03:00 EDT is the new day", CORE.walkerDay(at("2026-03-08T06:59:59Z")) === "2026-03-07" && CORE.walkerDay(at("2026-03-08T07:00:00Z")) === "2026-03-08");
  check("CLOCK", "fall-back night: both 01:59 hours are the day before and 02:00 EST is the new day", CORE.walkerDay(at("2026-11-01T05:59:59Z")) === "2026-10-31" && CORE.walkerDay(at("2026-11-01T06:59:59Z")) === "2026-10-31" && CORE.walkerDay(at("2026-11-01T07:00:00Z")) === "2026-11-01");
  check("CLOCK", "fall-back night: at 00:30 EDT the cutoff is 150 real minutes away, not 90", CORE.minutesToCutoff(at("2026-11-01T04:30:00Z")) === 150, CORE.minutesToCutoff(at("2026-11-01T04:30:00Z")));
  check("CLOCK", "spring-forward night: at 01:30 EST the cutoff is 30 minutes away", CORE.minutesToCutoff(at("2026-03-08T06:30:00Z")) === 30, CORE.minutesToCutoff(at("2026-03-08T06:30:00Z")));
  check("CLOCK", "ET day rolls at ET midnight", CORE.et(at("2026-09-25T03:59:00Z")).day === "2026-09-24" && CORE.et(at("2026-09-25T04:00:00Z")).day === "2026-09-25");
  // lanes: school skips weekends — Fri + Mon done, Sat/Sun stepped over → streak 2 on Monday
  const log = { "2026-09-18": { school: true }, "2026-09-21": { school: true } };
  check("CLOCK", "lane streak steps over skip days", CORE.laneStreak(log, "school", "2026-09-21") === 2);
  check("CLOCK", "lane streak: today untouched does not break it", CORE.laneStreak({ "2026-09-23": { laundry: true } }, "laundry", "2026-09-24") === 1);
}

/* ------------------------------------------------------------------ CLOCKVEC */
/* contract/clock_vectors.json is the one clock every surface that faces the operator loads (R-096): UTC instants and
   what America/Toronto answers for each — dark, and the operator day, which rolls at 02:00 ET on the wall clock (R-068).
   The walker's dark window and its day boundary both match every vector. WALKER_DAY_PENDING stays in the file so a
   later edit that sets it back to true, while walkerDay already agrees, fails the ratchet instead of skipping. */
{
  const G = "CLOCKVEC";
  const raw = read("contract/clock_vectors.json");
  const cv = JSON.parse(raw);
  const cases = Array.isArray(cv.cases) ? cv.cases : [];
  const when = (c) => new Date(c.at);
  const p2 = (n) => String(n).padStart(2, "0");

  /* the file itself */
  const KEYS = ["name", "at", "et", "dark", "operator_day", "note"];
  const malformed = cases.filter((c) => !(typeof c.name === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(c.at) && typeof c.et === "string" && typeof c.dark === "boolean" && /^\d{4}-\d\d-\d\d$/.test(c.operator_day) && Object.keys(c).every((k) => KEYS.includes(k)))).map((c) => c.name);
  check(G, "file: zone America/Toronto; every case is a name, a UTC instant, an ET label, dark and operator_day (a note at most)", cv.zone === "America/Toronto" && cases.length >= 20 && malformed.length === 0, malformed);
  check(G, "file: every instant and every name is unique", new Set(cases.map((c) => c.at)).size === cases.length && new Set(cases.map((c) => c.name)).size === cases.length);
  check(G, "file: no URL anywhere in it", !/:\/\//.test(raw));

  /* An independent derivation of the same answers: the US/Canada DST rule from first principles (2nd Sunday of March at
     02:00 EST to 1st Sunday of November at 02:00 EDT), with no Intl and no tz database, so the file is not checked by
     the clock it describes. The wall clock is read off a shifted Date with getUTC*. */
  const nthSunday = (y, mon, n) => 1 + ((7 - new Date(Date.UTC(y, mon, 1)).getUTCDay()) % 7) + 7 * (n - 1);
  const ymd = (d) => d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
  function oracle(iso) {
    const ms = Date.parse(iso), y = new Date(ms).getUTCFullYear();
    const dst = ms >= Date.UTC(y, 2, nthSunday(y, 2, 2), 7) && ms < Date.UTC(y, 10, nthSunday(y, 10, 1), 6);
    const w = new Date(ms + (dst ? -4 : -5) * 3600e3), h = w.getUTCHours();
    return { et: ymd(w) + " " + p2(h) + ":" + p2(w.getUTCMinutes()) + ":" + p2(w.getUTCSeconds()) + (dst ? " EDT" : " EST"), dark: h >= 2 && h < 6, operator_day: h < 2 ? ymd(new Date(w.getTime() - 864e5)) : ymd(w) };
  }
  const offFile = cases.filter((c) => { const o = oracle(c.at); return o.et !== c.et || o.dark !== c.dark || o.operator_day !== c.operator_day; }).map((c) => c.name);
  check(G, "file: every et, dark and operator_day agrees with an independent derivation of the ET wall clock", offFile.length === 0, offFile);

  /* required coverage, so a vector cannot be dropped quietly: both edges on an ordinary EDT day and an ordinary EST day,
     and both DST nights (spring has no 02:xx, so its 02:00 edge is the 03:00:00 EDT that follows the jump; fall has two 01:xx hours) */
  const need = [];
  for (const [day, z] of [["2026-09-24", "EDT"], ["2026-12-01", "EST"]]) for (const t of ["01:59:59", "02:00:00", "05:59:59", "06:00:00"]) need.push(day + " " + t + " " + z);
  need.push("2026-03-08 01:59:59 EST", "2026-03-08 03:00:00 EDT", "2026-03-08 05:59:59 EDT", "2026-03-08 06:00:00 EDT",
    "2026-11-01 01:59:59 EDT", "2026-11-01 01:00:00 EST", "2026-11-01 01:59:59 EST", "2026-11-01 02:00:00 EST", "2026-11-01 05:59:59 EST", "2026-11-01 06:00:00 EST");
  const missing = need.filter((e) => !cases.some((c) => c.et === e));
  check(G, "file: both edges on an ordinary EDT day, an ordinary EST day and both 2026 DST nights are all there", missing.length === 0, missing);

  /* the point of the file: a surface that stores 06:00Z or 07:00Z — a fixed UTC hour — fails at least one vector */
  for (const h0 of [6, 7]) {
    const fixedDark = (c) => { const h = when(c).getUTCHours(); return h >= h0 && h < h0 + 4; };
    const fixedDay = (c) => new Date(when(c).getTime() - h0 * 3600e3).toISOString().slice(0, 10);
    check(G, "teeth: a dark window fixed at " + p2(h0) + ":00Z fails a vector", cases.some((c) => fixedDark(c) !== c.dark));
    check(G, "teeth: a day boundary fixed at " + p2(h0) + ":00Z fails a vector", cases.some((c) => fixedDay(c) !== c.operator_day));
  }

  /* the walker's CURRENT dark window, against every vector */
  for (const c of cases) check(G, "dark · " + c.name, CORE.isNight(when(c)) === c.dark, { at: c.at, expected: c.dark, got: CORE.isNight(when(c)) });

  /* The day boundary moved to 02:00 ET in this same change (R-096 section 3). The flag is false, so every
     operator_day vector is checked. If the flag is set again while walkerDay already agrees, the ratchet fails. */
  const WALKER_DAY_PENDING = false;
  const dayMiss = cases.filter((c) => CORE.walkerDay(when(c)) !== c.operator_day);
  if (WALKER_DAY_PENDING) {
    check(G, "pending flag is current: the walker's day still differs from the vectors", dayMiss.length > 0, "walkerDay now agrees with all " + cases.length + " operator_day vectors — set WALKER_DAY_PENDING = false so the day check runs for real");
    if (dayMiss.length) skip(G, "walker day = operator_day on every vector", "PENDING PLAN v2 slice 9 + ruling D (R-096 section 3): walkerDay still rolls at 06:00, " + dayMiss.length + " of " + cases.length + " vectors differ today");
  } else {
    for (const c of cases) check(G, "operator day · " + c.name, CORE.walkerDay(when(c)) === c.operator_day, { at: c.at, expected: c.operator_day, got: CORE.walkerDay(when(c)) });
  }
}

/* ------------------------------------------------------------------ SHIP */
{
  const shipped = { "index.html": SRC, "sw.js": read("sw.js"), "README.md": read("README.md"), "DOOR.md": read("DOOR.md"), "RECONCILIATION.md": read("RECONCILIATION.md"), "manifest.webmanifest": read("manifest.webmanifest"), "contract/clock_vectors.json": read("contract/clock_vectors.json") };
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
  check("SHIP", "exactly two network calls: the door POST and the keyless GET — freshness is the worker's job now", (SRC.match(/\bfetch\(/g) || []).length === 2 && !/\?build=/.test(SRC));
  check("SHIP", "door POST is text/plain (no preflight)", /method: "POST", headers: \{ "Content-Type": "text\/plain;charset=utf-8" \}/.test(SRC));
  check("SHIP", "the keyless GET carries no body", /fetch\(url, \{ method: "GET", cache: "no-store" \}\)/.test(SRC));
  check("SHIP", "no artifact runtime, no Google sign-in, no third-party script", !/window\.claude|accounts\.google|googleapis|<script src=/.test(SRC));
  check("SHIP", "no PIN lock", !/LOCK_PIN|now\.lock_fails|id="lock"/.test(SRC));
  check("SHIP", "no test harness in the shipped page", !/__t\b/.test(SRC));
  check("SHIP", "raw door fields present", SRC.includes('id="doorUrlBox"') && SRC.includes('id="doorKeyBox"'));
  const sw = read("sw.js");
  check("SHIP", "service worker touches only same-origin GETs", /req\.method !== "GET"/.test(sw) && /url\.origin !== self\.location\.origin/.test(sw));
  check("SHIP", "service worker throw path fulfills: shell fallback, else a network error, and a navigate request is not what gets cached", /function fromCache\(req\)/.test(sw) && /return shell \|\| Response\.error\(\)/.test(sw) && /caches\.open\(CACHE\)\.then\(function \(c\) \{ return c\.put\(stored, copy\); \}\)\.catch\(function \(\) \{\}\)/.test(sw) && /req\.mode === "navigate" \? new Request\(req\.url\) : req/.test(sw));
  check("SHIP", "a tap sends the rev the card was showing, and only then", /const rev = C\.shownRev\(live\.rev\)/.test(SRC) && /if \(rev !== undefined\) body\.rev = rev/.test(SRC));
  check("SHIP", "a stale answer re-pulls", /if \(C\.answerFollowup\(code\)\.repull\) pull\(\)/.test(SRC));
  check("SHIP", "the door line shows parked N of the cap", /parked <b>" \+ parkedOut\(\)\.length \+ "<\/b> of " \+ C\.PARKED_CAP/.test(SRC) && /parked " \+ parked \+ " of " \+ C\.PARKED_CAP/.test(SRC));
  check("SHIP", "parked records are capped by the named cap", /C\.capParked\(S\.outbox, S\.sync\.ops\)/.test(SRC) && !/length - 300/.test(SRC));
  check("SHIP", "service worker is registered with a fresh update check", /serviceWorker\.register\("sw\.js", \{ scope: "\.\/", updateViaCache: "none" \}\)/.test(SRC));
  check("SHIP", "sw.js carries the build tag — a deploy that leaves sw.js alone installs no worker and offers nothing", (sw.match(/var TAG = "([^"]+)"/) || [])[1] === BUILD, { sw: (sw.match(/var TAG = "([^"]+)"/) || [])[1], page: BUILD });
  check("SHIP", "the build tag is written once, so the suite's own lift cannot match the wrong one", (SRC.match(/const BUILD = "/g) || []).length === 1, (SRC.match(/const BUILD = "/g) || []).length);
  // The floor is identified by lastBuildCheck, not by "3600e3": that is a plain hour and two unrelated
  // rules (FLOOR_FRESH_MS, doorWorked) legitimately use it, so greping for it could only ever fail.
  /* "Offered, never taken" is now true of the WORKER as well as the reload: the only self.skipWaiting()
     left in sw.js is the one the LOAD line's message triggers, so nothing is promoted without a tap. */
  check("SHIP", "the new build is offered, never taken: the worker waits for the tap and the one reload is the tap's",
    (SRC.match(/\.reload\(\)/g) || []).length === 1 && /\$\("updGo"\)\.onclick = \(\) => C\.loadTap\(\{/.test(SRC) && !/checkBuild|lastBuildCheck/.test(SRC) &&
    (sw.match(/self\.skipWaiting\(\)/g) || []).length === 1 && /e\.data\.type === "SKIP_WAITING"\) self\.skipWaiting\(\)/.test(sw),
    { reloads: (SRC.match(/\.reload\(\)/g) || []).length, skips: (sw.match(/self\.skipWaiting\(\)/g) || []).length });
  check("SHIP", "the offer is one line under the box, shipping hidden, and the callback that raises it is the latch and a render",
    /id="updRow"[^>]*hidden/.test(SRC) && /renderLamps\(\); renderHeld\(\); renderUpdate\(\);/.test(SRC) && /\(\) => \{ updOffered = true; render\(\); \}/.test(SRC));
  /* The row's logic is asserted executably in UPDATE; these lines are the whole of its application, so
     a hand-rolled value beside them (`hidden = false` at 03:00 ET) cannot slip past either. */
  check("SHIP", "the update row paints exactly C.updateRow's three values and nothing else",
    /const row = C\.updateRow\(C\.updateOffer\(updOffered\), undoOpen\(\)\);/.test(SRC) &&
    /\$\("updRow"\)\.hidden = row\.hidden;/.test(SRC) && /\$\("updText"\)\.textContent = row\.text;/.test(SRC) && /\$\("updGo"\)\.hidden = row\.buttonHidden;/.test(SRC));
  check("SHIP", "the page hands the shell its own BUILD, so the identity gate has a real input in production and not only in the suite",
    /build: BUILD, MessageChannel: MessageChannel/.test(SRC));
  check("SHIP", "one end stamp for the dark window, and it is ET", /held until 06:00 ET/.test(SRC) && !/0[67]:00Z|6 ?a\.?m/i.test(SRC));
  /* Cheap defence, not a repair: the spec forbids a worker answering its own script request anyway, and
     sw.js was never in SHELL. This green is not evidence that anything was broken — nor is the prefix
     sweep's: walker.ontologyhome.ca is a dedicated origin (CNAME), so the old unscoped sweep could only
     ever have deleted walker's own caches. Hygiene against a future co-tenant, not a live bug fix. */
  check("SHIP", "the worker leaves the browser's own sw.js request alone, and sweeps only this app's prefix", /url\.pathname\.endsWith\("\/sw\.js"\)/.test(sw) && /k\.indexOf\(PREFIX\) === 0 && k !== CACHE/.test(sw));
  check("SHIP", "the worker's message channel keeps pull first and answers exactly two more types", /if \(e\.data\.type === "pull"\) pullAll\(\);/.test(sw) && /else if \(e\.data\.type === "SKIP_WAITING"\) self\.skipWaiting\(\);/.test(sw) && /else if \(e\.data\.type === "TAG"\) \{/.test(sw));
  check("SHIP", "the LOAD tap's rescue is cleared by the boot that consumes it, so it cannot re-populate a box twice", /ls\.set\(K\.rescue, null\);/.test(SRC) && (SRC.match(/K\.rescue/g) || []).length === 3, (SRC.match(/K\.rescue/g) || []).length);
  check("SHIP", "the outbox is tried again every 5 minutes while visible — the cards clock only pulls (1.1.4)", /setInterval\(\(\) => \{ if \(document\.visibilityState === "visible" && pending\(\)\.length\) flush\(\["card_answer"\]\)\.then\(\(\) => flush\(\)\); \}, 5 \* 60 \* 1000\);/.test(SRC));
  const csp = (SRC.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || "";
  const dir = (d) => ((csp.match(new RegExp("(?:^|;\\s*)" + d + " ([^;]*)")) || [])[1] || "").trim().split(/\s+/).filter(Boolean);
  check("SHIP", "CSP: set in the page, before any script", !!csp && SRC.indexOf("Content-Security-Policy") < SRC.indexOf("<script"));
  check("SHIP", "CSP: only this page's own scripts run — the pinned hashes match (node test.js --pin-csp)", eq(dir("script-src").slice().sort(), scriptHashes(SRC).sort()), { pinned: dir("script-src"), actual: scriptHashes(SRC) });
  check("SHIP", "CSP: the page is LF, the bytes Pages serves — a CRLF copy pins hashes the phone never sees", !/\r/.test(SRC), (SRC.match(/\r/g) || []).length + " CR");
  check("SHIP", "CSP: every checkout is LF (.gitattributes eol=lf), so a Windows seat pins what ships", fs.existsSync(path.join(ROOT, ".gitattributes")) && /^\*\s+text=auto\s+eol=lf\s*$/m.test(read(".gitattributes")));
  check("SHIP", "CSP: nothing else by default; no base, no forms, no plugins", eq(dir("default-src"), ["'none'"]) && eq(dir("base-uri"), ["'none'"]) && eq(dir("form-action"), ["'none'"]) && !dir("object-src").length);
  check("SHIP", "CSP: the network is this page and the door (https; plain http only on this machine)", eq(dir("connect-src"), ["'self'", "https:", "http://127.0.0.1:*", "http://localhost:*"]), dir("connect-src"));
  check("SHIP", "no inline event handlers or javascript: URLs (the CSP would block them)", !/<[^>]+\son[a-z]+\s*=/i.test(SRC.replace(/<script[\s\S]*?<\/script>/g, "")) && !/javascript:/i.test(SRC));
  check("SHIP", "manifest: Walker at the root scope", (() => { const mf = JSON.parse(read("manifest.webmanifest")); return mf.id === "/" && mf.scope === "/" && mf.start_url === "/"; })());
  // A missing SHELL path now costs one optional file; for "./" or index.html it fails the install on
  // purpose, which leaves the previous worker and its shell in control. Either way it should be on disk.
  const shellSrc = (sw.match(/var SHELL = \[([^\]]*)\]/) || [])[1] || "";
  const shell = [...shellSrc.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const missingShell = shell.filter((p) => !fs.existsSync(path.join(ROOT, p === "./" ? "index.html" : p)));
  check("SHIP", "every sw.js SHELL path exists on disk", shell.length > 0 && missingShell.length === 0, missingShell);
}

/* ------------------------------------------------------------------ CARDS schedule */
{
  function clock() {
    let now = 0;
    const pending = [];
    return {
      now: () => now,
      setTimeout: (fn, ms) => {
        const id = { fn: fn, at: now + ms, dead: false };
        pending.push(id);
        return id;
      },
      clearTimeout: (id) => { if (id) id.dead = true; },
      advance: (ms) => {
        now += ms;
        pending.filter((id) => !id.dead && id.at <= now).forEach((id) => { id.dead = true; id.fn(); });
      },
      armed: () => pending.filter((id) => !id.dead).length
    };
  }
  function harness(outcomes) {
    const c = clock();
    let vis = "visible";
    let serial = 0;
    const left = outcomes.slice();
    let sched;
    sched = CORE.createCardScheduler({
      now: c.now,
      setTimeout: c.setTimeout,
      clearTimeout: c.clearTimeout,
      visibility: () => vis,
      pull: () => {
        const outcome = left.shift();
        sched.apply(outcome, ++serial);
        return outcome;
      }
    });
    return { c: c, sched: sched, setVis: (v) => { vis = v; }, left: left };
  }

  {
    const h = harness(["ok"]);
    h.sched.arm();
    check("CARDS", "timer armed at 5 minutes", h.c.armed() === 1 && h.sched.delayMin() === 5);
    h.c.advance(5 * 60 * 1000 - 1);
    check("CARDS", "timer has not fired early", h.left.length === 1);
    h.c.advance(1);
    check("CARDS", "timer fires the pull at 5 minutes", h.left.length === 0 && h.sched.delayMin() === 5);
  }
  {
    const h = harness(["ok"]);
    h.sched.onVisibility("visible");
    check("CARDS", "becoming visible pulls at once", h.left.length === 0 && h.sched.delayMin() === 5);
  }
  {
    const h = harness(["ok"]);
    h.sched.arm();
    h.sched.onVisibility("hidden");
    check("CARDS", "hiding clears the timer", h.c.armed() === 0 && h.sched.armed() === false);
    h.c.advance(10 * 60 * 1000);
    check("CARDS", "a hidden page does not pull", h.left.length === 1);
  }
  {
    const c = clock();
    let calls = 0;
    const sched = CORE.createCardScheduler({
      now: c.now,
      setTimeout: c.setTimeout,
      clearTimeout: c.clearTimeout,
      visibility: () => "visible",
      pull: () => { calls++; return new Promise(() => {}); }
    });
    const first = sched.start("timer");
    const second = sched.start("timer");
    check("CARDS", "a second start does not open another pull", calls === 1 && first === second);
  }
  {
    const h = harness(["err", "err", "err", "err", "err", "ok"]);
    const seen = [];
    for (let i = 0; i < 6; i++) { h.sched.start("timer"); seen.push(h.sched.delayMin()); }
    check("CARDS", "errors back off 10, 20, 40, 60, 60 then a success returns to 5", eq(seen, [10, 20, 40, 60, 60, 5]), seen);
  }
  {
    const h = harness(["ok", "ok"]);
    h.sched.onVisibility("visible");
    h.c.advance(30 * 1000);
    h.sched.onVisibility("visible");
    check("CARDS", "a visible return inside 60s of a good pull does not pull", h.left.length === 1 && h.sched.delayMin() === 5);
    h.c.advance(30 * 1000);
    h.sched.onVisibility("visible");
    check("CARDS", "a visible return after 60s pulls", h.left.length === 0 && h.sched.delayMin() === 5);
  }
  {
    const h = harness(["err", "ok"]);
    h.sched.onVisibility("visible");
    check("CARDS", "a failed visible pull backs off to 10", h.sched.delayMin() === 10 && h.left.length === 1);
    h.c.advance(30 * 1000);
    h.sched.onVisibility("visible");
    check("CARDS", "a failed pull does not count as fresh: a return 30s later tries again, and a success resets to 5 (1.1.5)", h.left.length === 0 && h.sched.delayMin() === 5);
  }
  {
    const h = harness(["ok", "err", "ok"]);
    h.sched.onVisibility("visible");
    h.c.advance(20 * 1000);
    h.sched.start("timer");
    h.c.advance(10 * 1000);
    h.sched.onVisibility("visible");
    check("CARDS", "a failure after a good pull clears its 60s: the return inside it still pulls (1.1.5)", h.left.length === 0 && h.sched.delayMin() === 5);
  }
}

/* ------------------------------------------------------------------ SW */
/* Loads the shipped sw.js and fires fetch events at it. Origins are written as "host|path" so this
   file carries no URL. The worker's own URL parser is the one under test, swapped in here. */
function finishSuite() {
  let total = 0, bad = 0;
  for (const [g, r] of Object.entries(results)) {
    const n = r.pass + r.fail.length;
    const sk = skipped.filter((s) => s.group === g);
    total += n; bad += r.fail.length;
    console.log((g + "        ").slice(0, 9) + " " + r.pass + "/" + n + (r.fail.length ? "   FAIL" : "") + (sk.length ? "   (" + sk.length + " skipped)" : ""));
    for (const f of r.fail) console.log("   ✗ " + f);
    for (const s of sk) console.log("   ~ skipped: " + s.name + " — " + s.why);
  }
  const c = results.CONTRACT || { pass: 0, fail: [] };
  console.log("\nTOTAL " + (total - bad) + "/" + total + (skipped.length ? " (" + skipped.length + " skipped)" : "") + (bad ? "  — FAILED" : "  — the port agrees with the brain (" + c.pass + " contract cases), and the wire matches the door"));
  process.exit(bad ? 1 : 0);
}

(async function () {
  function HostURL(input) {
    const s = String(input);
    const cut = s.indexOf("|");
    if (cut < 0) throw new TypeError("not a url");
    this.origin = s.slice(0, cut);
    this.pathname = s.slice(cut + 1) || "/";
    this.search = "";
    this.href = s;
  }
  function HostRequest(input, init) {
    if (input && typeof input === "object" && input.url) {
      this.url = input.url;
      this.method = input.method || "GET";
      this.mode = input.mode || "cors";
    } else {
      this.url = String(input);
      this.method = (init && init.method) || "GET";
      this.mode = (init && init.mode) || "cors";
    }
  }
  /* The fake conflates a cache's NAME with an entry inside it: seed(name, "x") stands in for "a cache
     with this name exists". That is faithful here only because sw.js touches the top level in exactly two
     ways — caches.keys() and caches.delete(k) — and never opens a named cache to read one it did not just
     create. Anything beyond the activate sweep would need a real two-level fake. */
  function makeCaches() {
    const store = new Map();
    const api = {
      puts: [],
      matches: [],
      deleted: [],
      failPut: false,
      failMatch: false,
      open() {
        return Promise.resolve({
          put(req, res) {
            const url = req && req.url ? req.url : String(req);
            api.puts.push({ url: url, mode: req && req.mode ? req.mode : "" });
            if (api.failPut) return Promise.reject(new TypeError("put"));
            store.set(String(url).split("?")[0], res);
            return Promise.resolve();
          },
          addAll() { return Promise.resolve(); },
        });
      },
      match(req, opts) {
        api.matches.push(opts || null);
        if (api.failMatch) return Promise.reject(new TypeError("match"));
        const raw = typeof req === "string" ? req : req.url;
        const key = String(raw).split("?")[0];
        return Promise.resolve(store.has(key) ? store.get(key) : undefined);
      },
      seed(url, body) { store.set(url, new Response(body, { status: 200 })); },
      keys() { return Promise.resolve([...store.keys()]); },
      delete(k) { api.deleted.push(k); store.delete(k); return Promise.resolve(true); },
    };
    return api;
  }
  function load(caches, fetchImpl, out) {
    const listeners = {};
    let skips = 0;
    const self = {
      location: { origin: "walker.test" },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      skipWaiting() { skips++; return Promise.resolve(); },
      clients: {
        matchAll() { return Promise.resolve([]); },
        claim() { return Promise.resolve(); },
        openWindow() { return Promise.resolve(); },
      },
      registration: { showNotification() { return Promise.resolve(); } },
    };
    new Function("self", "caches", "fetch", "Response", "URL", "Request", read("sw.js"))(self, caches, fetchImpl, Response, HostURL, HostRequest);
    if (out) { out.skips = () => skips; }
    return listeners;
  }
  /* install and activate: one waitUntil promise is the whole observable outcome. */
  function fireLife(listeners, type) { let out; (listeners[type] || []).forEach((fn) => fn({ waitUntil(p) { out = p; } })); return out; }
  function fireMsg(listeners, data, ports) { (listeners.message || []).forEach((fn) => fn({ data: data, ports: ports })); }
  function fire(listeners, req) {
    let out;
    const ev = { request: req, respondWith(p) { out = p; }, waitUntil() {} };
    (listeners.fetch || []).forEach((fn) => fn(ev));
    return out;
  }
  const ask = (method, url, mode) => ({ method: method, url: url, mode: mode || "cors" });
  const isErr = (res) => res instanceof Response && res.type === "error" && res.status === 0;
  async function settle(p) {
    if (!p || typeof p.then !== "function") return { called: false };
    try { return { called: true, res: await p }; }
    catch (e) { return { called: true, err: e }; }
  }

  {
    const calls = [];
    const listeners = load(makeCaches(), (r, init) => { calls.push(init); return Promise.resolve(new Response("x")); });
    const out = fire(listeners, ask("POST", "walker.test|/", "cors"));
    check("SW", "a non-GET never reaches the network", out === undefined && calls.length === 0);
    const out2 = fire(listeners, ask("GET", "elsewhere.test|/index.html", "navigate"));
    check("SW", "another origin is left alone", out2 === undefined && calls.length === 0);
  }
  {
    let init;
    const caches = makeCaches();
    const listeners = load(caches, (r, opts) => { init = opts; return Promise.resolve(new Response("page", { status: 200 })); });
    const got = await settle(fire(listeners, ask("GET", "walker.test|/", "navigate")));
    await new Promise((r) => setTimeout(r, 0));
    check("SW", "a navigation revalidates, and the response comes back", got.called && !got.err && init && init.cache === "no-cache" && await got.res.text() === "page");
    check("SW", "a navigation is cached as a plain GET, not a navigate request", caches.puts.length === 1 && caches.puts[0].mode !== "navigate" && caches.puts[0].url === "walker.test|/");
  }
  {
    const caches = makeCaches();
    caches.failPut = true;
    const unhandled = [];
    const onRej = (e) => { unhandled.push(e); };
    process.on("unhandledRejection", onRej);
    const listeners = load(caches, () => Promise.resolve(new Response("page", { status: 200 })));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/", "navigate")));
    await new Promise((r) => setTimeout(r, 20));
    process.removeListener("unhandledRejection", onRej);
    check("SW", "a cache write that throws still returns the page and does not reject", got.called && !got.err && await got.res.text() === "page" && unhandled.length === 0, unhandled.length);
  }
  {
    const caches = makeCaches();
    caches.seed("index.html", "SHELL");
    const listeners = load(caches, () => Promise.resolve(new Response("missing", { status: 404 })));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/", "navigate")));
    check("SW", "an HTTP error is not a throw: it is returned, not the shell, and not cached", got.called && !got.err && got.res.status === 404 && caches.puts.length === 0);
  }
  {
    const caches = makeCaches();
    caches.seed("index.html", "SHELL");
    const listeners = load(caches, () => Promise.reject(new TypeError("offline")));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/", "navigate")));
    check("SW", "offline navigation falls back to the cached page", got.called && !got.err && got.res.ok && await got.res.text() === "SHELL");
    check("SW", "the fallback matches ignoring the query", caches.matches.some((o) => o && o.ignoreSearch === true));
  }
  {
    const caches = makeCaches();
    const listeners = load(caches, () => Promise.reject(new TypeError("offline")));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/", "navigate")));
    check("SW", "offline navigation with no cached page fulfills as a network error and does not reject", got.called && !got.err && isErr(got.res));
  }
  {
    const caches = makeCaches();
    caches.seed("walker.test|/icon.svg", "ICON");
    const listeners = load(caches, () => Promise.reject(new TypeError("offline")));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/icon.svg?v=2", "cors")));
    check("SW", "offline, a cached file is served and the query is ignored", got.called && !got.err && await got.res.text() === "ICON");
  }
  {
    const caches = makeCaches();
    const listeners = load(caches, () => Promise.reject(new TypeError("offline")));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/icon.svg", "cors")));
    check("SW", "offline, a file that was never cached is a network error and does not reject", got.called && !got.err && isErr(got.res));
  }
  {
    const caches = makeCaches();
    caches.failMatch = true;
    const listeners = load(caches, () => Promise.reject(new TypeError("offline")));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/", "navigate")));
    check("SW", "a cache read that throws still fulfills as a network error", got.called && !got.err && isErr(got.res));
  }

  /* ---------- the install, the sweep, and the update channel ---------- */
  {
    const caches = makeCaches();
    const listeners = load(caches, (url) => (url === "index.html" ? Promise.reject(new TypeError("offline")) : Promise.resolve(new Response("x", { status: 200 }))));
    const got = await settle(fireLife(listeners, "install"));
    check("SW", "the page itself is required: a shell fetch that fails for index.html fails the install, so the previous worker keeps control", got.called && !!got.err, { called: got.called, err: got.err && got.err.message });
  }
  {
    /* The likelier real failure than a network rejection: Pages answers mid-deploy with a 404 or a 503.
       That resolves, so it reaches the not-ok guard rather than the catch — a different branch, and the
       one that was untested. A worker that activates with no page in its shell cannot serve the page
       offline, which is the single guarantee it exists for. */
    const caches = makeCaches();
    const listeners = load(caches, (url) => Promise.resolve(new Response("nope", { status: url === "index.html" ? 404 : 200 })));
    const got = await settle(fireLife(listeners, "install"));
    check("SW", "the page itself is required on a 404 too, not only on a network rejection: the install fails and the page is not cached",
      got.called && !!got.err && !caches.puts.some((p) => p.url === "index.html"), { called: got.called, err: got.err && got.err.message, puts: caches.puts.map((p) => p.url) });
  }
  {
    const caches = makeCaches();
    const listeners = load(caches, (url) => Promise.resolve(new Response("x", { status: url === "icon-512.png" ? 404 : 200 })));
    const got = await settle(fireLife(listeners, "install"));
    check("SW", "an optional shell file that answers 404 is not cached and does not abort the install", got.called && !got.err && caches.puts.length === 6 && !caches.puts.some((p) => p.url === "icon-512.png"), { err: got.err && got.err.message, puts: caches.puts.map((p) => p.url) });
  }
  {
    /* "Offered, never taken" has to be true of the worker too. An install that skipped waiting took the
       worker with no tap, swept the running build's shell out from under the open page, and left
       registration.waiting empty — making the page's waiting branch dead code and leaving it nothing to
       ask the new build's TAG. The LOAD line's message is the only promoter. */
    const out = {};
    const caches = makeCaches();
    const listeners = load(caches, () => Promise.resolve(new Response("x", { status: 200 })), out);
    const got = await settle(fireLife(listeners, "install"));
    check("SW", "the install does not take the worker: no skipWaiting, so registration.waiting is really populated and only the tap promotes it",
      got.called && !got.err && out.skips() === 0, { err: got.err && got.err.message, skips: out.skips() });
  }
  {
    const caches = makeCaches();
    const fetched = [];
    const listeners = load(caches, (url, init) => { fetched.push({ url: url, init: init }); return url === "icon-512.png" ? Promise.reject(new TypeError("offline")) : Promise.resolve(new Response("x", { status: 200 })); });
    const got = await settle(fireLife(listeners, "install"));
    check("SW", "one bad optional shell file does not abort the install", got.called && !got.err && caches.puts.length === 6, { err: got.err && got.err.message, puts: caches.puts.length });
    check("SW", "the install does not read the host's HTTP cache, so a new build's shell cannot be the last deploy's files", fetched.length === 7 && fetched.every((f) => f.init && f.init.cache === "reload"), fetched.map((f) => (f.init || {}).cache));
  }
  {
    const caches = makeCaches();
    caches.seed("now-shell-1.1.6", "x");
    caches.seed("other-app-v1", "x");
    const listeners = load(caches, () => Promise.resolve(new Response("x", { status: 200 })));
    const got = await settle(fireLife(listeners, "activate"));
    check("SW", "activate deletes older builds of this app and nothing else on the origin", got.called && !got.err && eq(caches.deleted, ["now-shell-1.1.6"]), caches.deleted);
  }
  {
    const out = {};
    const listeners = load(makeCaches(), () => Promise.resolve(new Response("x", { status: 200 })), out);
    fireMsg(listeners, { type: "pull" });
    check("SW", "a pull message does not wake a waiting worker — the update channel did not swallow the existing one", out.skips() === 0, out.skips());
    fireMsg(listeners, { type: "SKIP_WAITING" });
    check("SW", "the LOAD line's message wakes a waiting worker", out.skips() === 1, out.skips());
    fireMsg(listeners, { type: "something_else" });
    check("SW", "an unknown message does neither — the page cannot make the worker act by sending anything it likes", out.skips() === 1, out.skips());
  }
  {
    /* The identity gate's one real input. The page asks a worker which build it is before it offers
       anything, because a cold launch after a deploy is ALREADY the new build. The answer goes back down
       the port the page sent, so it reaches the one asker and nothing is broadcast. */
    const out = {};
    const listeners = load(makeCaches(), () => Promise.resolve(new Response("x", { status: 200 })), out);
    let replied = null;
    fireMsg(listeners, { type: "TAG" }, [{ postMessage(d) { replied = d; } }]);
    check("SW", "the worker says which build it is, down the port the page sent, and that tag is this build", eq(replied, { type: "TAG", tag: BUILD }), { replied: replied, build: BUILD });
    check("SW", "being asked for the tag does not promote the worker — the question is not the tap", out.skips() === 0, out.skips());
  }
  {
    const caches = makeCaches();
    caches.seed("walker.test|/sw.js", "WORKER");
    const listeners = load(caches, () => Promise.reject(new TypeError("offline")));
    const got = await settle(fire(listeners, ask("GET", "walker.test|/sw.js", "cors")));
    check("SW", "the browser's check for a new build is never answered by the worker", got.called === false && caches.matches.length === 0 && caches.puts.length === 0, { called: got.called, matches: caches.matches.length, puts: caches.puts.length });
  }

  /* ---------- KEYHINT: a Google API key shape in the door field is hinted, never refused ---------- */
  {
    const doorKey43 = "k-" + "x".repeat(41);
    const aiKey = "AIza" + "Y".repeat(35);
    const aqKey = "AQ." + "Z".repeat(20);
    check("KEYHINT", "AIza… gives the save hint", CORE.doorKeyGoogleSaveToast(aiKey) && CORE.doorKeyGoogleSaveToast(aiKey).includes("Google API key"));
    check("KEYHINT", "AQ.… gives the save hint", CORE.doorKeyGoogleSaveToast(aqKey) && CORE.doorKeyGoogleSaveToast(aqKey).includes("Google API key"));
    check("KEYHINT", "a 43-character random key gives none", CORE.doorKeyGoogleSaveToast(doorKey43) === null, CORE.doorKeyGoogleSaveToast(doorKey43));
    check("KEYHINT", "the empty string gives none", CORE.doorKeyGoogleSaveToast("") === null);
    check("KEYHINT", "the toast text never contains the key", !CORE.doorKeyGoogleSaveToast(aiKey).includes("YYYY"));
    check("KEYHINT", "unauthorized sync note names the Google shape", CORE.doorKeyGoogleSyncNote(aiKey).includes("Google API key"));
  }

  /* ---------- UPDATE: how a home-screen walker learns a new build exists ----------
     CORE.startShellUpdates takes everything it touches as arguments, so four listener fakes stand in
     for the browser and none of this needs a page, a DOM or storage. The page-side wiring itself is
     pinned by the SHIP greps, the way the rest of the app IIFE is. */
  function target(extra) {
    const l = {};
    const t = {
      addEventListener(type, fn) { (l[type] = l[type] || []).push(fn); },
      removeEventListener(type, fn) { l[type] = (l[type] || []).filter((f) => f !== fn); },
      emit(type) { (l[type] || []).slice().forEach((fn) => fn({ type: type })); },
    };
    return Object.assign(t, extra || {});
  }
  const spot = (protocol, hostname) => { const s = { protocol: protocol || "https:", hostname: hostname || "walker.test", reloads: 0, reload() { s.reloads++; } }; return s; };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const ticks = async (n) => { for (let i = 0; i < n; i++) await tick(); };
  /* A two-port channel, the shape startShellUpdates asks a worker for its TAG down. Synchronous, so a
     worker that answers resolves on the next microtask and a worker that does not resolves on the wait. */
  function FakeChannel() {
    const p1 = { onmessage: null }, p2 = { onmessage: null };
    p1.postMessage = (d) => { if (p2.onmessage) p2.onmessage({ data: d }); };
    p2.postMessage = (d) => { if (p1.onmessage) p1.onmessage({ data: d }); };
    this.port1 = p1; this.port2 = p2;
  }
  /* A worker that answers {type:"TAG"} the way sw.js does, rather than carrying the tag as a field. */
  const answersTag = (state, tag) => { const w = target({ state: state }); w.postMessage = (msg, ports) => { if (msg && msg.type === CORE.TAG_ASK && ports && ports[0]) ports[0].postMessage({ type: "TAG", tag: tag }); }; return w; };

  {
    const at = (iso) => new Date(iso);

    /* ---- the one clause that decides whether a LOAD line is ever shown ---- */
    check("UPDATE", "the first install offers nothing — there is no old build running to replace",
      CORE.shouldOfferReload({ hadController: false, controllerChanged: true }) === false &&
      CORE.shouldOfferReload({ hadController: false, workerState: "installed" }) === false);
    check("UPDATE", "an open page offers when a new worker is ready — both paths a real deploy takes",
      CORE.shouldOfferReload({ hadController: true, workerState: "installed" }) === true &&
      CORE.shouldOfferReload({ hadController: true, controllerChanged: true }) === true);
    check("UPDATE", "installing and activating do not offer — a half-installed worker puts no LOAD line on screen",
      CORE.shouldOfferReload({ hadController: true, workerState: "installing" }) === false &&
      CORE.shouldOfferReload({ hadController: true, workerState: "activating" }) === false);

    /* ---- which origins get a worker at all ---- */
    check("UPDATE", "https anywhere and localhost register; a plain http host does not",
      CORE.secureForServiceWorker({ protocol: "https:", hostname: "walker.test" }) === true &&
      CORE.secureForServiceWorker({ protocol: "http:", hostname: "localhost" }) === true &&
      CORE.secureForServiceWorker({ protocol: "http:", hostname: "files.example" }) === false);
    check("UPDATE", "127.0.0.1 is deliberately left out — it is the origin the e2e suite serves its no-worker scenarios from",
      CORE.secureForServiceWorker({ protocol: "http:", hostname: "127.0.0.1" }) === false);

    /* ---- the dark window: the check still runs, the offer is held ---- */
    check("UPDATE", "the offer is held in the dark window and asked at first light",
      CORE.updateOffer(true, at("2026-09-24T06:00:00Z")) === "held" &&
      CORE.updateOffer(true, at("2026-09-24T10:00:00Z")) === "ready" &&
      CORE.updateOffer(false, at("2026-09-24T10:00:00Z")) === "none",
      [CORE.updateOffer(true, at("2026-09-24T06:00:00Z")), CORE.updateOffer(true, at("2026-09-24T10:00:00Z")), CORE.updateOffer(false, at("2026-09-24T10:00:00Z"))]);
    check("UPDATE", "the window is the ET wall clock, not a stored UTC hour — the winter pair moves with it",
      CORE.updateOffer(true, at("2026-12-01T07:00:00Z")) === "held" &&
      CORE.updateOffer(true, at("2026-12-01T06:00:00Z")) === "ready",
      [CORE.updateOffer(true, at("2026-12-01T07:00:00Z")), CORE.updateOffer(true, at("2026-12-01T06:00:00Z"))]);

    /* ---- the row on screen: the three values the page paints, so the promise is not a string ----
       updateOffer's "held" only mattered if something withheld the button. These assert the rendered
       triple instead, one check per state: the LOAD button cannot be shown at 03:00 ET and still pass. */
    check("UPDATE", "no offer renders nothing at all — no row, no text, no button",
      eq(CORE.updateRow("none"), { hidden: true, text: "", buttonHidden: true }), CORE.updateRow("none"));
    check("UPDATE", "held renders the line with its ET end stamp and WITHHOLDS the button — nothing is asked at 03:00 ET",
      eq(CORE.updateRow("held"), { hidden: false, text: "New build ready — held until 06:00 ET", buttonHidden: true }), CORE.updateRow("held"));
    check("UPDATE", "ready renders the line and the button, and that is the only state that does",
      eq(CORE.updateRow("ready"), { hidden: false, text: "New build ready", buttonHidden: false }), CORE.updateRow("ready"));
    check("UPDATE", "an open UNDO window withholds the button: the act it guards is already committed and a reload would make it permanently un-undoable",
      eq(CORE.updateRow("ready", true), { hidden: false, text: "New build ready — after the UNDO", buttonHidden: true }), CORE.updateRow("ready", true));
    check("UPDATE", "the dark window beats an open UNDO window, and no state but ready ever shows the button",
      CORE.updateRow("held", true).buttonHidden === true && CORE.updateRow("none", true).hidden === true && CORE.updateRow("none", true).buttonHidden === true &&
      ["none", "held", "ready"].filter((s) => !CORE.updateRow(s).buttonHidden).join() === "ready");

    /* ---- the tap's rescue: the operator's own input is never what a reload costs (standing law 4) ----
       Only the DUMP box used to be kept. A half-set floor reading, the STUCK split box and a
       typed-but-unsaved door URL or key died on the reload while the page's comment claimed otherwise. */
    check("UPDATE", "the DUMP box's unsent words are kept, and whitespace is not words — the README's one stated promise, now asserted",
      (CORE.shellRescue({ box: "unsent" }) || {}).box === "unsent" && CORE.shellRescue({ box: "\n \t " }) === null,
      [CORE.shellRescue({ box: "unsent" }), CORE.shellRescue({ box: "\n \t " })]);
    check("UPDATE", "a half-set floor reading is kept by vector, and a non-number is not a reading",
      eq(CORE.shellRescue({ draft: { family: 0, energy: 3, control: "4", junk: 9 } }), { draft: { family: 0, energy: 3 } }),
      CORE.shellRescue({ draft: { family: 0, energy: 3, control: "4", junk: 9 } }));
    check("UPDATE", "the STUCK split box, which start it was breaking down, and a typed-but-unsaved door URL or key are all kept",
      eq(CORE.shellRescue({ split: "step one\nstep two", pick: "s-1", url: "https://door.test/exec", key: "k-1" }),
        { split: "step one\nstep two", pick: "s-1", url: "https://door.test/exec", key: "k-1" }),
      CORE.shellRescue({ split: "step one\nstep two", pick: "s-1", url: "https://door.test/exec", key: "k-1" }));
    check("UPDATE", "nothing typed anywhere is null, not an empty object — the stash is cleared rather than left for the next boot to re-populate",
      CORE.shellRescue({ box: "", split: "", pick: null, url: "", key: "", draft: {} }) === null && CORE.shellRescue() === null && CORE.shellRescue({}) === null);
    {
      /* The tap itself, driven for real with a fake store and a fake shell — the one thing a grep for
         `$("updGo").onclick` could never see: that the handler actually applies, and rescues first. */
      const calls = [];
      CORE.loadTap({
        typed: { box: "half a thought", split: "one\ntwo", pick: "s-9", url: "https://door.test/exec", key: "k-1", draft: { family: 2, energy: 4 } },
        stash: (r) => calls.push(["stash", r]),
        apply: () => calls.push(["apply", null]),
      });
      check("UPDATE", "the LOAD tap stashes what a reload would drop and THEN applies — a handler that returns early fails here, not only on a phone",
        calls.length === 2 && calls[0][0] === "stash" && calls[1][0] === "apply" &&
        eq(calls[0][1], { box: "half a thought", split: "one\ntwo", pick: "s-9", url: "https://door.test/exec", key: "k-1", draft: { family: 2, energy: 4 } }), calls);
      const bare = [];
      CORE.loadTap({ typed: {}, stash: (r) => bare.push(["stash", r]), apply: () => bare.push(["apply", null]) });
      check("UPDATE", "a tap with nothing open still applies — the rescue is not a gate on the tap", eq(bare, [["stash", null], ["apply", null]]), bare);
    }

    /* ---- the tap ---- */
    {
      let posted = null;
      const worker = { state: "installed", postMessage(mm) { posted = mm; } };
      const sw = target({});
      const loc = spot();
      CORE.applyShellUpdate({ registration: { waiting: worker }, serviceWorker: sw, location: loc });
      check("UPDATE", "LOAD wakes the waiting worker and loads only once it has the page", eq(posted, { type: CORE.SKIP_WAITING }) && loc.reloads === 0, { posted: posted, reloads: loc.reloads });
      sw.emit("controllerchange");
      sw.emit("controllerchange");
      check("UPDATE", "two controllerchange events are one reload", loc.reloads === 1, loc.reloads);
    }
    {
      const loc = spot();
      CORE.applyShellUpdate({ registration: {}, serviceWorker: target({}), location: loc });
      const loc2 = spot();
      CORE.applyShellUpdate({ registration: null, serviceWorker: target({}), location: loc2 });
      check("UPDATE", "LOAD loads immediately when there is no waiting worker — and when the registration handle was lost", loc.reloads === 1 && loc2.reloads === 1, [loc.reloads, loc2.reloads]);
    }
    {
      const worker = { state: "activated", postMessage() {} };
      const loc = spot();
      CORE.applyShellUpdate({ registration: { waiting: worker }, serviceWorker: target({}), location: loc });
      check("UPDATE", "LOAD loads immediately when the waiting worker has already claimed the page", loc.reloads === 1, loc.reloads);
    }
    {
      const worker = { state: "installed", postMessage() { throw new TypeError("gone"); } };
      const sw = target({});
      const loc = spot();
      CORE.applyShellUpdate({ registration: { waiting: worker }, serviceWorker: sw, location: loc });
      const after = loc.reloads;
      sw.emit("controllerchange");
      check("UPDATE", "a worker that refuses the message still loads, exactly once", after === 1 && loc.reloads === 1, [after, loc.reloads]);
    }
    {
      /* controllerchange is the signal but it is the browser's to send: if activate throws under storage
         pressure, or iOS does not deliver it in a standalone window, LOAD must not be a dead button with
         no feedback. Now that the worker really waits, this is the live path, not a corner. */
      const worker = { state: "installed", postMessage() {} };
      const loc = spot();
      CORE.applyShellUpdate({ registration: { waiting: worker }, serviceWorker: target({}), location: loc, applyWaitMs: 0 });
      check("UPDATE", "LOAD does not reload before the worker has the page", loc.reloads === 0, loc.reloads);
      await ticks(2);
      check("UPDATE", "LOAD is never a dead button: no controllerchange inside the bounded wait and it loads anyway", loc.reloads === 1, loc.reloads);
    }
    {
      const worker = { state: "installed", postMessage() {} };
      const sw = target({});
      const loc = spot();
      CORE.applyShellUpdate({ registration: { waiting: worker }, serviceWorker: sw, location: loc, applyWaitMs: 0 });
      sw.emit("controllerchange");
      await ticks(2);
      check("UPDATE", "the real controllerchange cancels the fallback — one reload, not two", loc.reloads === 1, loc.reloads);
    }

    /* ---- the mount: registration, the three triggers, and what each worker state does ---- */
    function mount(o) {
      o = o || {};
      const st = { updated: 0, offers: 0 };
      const reg = target({ waiting: o.waiting || null, installing: o.installing || null, update() { st.updated++; return Promise.resolve(); } });
      const sw = target({ controller: o.controller === undefined ? {} : o.controller, register() { st.registered = true; return Promise.resolve(reg); } });
      const doc = target({ visibilityState: "visible" });
      const win = target({});
      const loc = spot(o.protocol, o.hostname);
      const h = CORE.startShellUpdates({
        navigator: { serviceWorker: sw }, location: loc, document: doc, window: win, build: o.build,
        MessageChannel: o.MessageChannel || FakeChannel, tagWaitMs: o.tagWaitMs, applyWaitMs: o.applyWaitMs,
        typed: o.typed, undoBusy: o.undoBusy, now: o.now,
      }, () => { st.offers++; });
      return Object.assign(st, { reg: reg, sw: sw, doc: doc, win: win, loc: loc, h: h });
    }

    {
      const m = mount({ protocol: "http:", hostname: "files.example" });
      await tick();
      m.h.stop();
      m.h.apply();
      check("UPDATE", "an insecure origin registers nothing and stop()/apply() are safe no-ops", !m.registered && m.loc.reloads === 0 && m.updated === 0, { registered: !!m.registered, reloads: m.loc.reloads });
    }
    {
      const m = mount();
      await tick();
      check("UPDATE", "a check runs as soon as the registration lands — a cold launch onto a stale shell asks at once", m.updated === 1, m.updated);
      m.doc.visibilityState = "hidden";
      m.doc.emit("visibilitychange");
      check("UPDATE", "going away asks nothing", m.updated === 1, m.updated);
      m.doc.visibilityState = "visible";
      m.doc.emit("visibilitychange");
      m.win.emit("focus");
      m.win.emit("pageshow");
      check("UPDATE", "coming forward asks three ways, with no floor", m.updated === 4, m.updated);
      m.h.stop();
      m.doc.emit("visibilitychange");
      m.win.emit("focus");
      check("UPDATE", "stop() unsubscribes", m.updated === 4, m.updated);
    }
    {
      const m = mount();
      await tick();
      const w = target({ state: "installing" });
      m.reg.installing = w;
      m.reg.emit("updatefound");
      check("UPDATE", "an installing worker is not an offer", m.offers === 0, m.offers);
      w.state = "installed";
      w.emit("statechange");
      check("UPDATE", "a ready worker is one offer", m.offers === 1, m.offers);
    }
    {
      const m = mount();
      await tick();
      m.reg.installing = target({ state: "installed" });
      m.reg.emit("updatefound");
      check("UPDATE", "a worker already installed when it is watched still offers, with no event coming — the Safari-resume case", m.offers === 1, m.offers);
    }
    {
      const m = mount({ waiting: target({ state: "installed" }) });
      await tick();
      check("UPDATE", "a worker already waiting at register time is watched, with no updatefound ever fired", m.offers === 1, m.offers);
      m.sw.emit("controllerchange");
      m.sw.emit("controllerchange");
      check("UPDATE", "the offer is latched — the row cannot be re-raised or double-rendered", m.offers === 1, m.offers);
    }
    {
      /* The Safari-resume case the live controller re-read exists for, and the only vector that
         separates it from the captured flag: nothing controlled this page at register time, a worker
         reaches "installed" while the app is hidden, and the page IS controlled by the time its state
         is read. The captured flag suppresses the first install; this read catches the resume. */
      const m = mount({ controller: null });
      await tick();
      const w = target({ state: "installing" });
      m.reg.installing = w;
      m.reg.emit("updatefound");
      m.sw.controller = {};                         // controlled now, though it was not at register
      w.state = "installed";
      w.emit("statechange");
      check("UPDATE", "uncontrolled at register time, controlled by the time a worker installs: still one offer — the live read, not the captured flag", m.offers === 1, m.offers);
    }
    {
      /* The latch the first install arms. Nothing to reload when the first worker claims the page;
         the NEXT controllerchange is a real new build and does offer. */
      const m = mount({ controller: null });
      await tick();
      m.sw.emit("controllerchange");
      check("UPDATE", "the first install claiming the page offers nothing", m.offers === 0, m.offers);
      m.sw.emit("controllerchange");
      check("UPDATE", "the controllerchange after the first install does offer — the latch was armed, not left false", m.offers === 1, m.offers);
    }

    /* ---- build identity: the clause that tells "you are stale" from "the worker just caught up" ----
       A cold launch after a deploy is served network-first by the worker that is ALREADY installed —
       sw.js:62 here and `git show HEAD:sw.js` both fetch a navigation with cache:"no-cache" — so the
       page that boots IS the new build, with its new BUILD in the header, while the OLD worker is still
       the controller. The browser then finds the new sw.js, installs it, skipWaiting()s and claims the
       page: statechange "installed" and controllerchange both arrive. A decision made on the controller
       transition alone cannot tell that apart from a genuinely stale page, so it puts "New build ready"
       under the box on a page that has nothing to load, after every deploy, on the one screen whose
       whole value is that the line is true. The deleted checkBuild() held the only identity comparison
       in the app (m[1] !== BUILD) and nothing replaced it.
       So the offer is gated on identity, not on a transition: the running page's BUILD against the new
       worker's TAG. EQUAL suppresses. DIFFERENT still offers. UNKNOWN still offers — standing law 1,
       gating fails open, never closed; a page that cannot learn the tag must not go silent on updates.
       (Which field carries the tag is the fix's choice — a {type:"TAG"} reply, the scriptURL, the fetched
       bytes. These fakes name it `workerTag` on the decision and `tag` on the worker; move them with it.) */
    check("UPDATE", "the running page's BUILD equals the new worker's TAG — no offer, however the controller moved",
      CORE.shouldOfferReload({ hadController: true, controllerChanged: true, pageBuild: "1.1.8", workerTag: "1.1.8" }) === false &&
      CORE.shouldOfferReload({ hadController: true, workerState: "installed", pageBuild: "1.1.8", workerTag: "1.1.8" }) === false &&
      CORE.shouldOfferReload({ hadController: true, controllerChanged: true, pageBuild: "1.1.7", workerTag: "1.1.8" }) === true &&
      CORE.shouldOfferReload({ hadController: true, controllerChanged: true }) === true,
      {
        equal_controllerchange: CORE.shouldOfferReload({ hadController: true, controllerChanged: true, pageBuild: "1.1.8", workerTag: "1.1.8" }),
        equal_installed: CORE.shouldOfferReload({ hadController: true, workerState: "installed", pageBuild: "1.1.8", workerTag: "1.1.8" }),
        stale_offers: CORE.shouldOfferReload({ hadController: true, controllerChanged: true, pageBuild: "1.1.7", workerTag: "1.1.8" }),
        unknown_offers: CORE.shouldOfferReload({ hadController: true, controllerChanged: true }),
      });
    {
      /* The same thing as the sequence a real deploy actually runs, end to end through the mount:
         old worker controlling, page already the new build, new worker installs and claims. */
      const m = mount({ build: "1.1.8" });
      await tick();
      const w = target({ state: "installing", tag: "1.1.8" });
      m.reg.installing = w;
      m.reg.emit("updatefound");
      w.state = "installed";
      w.emit("statechange");
      m.sw.emit("controllerchange");
      await ticks(3);
      check("UPDATE", "a cold launch after a deploy offers nothing — the page boots as the new build and the worker only catches up", m.offers === 0, m.offers);
    }
    {
      /* The counterpart, so the check above cannot pass by never offering: a page left open across a
         deploy is genuinely stale, and that is the case the LOAD line exists for. */
      const m = mount({ build: "1.1.7" });
      await tick();
      const w = target({ state: "installing", tag: "1.1.8" });
      m.reg.installing = w;
      m.reg.emit("updatefound");
      w.state = "installed";
      w.emit("statechange");
      await ticks(3);
      check("UPDATE", "a page left open across a deploy is stale and does get the one offer", m.offers === 1, m.offers);
    }

    check("UPDATE", "quiet auto-apply: cold launch with nothing typed and a waiting worker",
      CORE.shouldAutoApplyShellUpdate({ coldLaunch: true, typed: {}, now: at("2026-09-24T16:00:00Z"), undoBusy: false }) &&
      CORE.shouldQuietShellActivate({ hadController: true, workerState: "installed", pageBuild: "1.1.7", workerTag: "1.1.8" }));
    check("UPDATE", "quiet auto-apply: something typed blocks auto-apply",
      !CORE.shouldAutoApplyShellUpdate({ coldLaunch: true, typed: { box: "words" }, now: at("2026-09-24T16:00:00Z"), undoBusy: false }));
    check("UPDATE", "quiet auto-apply: the dark window blocks auto-apply",
      !CORE.shouldAutoApplyShellUpdate({ coldLaunch: true, typed: {}, now: at("2026-09-24T06:00:00Z"), undoBusy: false }));
    check("UPDATE", "quiet auto-apply: warm resume is not cold launch",
      !CORE.shouldAutoApplyShellUpdate({ coldLaunch: false, typed: {}, now: at("2026-09-24T16:00:00Z"), undoBusy: false }));
    {
      const waiting = answersTag("installed", "1.1.8");
      const m = mount({ build: "1.1.7", waiting: waiting, typed: () => ({}), undoBusy: () => false, now: () => at("2026-09-24T16:00:00Z"), tagWaitMs: 0, applyWaitMs: 0 });
      await ticks(4);
      m.h.stop();
      check("UPDATE", "cold launch with a waiting worker auto-applies instead of offering LOAD", m.loc.reloads === 1 && m.offers === 0, { reloads: m.loc.reloads, offers: m.offers });
    }

    /* ---- how the tag is actually learned: a message, bounded, and never a silent failure ----
       The tag arrives AFTER the transition that prompted it, so the decision is taken when it resolves.
       The wait is bounded and its timeout resolves UNKNOWN, which offers (standing law 1): an identity
       query must not become a new way for updates to go quiet. */
    {
      const env = { MessageChannel: FakeChannel };
      const silent = { state: "installed", postMessage() {} };
      const broken = { state: "installed", postMessage() { throw new TypeError("gone"); } };
      const got = await Promise.all([
        CORE.askWorkerTag(answersTag("installed", "1.1.9"), env),
        CORE.askWorkerTag(silent, env, 0),
        CORE.askWorkerTag(broken, env),
        CORE.askWorkerTag(null, env),
        CORE.askWorkerTag({ tag: "1.1.4" }, { MessageChannel: null }),
      ]);
      check("UPDATE", "a worker answers which build it is; one that stays silent, cannot be asked, or is not there resolves UNKNOWN — never a hang",
        eq(got, ["1.1.9", "", "", "", "1.1.4"]), got);
    }
    {
      /* The deploy sequence again, with the tag LEARNED by message the way sw.js answers it, rather
         than handed over as a field on a fake. This is the plumbing the production page runs. */
      const m = mount({ build: "1.1.7" });
      await tick();
      const w = answersTag("installing", "1.1.7");
      m.reg.installing = w;
      m.reg.emit("updatefound");
      w.state = "installed";
      w.emit("statechange");
      m.sw.emit("controllerchange");
      await ticks(3);
      check("UPDATE", "the tag learned by message suppresses the offer too — the gate does not depend on a fake's field", m.offers === 0, m.offers);
    }
    {
      const m = mount({ build: "1.1.6" });
      await tick();
      const w = answersTag("installing", "1.1.7");
      m.reg.installing = w;
      m.reg.emit("updatefound");
      w.state = "installed";
      w.emit("statechange");
      await ticks(3);
      check("UPDATE", "the tag learned by message still offers when the page really is behind it", m.offers === 1, m.offers);
    }
    {
      /* The worker never answers. The gate fails OPEN: the offer stands rather than the feature going
         silent on a phone whose worker cannot be asked. */
      const m = mount({ build: "1.1.7", tagWaitMs: 0 });
      await tick();
      const w = target({ state: "installing" });
      w.postMessage = () => {};
      m.reg.installing = w;
      m.reg.emit("updatefound");
      w.state = "installed";
      w.emit("statechange");
      await ticks(4);
      check("UPDATE", "a tag that never arrives still offers — the identity gate fails open, never closed and never silent", m.offers === 1, m.offers);
    }
  }

  finishSuite();
})().catch((e) => {
  console.log("FAIL: SW " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
