/*
 * e2e.mjs — the real page, in headless Chromium, against a door that answers like the live
 * one (test/mock-door.mjs). The page and the door sit on different origins, so the CORS
 * path the phone depends on (text/plain POST → 302 → echo) is exercised, not assumed.
 *
 *   node test/e2e.mjs            (needs Playwright; Chromium must already be installed)
 *   PW=<path to playwright/index.mjs> node test/e2e.mjs
 *
 * Each block is one thing the walker promises. Screens are written to test/shots/ (ignored
 * by git) so a person can look at them.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockDoor } from "./mock-door.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SHOTS = path.join(HERE, "shots");
const PW = process.env.PW || "playwright";
const { chromium } = await import(PW).catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

/* ---------- a static host for the page, like Pages ---------- */
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
function serveStatic(q, r) {
  let f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0].split("#")[0]));
  if (!f.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
  if (f.endsWith("/")) f += "index.html";
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(b); });
}
const host = http.createServer(serveStatic);
await new Promise((ok) => host.listen(0, "127.0.0.1", ok));
const APP = `http://127.0.0.1:${host.address().port}/`;

/* ---------- harness ---------- */
const browser = await chromium.launch();
const results = [];
const errors = [];
fs.mkdirSync(SHOTS, { recursive: true });
async function block(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name]); console.log("  ✓ " + name + "  (" + ((Date.now() - t0) / 1000).toFixed(1) + "s)"); }
  catch (e) { results.push([false, name]); console.log("  ✗ " + name + "\n      " + String(e && e.stack || e).split("\n").slice(0, 3).join("\n      ")); }
}
function assert(ok, msg, detail) { if (!ok) throw new Error(msg + (detail === undefined ? "" : " — " + JSON.stringify(detail))); }
async function until(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("timed out: " + label + (last !== undefined ? " (last: " + JSON.stringify(last) + ")" : ""));
}
async function phone(seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  if (seed) await ctx.addInitScript((s) => { if (!sessionStorage.getItem("__seeded")) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem("__seeded", "1"); } }, seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(APP);
  return { ctx, page };
}
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("now.store.v1") || "null"));
const toastText = (page) => page.textContent("#toastText");
const lampClass = (page, id) => page.getAttribute("#" + id, "class");
const nudge = (page) => page.evaluate(() => window.dispatchEvent(new Event("online")));
const tab = (page, r) => page.click(`.tab[data-r=${r}]`);
async function dump(page, text) { await page.fill("#dumpBox", text); await page.click("#dumpGo"); }
async function setDoor(page, url, key) {
  await tab(page, "stuck");
  await page.fill("#doorUrlBox", url);
  await page.fill("#doorKeyBox", key);
  await page.click("#doorActs >> text=/^Save/");
}
async function logFloor(page, v) {
  await tab(page, "floor");
  for (const [k, n] of Object.entries(v)) await page.click(`.seg[data-k=${k}] span[data-n="${n}"]`);
  await page.click("#logFloor");
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + ".png") });
/* A person reads a card before tapping it; the app ignores taps in the first 600 ms after a card
   appears (the tail of a double-tap). Tests tap like a person. */
const tapAns = async (pg, label) => { await pg.waitForTimeout(650); await pg.click("#ans >> text=" + label); };
const since = (ms) => new Date(Date.now() - ms).toISOString();

/* =================================================================== the live door */
const door = await startMockDoor({ key: "live-test-key" });
const byId = (id) => door.state.cards.find((c) => c.id === id) || {};
const { page } = await phone();
console.log("\nLIVE DOOR (@3 behaviour)");

await block("fresh phone, no door: DUMP holds, nothing is lost, the OUT lamp is red", async () => {
  await dump(page, "call the plumber");
  await until(async () => /No door URL or key yet — held on this phone/.test(await toastText(page)), "no-door toast");
  const s = await store(page);
  assert(s.outbox.length === 1 && s.outbox[0].op === "dump" && s.outbox[0].body.text === "call the plumber", "one dump held", s.outbox);
  assert(/bad/.test(await lampClass(page, "lampOut")), "OUT lamp red");
  assert(door.state.posts.length === 0, "nothing reached a door");
});

let firstId;
await block("the door, entered once: the held dump goes out with its original id, readback ok", async () => {
  firstId = (await store(page)).outbox[0].id;
  await setDoor(page, door.url, door.key);
  await until(() => door.state.raw.length === 1, "held dump delivered");
  assert(door.state.raw[0].text === "call the plumber" && door.state.raw[0].receipt_id === firstId, "same text, same id", door.state.raw[0]);
  await until(async () => (await store(page)).outbox.length === 0, "outbox empty");
  const s = await store(page);
  assert(s.receipts[firstId] && s.receipts[firstId].readback === "ok" && s.receipts[firstId].bytes === 16, "receipt with readback", s.receipts[firstId]);
  assert(!JSON.stringify(s).includes("call the plumber"), "the text is gone from the phone");
  await until(async () => /ok/.test(await lampClass(page, "lampOut")) && /ok/.test(await lampClass(page, "lampIn")), "both lamps green");
});

await block("every call is a text/plain POST with the key in the body — never in a URL", async () => {
  assert(door.state.contentTypes.every((t) => t === "text/plain;charset=utf-8"), "content types", door.state.contentTypes);
  assert(!door.state.keyInUrl, "key never in a URL");
  assert(door.state.posts.some((p) => p.op === "cards" && p.since === "0" && typeof p.floor === "string"), "cards pull shape", door.state.posts);
});

await block("DUMP with a door: out → raw, byte count read back, build tagged", async () => {
  await tab(page, "now");
  await dump(page, "text the landlord");
  await until(async () => /Out → raw · 17 B · ok/.test(await toastText(page)), "out toast");
  const build = (fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(/const BUILD = "([^"]+)"/) || [])[1];
  assert(door.state.raw[1].surface_version === build && door.state.raw[1].origin_surface === "walker", "surface_version is the build", door.state.raw[1]);
});

await block("two DUMPs while the door is slow: both go in the same flush, neither waits", async () => {
  door.state.delayMs = 900;
  const n = door.state.raw.length;
  await dump(page, "first of two");
  await page.waitForTimeout(150);
  await dump(page, "second of two");
  await until(() => door.state.raw.length === n + 2, "both delivered", 5000);
  await until(async () => /Out → raw · 13 B · ok/.test(await toastText(page)), "the second one's toast says out, not held");
  door.state.delayMs = 0;
});

await block("no signal: DUMP holds with the reason named, then goes exactly once", async () => {
  door.state.down = true;
  const n = door.state.raw.length;
  await dump(page, "pay the hydro bill");
  await until(async () => /Door unreachable \(network\) — held on this phone/.test(await toastText(page)), "network toast");
  assert((await store(page)).outbox.length === 1, "held");
  door.state.down = false;
  await nudge(page);
  await until(() => door.state.raw.length === n + 1, "delivered after the network came back");
  await nudge(page); await page.waitForTimeout(600);
  assert(door.state.raw.filter((r) => r.text === "pay the hydro bill").length === 1, "exactly once");
});

await block("a long dump queue never holds up the cards, and it counts down as each one goes", async () => {
  door.state.down = true;
  for (let i = 1; i <= 5; i++) await dump(page, "queued thought " + i);
  await until(async () => (await store(page)).outbox.filter((e) => e.op === "dump").length === 5, "five held");
  door.put({ id: "c-q", kind: "WORD", text: "Queue-jumping card?", options: ["Yes", "No"] });
  door.state.down = false;
  door.state.delayMs = 500;                                       // a slow door: ~2.5 s for the queue
  const seen = new Set();
  let cardWhileQueued = false;
  const posts0 = door.state.posts.length;
  await nudge(page);
  await until(async () => {
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem("now.store.v1")));   // what is on disk, not just in memory
    const q = s.outbox.filter((e) => e.op === "dump").length;
    seen.add(q);
    if (s.cards["c-q"] && q > 0) cardWhileQueued = true;
    return q === 0;
  }, "queue drained", 10000);
  door.state.delayMs = 0;
  assert(cardWhileQueued, "the card arrived while dumps were still going out");
  assert([...seen].some((q) => q > 0 && q < 5), "saved after each dump, counting down", [...seen]);
  const ops = door.state.posts.slice(posts0).map((p) => p.op || "dump");
  assert(ops.indexOf("cards") < ops.lastIndexOf("dump"), "the pull went before the last dump", ops);
  assert(door.state.raw.filter((r) => /^queued thought/.test(r.text)).length === 5, "all five, once each");
  door.state.cards.find((c) => c.id === "c-q").answered = { choice: "Yes" };   // answered elsewhere: clear the deck for the next block
  await nudge(page);
  await until(async () => !(await store(page)).cards["c-q"], "c-q retired");
});

await block("a card the stack filed reaches the phone; a tap goes back through the door", async () => {
  door.put({ id: "c-1", kind: "SPEND", text: "Renew the domain for a year?", options: ["Yes", "No"], recommend: "Yes", source_file: "4_WORK/active/renewals.md" });
  await tab(page, "cards"); await nudge(page);
  await until(async () => /Renew the domain/.test(await page.textContent("#deck")), "card on the deck");
  assert(await page.isVisible("#ans .btn.primary >> text=Yes"), "the recommendation is the primary button");
  assert(/spend/.test(await page.textContent("#deck .tag")) && /renewals\.md/.test(await page.textContent("#deck .because")), "kind and source shown");
  await shot(page, "cards");
  await tapAns(page, "No");
  await page.waitForTimeout(1000);
  assert(!byId("c-1").answered, "held for the undo window");
  await until(() => byId("c-1").answered && byId("c-1").answered.choice === "No", "answer delivered", 8000);
  await until(async () => /Renew the domain for a year\? → No/.test(await page.textContent("#decidedList")) && /sent/.test(await page.textContent("#decidedList")), "decided shows sent");
});

await block("UNDO takes an answer back before it leaves", async () => {
  door.put({ id: "c-2", kind: "WORD", text: "Book the Thursday slot?", options: ["Yes", "No"], recommend: "Yes" });
  await nudge(page);
  await until(async () => /Book the Thursday slot/.test(await page.textContent("#deck")), "card 2");
  await tapAns(page, "Yes");
  await page.click("#toastUndo");
  await page.waitForTimeout(4500);
  assert(!byId("c-2").answered, "not sent");
  assert(/Book the Thursday slot/.test(await page.textContent("#deck")), "back on the deck");
});

await block("a thin floor: the door holds cards back and the phone keeps what it has", async () => {
  door.put({ id: "c-3", kind: "WORD", text: "Move the dentist?", options: ["Yes", "No"] });
  await nudge(page);
  await until(async () => (await store(page)).cards["c-3"], "card 3 pulled");
  await logFloor(page, { family: 3, energy: 2, recharge: 3, balance: 3, harmony: 4, control: 4 });   // B · Low battery
  await page.waitForTimeout(4000);
  const posts = door.state.posts.length;
  await nudge(page);
  await until(() => door.state.posts.length > posts, "a thin pull happened");
  await page.waitForTimeout(300);
  const s = await store(page);
  assert(s.cards["c-2"] && s.cards["c-3"], "nothing retired by a thin pull", Object.keys(s.cards));
});

await block("a card answered elsewhere leaves the phone on the next whole pull", async () => {
  door.state.cards.find((c) => c.id === "c-3").answered = { choice: "Yes" };
  await logFloor(page, { family: 3, energy: 3, recharge: 3, balance: 3, harmony: 3, control: 3 });   // F · Steady
  await page.waitForTimeout(4000);
  await nudge(page);
  await until(async () => !(await store(page)).cards["c-3"], "c-3 retired");
  assert((await store(page)).cards["c-2"], "c-2 still here");
});

await block("floor, done and lanes are never sent to a door that does not list them (it would take them down its dump path)", async () => {
  assert(!door.state.posts.some((p) => ["floor", "done", "lane"].includes(p.op)), "no event ops posted", door.state.posts.map((p) => p.op));
  const s = await store(page);
  assert(s.outbox.filter((e) => e.op === "floor").length === 2, "both readings parked on the phone", s.outbox.map((e) => e.op));
  await page.click("#lampOut");
  assert(/parked here until the door takes them/.test(await toastText(page)), "the lamp says so");
  assert(/ok/.test(await lampClass(page, "lampOut")), "and stays green — parked is not failing");
});

await block("an answer the door will never take is dropped and the card says why", async () => {
  door.put({ id: "c-4", kind: "WORD", text: "Cancel the trial?", options: ["Yes", "No"] });
  await tab(page, "cards"); await nudge(page);
  await until(async () => (await store(page)).cards["c-4"], "card 4 pulled");
  await tapAns(page, "Yes");                      // c-2 is first: answer it
  await page.waitForTimeout(4200);
  door.state.cards.splice(door.state.cards.findIndex((c) => c.id === "c-4"), 1);   // the door lost c-4
  await until(async () => /Cancel the trial/.test(await page.textContent("#deck")), "c-4 on top");
  await tapAns(page, "Yes");
  await until(async () => { const c = (await store(page)).cards["c-4"]; return c && c.answered && c.answered.refused === "not_found"; }, "refused not_found", 9000);
  assert(/not taken · not_found/.test(await page.textContent("#decidedList")), "Decided says not taken");
  assert(!(await store(page)).outbox.some((e) => e.op === "card_answer"), "not retried forever");
});

await block("an expired card cannot be answered; it can be let go", async () => {
  door.put({ id: "c-5", kind: "WORD", text: "Old question?", options: ["Yes", "No"], at: since(3 * 86400e3), ttl_h: 24 });
  await nudge(page);
  await until(async () => /Old question/.test(await page.textContent("#deck")), "expired card shown");
  assert(/expired/.test(await page.textContent("#deck .tag")) && !(await page.isVisible("#ans >> text=Yes")), "no answer buttons");
  await tapAns(page, "/Dismiss/");
  await until(async () => /Nothing waiting on you/.test(await page.textContent("#deck")), "deck empty");
});

await block("hold DUMP → START: kept here as a start, and dumped under the same id", async () => {
  await tab(page, "now");
  await page.fill("#dumpBox", "fold the laundry");
  const bx = await page.locator("#dumpGo").boundingBox();
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await until(async () => /Start waiting/.test(await toastText(page)), "start toast");
  const s = await store(page);
  const st = Object.values(s.starts).find((x) => x.text === "fold the laundry");
  assert(st && st.state === "waiting", "start kept", s.starts);
  await until(() => door.state.raw.some((r) => r.text === "fold the laundry" && r.receipt_id === st.id), "dumped with the start's id");
});

await block("FIRST picks it; Start runs the timer; Done counts it", async () => {
  await until(async () => /fold the laundry/.test(await page.textContent("#firstText")), "FIRST shows it");
  assert(/starts with “fold”/.test(await page.textContent("#firstWhy")), "and says why", await page.textContent("#firstWhy"));
  await page.click("#firstActs >> text=/Start/");
  await until(async () => await page.isVisible("#timerRow") && /^2[45]:/.test(await page.textContent("#timer")), "timer running");
  await shot(page, "now-started");
  await page.click("#firstActs >> text=Done");
  await until(async () => /1 done/.test(await page.textContent("#sDone")), "counted");
  const s = await store(page);
  assert(!Object.values(s.starts).some((x) => x.text === "fold the laundry"), "the text is gone at Done");
  assert(s.outbox.some((e) => e.op === "done" && e.body.from === "phone" && e.body.outcome === "done"), "a done event parked for the door");
});

await block("a lane tick is kept (and parked for the door)", async () => {
  await page.click(".lane >> text=Laundry");
  await until(async () => /1 of 4 today/.test(await page.textContent("#sLanesAge")), "lane counted");
  await page.waitForTimeout(1800);
  await page.click(".lane >> text=Laundry"); await page.click(".lane >> text=Laundry");
  await page.waitForTimeout(300);
  const lanes = (await store(page)).outbox.filter((e) => e.op === "lane");
  assert(lanes.length === 1 && lanes[0].body.on === true, "rapid toggles coalesce to the last", lanes.map((e) => e.body));
});

await block("Test door knocks without the key", async () => {
  await tab(page, "stuck");
  await page.click("#doorActs >> text=Test door");
  await until(async () => /The door answers: walker-door/.test(await toastText(page)), "door answers");
  await shot(page, "stuck");
});

await block("the door buttons stay inside their card at phone width", async () => {
  const card = await page.locator("#doorCard").boundingBox();
  const btns = await page.locator("#doorActs .btn").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, right: r.right }; }));
  assert(btns.length >= 4, "Save, Test door, Sync now, Clear", btns.map((b) => b.t));
  assert(btns.every((b) => b.right <= card.x + card.width - 8), "none runs off the card", btns);
});

await block("a wrong key: named, held, and nothing lost when it is fixed", async () => {
  await page.fill("#doorKeyBox", "wrong-key");
  await page.click("#doorActs >> text=/^Save/");
  await until(async () => /Door key refused — check the key/.test(await toastText(page)), "named");
  await tab(page, "now");
  await dump(page, "buy stamps");
  await until(async () => /bad/.test(await lampClass(page, "lampOut")) && /bad/.test(await lampClass(page, "lampIn")), "OUT and IN red");
  await tab(page, "stuck");
  await page.fill("#doorKeyBox", door.key);
  await page.click("#doorActs >> text=/^Save/");
  await until(() => door.state.raw.some((r) => r.text === "buy stamps"), "delivered with the right key");
});

await block("the Save trap is gone: typing survives a redraw; an empty key box keeps the saved key", async () => {
  await page.fill("#doorUrlBox", door.url + "?v=2");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));   // forces a render
  await page.waitForTimeout(300);
  assert((await page.inputValue("#doorUrlBox")) === door.url + "?v=2", "typed URL survived the redraw");
  assert((await page.inputValue("#doorKeyBox")) === "", "the saved key is never written back into its box");
  await page.fill("#doorUrlBox", door.url);
  await page.click("#doorActs >> text=/^Save/");
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => localStorage.getItem("now.door_key")) === door.key, "key kept");
});

await block("a door URL with a key in it is refused before it is saved", async () => {
  await page.fill("#doorUrlBox", "https://example.invalid/exec?key=oops");
  await page.click("#doorActs >> text=/^Save/");
  await until(async () => /has a key in it/.test(await toastText(page)), "refused");
  assert(await page.evaluate(() => localStorage.getItem("now.door_url")) === door.url, "old URL kept");
  await page.fill("#doorUrlBox", door.url);
});

await block("too long for one dump: refused before sending, text kept in the box", async () => {
  await tab(page, "now");
  const big = "x".repeat(31000);
  await dump(page, big);
  await until(async () => /Too long for one dump/.test(await toastText(page)), "refused");
  assert((await page.inputValue("#dumpBox")).length === 31000, "text still in the box");
  await page.fill("#dumpBox", "");
});

await block("every route renders at phone width with no page errors, nothing past the phone's edges", async () => {
  for (const r of ["now", "cards", "floor", "stuck"]) {
    await tab(page, r); await page.waitForTimeout(150); await shot(page, "route-" + r);
    // .phone clips its overflow, so the page never scrolls sideways even when a child is cut off:
    // measure every drawn element against the phone's own edges instead.
    const out = await page.evaluate(() => {
      const ph = document.getElementById("phone").getBoundingClientRect();
      return [...document.querySelectorAll("#phone *")].filter((e) => !e.closest(".sr")).map((e) => [e, e.getBoundingClientRect()])
        .filter(([, b]) => b.width > 0 && b.height > 0 && (b.right > ph.right + 0.5 || b.left < ph.left - 0.5)).map(([e]) => e.id || e.className || e.tagName);
    });
    assert(!out.length, "inside the phone on " + r, out.slice(0, 5));
  }
});
await page.context().close();

/* =================================================================== the dark window */
console.log("\nTHE DARK WINDOW (02:00–05:59 ET)");
await block("03:00 ET: NOW and CARDS go dark, DUMP holds, nothing leaves; at 06:30 it goes", async () => {
  const d = await startMockDoor({ key: "k-dark-1234" });
  const { page: p } = await phone({ "now.door_url": d.url, "now.door_key": d.key });
  await until(() => d.state.posts.length >= 1, "day pull");
  await p.clock.setFixedTime(new Date("2026-09-25T07:00:00Z"));               // 03:00 EDT
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await until(async () => await p.isVisible("#nowDark") && /Dark until 06:00 ET/.test(await p.textContent("#nowDark")), "NOW dark");
  const before = d.state.posts.length;
  await dump(p, "a night thought");
  await until(async () => /Dark until 06:00 ET — held on this phone/.test(await toastText(p)), "held toast");
  await tab(p, "cards");
  assert(await p.isVisible("#cardsDark"), "no asks tonight");
  await shot(p, "dark-cards");
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await p.waitForTimeout(800);
  assert(d.state.posts.length === before, "nothing reached the door in the dark", d.state.posts.slice(before));
  await p.clock.setFixedTime(new Date("2026-09-25T10:30:00Z"));               // 06:30 EDT
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(() => d.state.raw.some((r) => r.text === "a night thought"), "delivered after six");
  await p.context().close(); await d.close();
});

/* =================================================================== migration */
console.log("\nA 0.9.6 PHONE, UPGRADED");
await block("store, held dumps, unsent answer and door carry across; the old keys are untouched", async () => {
  const d = await startMockDoor({ key: "k-migrate-99" });
  d.put({ id: "c-m", kind: "WORD", text: "Keep the 0.9 answer?", options: ["Yes", "No"] });
  const v0 = JSON.stringify({
    items: { i1: { id: "i1", text: "Pack lunches", at: since(3600e3), state: "landed", words: 2 } },
    cards: {}, floor: {}, receipts: {}, counters: {},
    decisions: { "c-m": { id: "c-m", door: true, text: "Keep the 0.9 answer?", options: ["Yes", "No"], at: since(7200e3), state: "answered", answered: true, choice: "Yes", pending_answer: { choice: "Yes", at: since(600e3) } } },
  });
  const held = JSON.stringify([{ text: "held from 0.9.6", at: since(900e3), receipt_id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }]);
  const seed = { "now.walker.v0": v0, "now.walker.held": held, "now.last_pull_stamp": "2026-09-23T09:00:00Z", "now.door_url": d.url, "now.door_key": d.key, "now.lanes.v1": JSON.stringify({ "2026-09-23": { school: true } }) };
  const { page: p } = await phone(seed);
  await until(() => d.state.raw.some((r) => r.text === "held from 0.9.6" && r.receipt_id === "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"), "held dump delivered with its id");
  await until(() => d.state.cards[0].answered && d.state.cards[0].answered.choice === "Yes", "pending answer delivered", 9000);
  await until(async () => /Pack lunches/.test(await p.textContent("#firstText")), "the start is on NOW");
  const after = await p.evaluate(() => ({ v0: localStorage.getItem("now.walker.v0"), held: localStorage.getItem("now.walker.held"), lanes: localStorage.getItem("now.lanes.v1") }));
  assert(after.v0 === v0 && after.held === held, "0.9.x keys untouched (rollback still finds them)");
  assert(after.lanes === seed["now.lanes.v1"], "lanes read in place");
  await p.reload();
  await p.waitForTimeout(800);
  assert(d.state.raw.filter((r) => r.text === "held from 0.9.6").length === 1, "a reload migrates nothing twice");
  await p.context().close(); await d.close();
});

/* =================================================================== the proposed door */
console.log("\nTHE PROPOSED DOOR (DOOR.md §5)");
await block("a door that lists floor/done/lane gets them; parked readings go the moment it does", async () => {
  const d = await startMockDoor({ key: "k-v2-door-1", mode: "live" });
  const { page: p } = await phone({ "now.door_url": d.url, "now.door_key": d.key });
  await logFloor(p, { family: 4, energy: 4, recharge: 3, balance: 3, harmony: 4, control: 4 });
  await p.waitForTimeout(4000);
  assert((await store(p)).outbox.some((e) => e.op === "floor"), "parked at the live door");
  d.state.mode = "v2";                                                          // the door is upgraded
  d.state.starts = [{ id: "st-1", text: "Call the vendor about the UPS", why: "the stack asked" }];
  d.state.brief = "Two things today.";
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(() => d.state.events.some((e) => e.op === "floor" && e.v && e.v.energy === 4), "the parked reading went");
  const s = await store(p);
  assert(!s.outbox.some((e) => e.op === "floor"), "outbox clear", s.outbox);
  await tab(p, "now");
  await until(async () => /Call the vendor about the UPS/.test(await p.textContent("#firstText")), "a stack start on NOW");
  assert(/from the stack/.test(await p.textContent("#firstTag")) && /the stack asked/.test(await p.textContent("#firstWhy")), "marked, with the stack's why");
  assert(/Two things today/.test(await p.textContent("#sBrief")), "brief strip");
  await shot(p, "now-stack");
  await p.click("#firstActs >> text=/Start/");
  await p.click("#firstActs >> text=Done");
  await until(() => d.state.events.some((e) => e.op === "done" && e.ref === "st-1" && e.from === "stack" && e.outcome === "done"), "done went back", 9000);
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await p.waitForTimeout(800);
  assert(!Object.values((await store(p)).starts).some((x) => x.id === "st-1"), "never re-filed");
  await p.click(".lane >> text=Cook");
  await until(() => d.state.events.some((e) => e.op === "lane" && e.lane === "cooking" && e.on === true), "lane went", 6000);
  await p.context().close(); await d.close();
});

/* =================================================================== 1.1 fixes */
console.log("\n1.1 — WHAT THE AUDIT AND THE REAL DOOR FOUND");
async function keyedPhone(d, { clockAt, hash = "", viewport } = {}) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem("__seeded")) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem("__seeded", "1"); } }, { "now.door_url": d.url, "now.door_key": d.key });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  if (clockAt) await p.clock.install({ time: new Date(clockAt) });
  await p.goto(APP + hash);
  return p;
}

await block("UNDO after the phone was away is refused: the answer went, and phone and door agree", async () => {
  const d = await startMockDoor({ key: "k-undo-late-1" });
  d.put({ id: "c-late-1", kind: "WORD", text: "Late undo?", options: ["Yes", "No"] });
  const p = await keyedPhone(d, { clockAt: "2026-09-24T16:00:00Z", hash: "#cards" });
  await until(async () => /Late undo/.test(await p.textContent("#deck")), "card on the deck");
  await tapAns(p, "Yes");
  const t = await p.evaluate(() => Date.now());
  await p.clock.pauseAt(t);                               // iOS suspends the app: its timers stop…
  await p.clock.setSystemTime(t + 10000);                 // …while the clock goes on 10 s; nothing fires
  assert(await p.isVisible("#toastUndo"), "the stale toast is still on screen, as on iOS");
  await p.click("#toastUndo");                            // the first tap on return lands before any tick
  await p.clock.resume();
  await until(() => d.state.cards[0].answered && d.state.cards[0].answered.choice === "Yes", "the answer reached the door");
  const s = await store(p);
  assert(s.cards["c-late-1"] && s.cards["c-late-1"].answered && s.cards["c-late-1"].answered.choice === "Yes", "the phone still shows it answered", s.cards["c-late-1"]);
  await p.context().close(); await d.close();
});

await block("a pull landing inside the UNDO window does not strand the answer", async () => {
  const d = await startMockDoor({ key: "k-undo-pull-1" });
  d.put({ id: "c-pull-1", kind: "WORD", text: "Undo across a pull?", options: ["Yes", "No"] });
  const p = await keyedPhone(d, { hash: "#cards" });
  await until(async () => /Undo across a pull/.test(await p.textContent("#deck")), "card on the deck");
  await tapAns(p, "No");
  const n = d.state.posts.length;
  await p.evaluate(() => window.dispatchEvent(new Event("online")));   // a pull replaces the card object
  await until(() => d.state.posts.slice(n).some((x) => x.op === "cards"), "a pull landed");
  await p.waitForTimeout(150);
  await p.click("#toastUndo");
  await p.waitForTimeout(4200);
  assert(!d.state.cards[0].answered, "nothing reached the door");
  const s = await store(p);
  assert(!s.cards["c-pull-1"].answered && !s.outbox.some((e) => e.op === "card_answer"), "the card is open again and nothing waits to go", s.cards["c-pull-1"]);
  assert(/Undo across a pull/.test(await p.textContent("#deck")), "back on the deck");
  await p.context().close(); await d.close();
});

await block("an old thin floor stops holding the cards after 12 h, and the IN lamp says why while it does", async () => {
  const d = await startMockDoor({ key: "k-floor-age-1" });
  const T = Date.parse("2026-09-24T16:00:00Z");            // 12:00 ET
  const p = await keyedPhone(d, { clockAt: T });
  await logFloor(p, { family: 3, energy: 2, recharge: 3, balance: 3, harmony: 4, control: 4 });   // B · Low battery
  await p.clock.runFor(4000);
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(() => d.state.lastFloor && d.state.lastFloor.state === "thin", "the door saw a thin floor");
  d.put({ id: "c-held-1", kind: "WORD", text: "Held for the floor?", options: ["Yes", "No"] });
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await p.waitForTimeout(600);
  assert(!(await store(p)).cards["c-held-1"], "held while the floor is thin");
  await p.click("#lampIn");
  assert(/floor reads thin/.test(await toastText(p)), "the lamp says the door is holding cards", await toastText(p));
  await p.clock.setSystemTime(T + 13 * 3600e3);              // 01:00 ET next day: the reading is 13 h old
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(async () => (await store(p)).cards["c-held-1"], "released once the reading went stale");
  assert(d.state.lastFloor && d.state.lastFloor.state === "unknown", "the door was told nothing, not an old thin", d.state.lastFloor);
  await p.context().close(); await d.close();
});

await block("a double-tap answers the card under the finger, never the next one", async () => {
  const d = await startMockDoor({ key: "k-double-tap" });
  d.put({ id: "c-dbl-1", kind: "WORD", text: "First card?", options: ["Yes", "No"], recommend: "Yes", at: since(120e3) });
  d.put({ id: "c-dbl-2", kind: "WORD", text: "Second card?", options: ["Yes", "No"], recommend: "Yes", at: since(60e3) });
  const p = await keyedPhone(d, { hash: "#cards" });
  await until(async () => /First card/.test(await p.textContent("#deck")), "first card shown");
  await p.waitForTimeout(700);
  await p.dblclick("#ans .btn.primary");
  await p.waitForTimeout(4500);
  const s = await store(p);
  assert(s.cards["c-dbl-1"].answered && s.cards["c-dbl-1"].answered.choice === "Yes", "the first card was answered");
  assert(!s.cards["c-dbl-2"].answered, "the second card was not", s.cards["c-dbl-2"]);
  assert(/Second card/.test(await p.textContent("#deck")), "and it is waiting, unanswered");
  await p.context().close(); await d.close();
});

await block("the toast never covers the DUMP button (375 × 667 and 430 × 932)", async () => {
  for (const vp of [{ width: 375, height: 667 }, { width: 430, height: 932 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(APP);
    await p.fill("#dumpBox", "line one\nline two\nline three");
    await p.click("#dumpGo");
    await until(async () => await p.isVisible("#toast"), "toast shown");
    const t = await p.locator("#toast").boundingBox(), b = await p.locator("#dumpGo").boundingBox();
    assert(t.y + t.height <= b.y + 1, "toast sits above DUMP at " + vp.width + "×" + vp.height, { toastBottom: t.y + t.height, dumpTop: b.y });
    await ctx.close();
  }
});

await block("two open copies never erase each other's held dump", async () => {
  const d = await startMockDoor({ key: "k-two-copies" });
  d.state.down = true;
  const a = await keyedPhone(d);
  const b = await a.context().newPage();
  b.on("pageerror", (e) => errors.push(e.message));
  await b.goto(APP);
  await dump(a, "from copy A");
  await until(async () => (await store(a)).outbox.some((e) => e.body && e.body.text === "from copy A"), "A holds it");
  await b.evaluate(() => window.dispatchEvent(new Event("online")));   // B syncs and saves
  await b.waitForTimeout(800);
  assert((await store(b)).outbox.some((e) => e.body && e.body.text === "from copy A"), "B's save kept A's dump");
  d.state.down = false;
  await b.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(() => d.state.raw.some((r) => r.text === "from copy A"), "delivered");
  await a.evaluate(() => window.dispatchEvent(new Event("online")));
  await a.waitForTimeout(800);
  assert(d.state.raw.filter((r) => r.text === "from copy A").length === 1, "exactly once");
  await a.context().close(); await d.close();
});

await block("a queued dump too big for the door is set aside; the queue behind it moves", async () => {
  const d = await startMockDoor({ key: "k-oversize-q" });
  const big = 'say "hi"\n'.repeat(2800).trim();              // 25 KB of text, ~34 KB as JSON
  const held = JSON.stringify([
    { text: big, at: since(120e3), receipt_id: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
    { text: "the small one behind it", at: since(60e3), receipt_id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
  ]);
  const { page: p } = await phone({ "now.walker.held": held, "now.door_url": d.url, "now.door_key": d.key });
  await until(() => d.state.raw.some((r) => r.text === "the small one behind it"), "the small one went");
  await until(async () => (await store(p)).receipts["8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"], "the phone saved its receipt");
  assert(!d.state.posts.some((x) => x.receipt_id === "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"), "the big one was never posted");
  const s = await store(p);
  const env = s.outbox.find((e) => e.id === "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
  assert(env && env.dead === "payload_too_large", "kept on the phone, marked", env ? { dead: env.dead, tries: env.tries, last_err: env.last_err, err_out: s.sync.err_out } : s.outbox.map((e) => e.id));
  assert(/bad/.test(await lampClass(p, "lampOut")), "the OUT lamp says so");
  await p.context().close(); await d.close();
});

await block("coming back while a DUMP is in the air: the cards pull goes now, not after the dump", async () => {
  const d = await startMockDoor({ key: "k-back-inflight" });
  const p = await keyedPhone(d);
  await until(() => d.state.posts.some((x) => x.op === "cards"), "first pull");
  d.state.delayMs = 1500;
  const n = d.state.posts.length;
  await dump(p, "slow dump in the air");
  await until(() => d.state.posts.slice(n).some((x) => (x.op || "dump") === "dump"), "the dump is in the air");
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForTimeout(900);
  assert(d.state.posts.slice(n).some((x) => x.op === "cards"), "the pull went while the dump was still in the air", d.state.posts.slice(n).map((x) => x.op || "dump"));
  d.state.delayMs = 0;
  await p.context().close(); await d.close();
});

/* =================================================================== 1.1 — second audit */
console.log("\n1.1 — WHAT THE SECOND AUDIT FOUND");
/* A store as the phone writes it, for seeding a context. */
const seedStore = (starts, more) => JSON.stringify(Object.assign({ v: 1, starts: starts || {}, gone: {}, cards: {}, floor: {}, receipts: {}, counters: {}, outbox: [], brief: null, sync: { stamp: "0", ops: [] } }, more || {}));
const aStart = (id, text, agoMs, extra) => Object.assign({ id: id, text: text, at: since(agoMs), state: "waiting", from: "phone" }, extra || {});

await block("FIRST keeps its buttons on the card at real phone heights, and every Waiting row can be reached", async () => {
  const starts = {};
  ["Email the school about Friday pickup", "Fold the laundry", "Call the bank about the card", "Book the dentist", "Water the plants", "Back up the laptop"].forEach((t, i) => { starts["w" + i] = aStart("w" + i, t, (10 - i) * 3600e3); });
  const phones = [
    { name: "SE", viewport: { width: 375, height: 667 }, top: 20, bottom: 0 },
    { name: "iPhone 15 home screen", viewport: { width: 393, height: 852 }, top: 59, bottom: 34 },
  ];
  for (const ph of phones) for (const started of [false, true]) {
    const st = JSON.parse(JSON.stringify(starts));
    if (started) Object.assign(st.w1, { state: "started", started_at: since(60e3), timer_end: new Date(Date.now() + 24 * 60e3).toISOString() });
    const ctx = await browser.newContext({ viewport: ph.viewport });
    // Home-screen apps get real safe-area insets; a desktop browser reports 0. Put the phone's in.
    await ctx.route(/\/(index\.html)?(\?.*)?$/, async (route) => {
      const r = await route.fetch();
      const body = (await r.text()).replace(/env\(safe-area-inset-top\)/g, ph.top + "px").replace(/env\(safe-area-inset-bottom\)/g, ph.bottom + "px");
      await route.fulfill({ response: r, body: body });
    });
    await ctx.addInitScript((s) => { if (!sessionStorage.getItem("__seeded")) { localStorage.setItem("now.store.v1", s); sessionStorage.setItem("__seeded", "1"); } }, seedStore(st));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(APP);
    await until(async () => (await p.locator("#firstActs .btn").count()) >= 2, "FIRST has its buttons");
    const where = ph.name + (started ? ", started" : ", waiting");
    const card = await p.locator("#firstCard").boundingBox();
    const why = await p.locator("#firstWhy").boundingBox();
    assert(why && why.height > 10, "the why line is not squeezed away (" + where + ")", why);
    const btns = await p.locator("#firstActs .btn").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, top: r.top, bottom: r.bottom }; }));
    assert(btns.every((b) => b.top >= card.y - 0.5 && b.bottom <= card.y + card.height + 0.5), "buttons inside the card (" + where + ")", { card: card, btns: btns });
    const hit = await p.evaluate(() => { const b = document.querySelector("#firstActs .btn.primary").getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e && e.textContent; });
    assert(/Start|Done/.test(hit || ""), "a tap on the primary button lands on it, no scrolling (" + where + ")", hit);
    const rows = await p.locator("#queue .item").count();
    assert(rows >= 4, "Waiting lists the rest (" + where + ")", rows);
    const last = p.locator("#queue .item").last();
    await last.scrollIntoViewIfNeeded();
    const lastHit = await last.evaluate((row) => { const b = row.getBoundingClientRect(); const e = document.elementFromPoint(b.left + 20, b.top + b.height / 2); return !!e && row.contains(e); });
    assert(lastHit, "the last Waiting row can be reached (" + where + ")");
    await shot(p, "first-" + ph.name.replace(/\W+/g, "-") + (started ? "-started" : "-waiting"));
    await ctx.close();
  }
});

await block("FIRST is shown once — not again under Waiting — and an old one says how old", async () => {
  const seed = seedStore({ a: aStart("a", "Clean the gutters", 3 * 86400e3), b: aStart("b", "Buy milk", 2 * 3600e3), c: aStart("c", "Call the bank", 3600e3) });
  const { page: p } = await phone({ "now.store.v1": seed });
  const first = (await p.textContent("#firstText")).trim();
  const rows = await p.locator("#queue .item .t").allTextContents();
  assert(rows.length === 2 && !rows.includes(first), "Waiting holds the other two", { first: first, rows: rows });
  const stamps = await p.locator("#queue .item .s").allTextContents();
  assert(stamps.some((x) => /3 d/.test(x)) || first === "Clean the gutters", "a 3-day-old start reads 3 d, not a clock time", stamps);
  await p.context().close();
});

await block("Not today can be undone, and a 0.9 park with no day comes back", async () => {
  const seed = seedStore({ p1: aStart("p1", "Renew the parking permit", 86400e3, { state: "parked" }) });   // a 0.9.x park: no until
  const { page: p } = await phone({ "now.store.v1": seed });
  await until(async () => /Renew the parking permit/.test(await p.textContent("#firstText")), "the old park is back on NOW");
  await p.click("#firstActs >> text=Not today");
  await until(async () => /Back tomorrow/.test(await toastText(p)) && await p.isVisible("#toastUndo"), "a toast with UNDO");
  assert(/Nothing waiting/.test(await p.textContent("#firstText")), "put away for today");
  await p.click("#toastUndo");
  await until(async () => /Renew the parking permit/.test(await p.textContent("#firstText")), "UNDO brings it back");
  await p.context().close();
});

await block("the last step of a broken-down start closes the big one too; UNDO brings both back", async () => {
  const seed = seedStore({
    big: aStart("big", "Sort out the garage", 86400e3, { state: "split" }),
    s1: aStart("s1", "Bag the recycling", 3600e3, { parent: "big" }),
    s2: aStart("s2", "Sweep the floor", 1800e3, { parent: "big" }),
  });
  const { page: p } = await phone({ "now.store.v1": seed });
  const first = (await p.textContent("#firstText")).trim();
  const [keepId, dropId] = first === "Sweep the floor" ? ["s2", "s1"] : ["s1", "s2"];
  await p.click("#queue .item >> [aria-label='Drop it']");                     // the step that is not FIRST
  await p.waitForTimeout(200);
  let s = await store(p);
  assert(s.starts.big && s.starts.big.state === "split" && !s.starts[dropId] && s.starts[keepId], "one step left: the big one waits", Object.keys(s.starts));
  assert(await p.isHidden("#queueCard"), "nothing else waiting");
  await p.click("#firstActs >> text=/Start/");
  await p.click("#firstActs >> text=Done");
  await until(async () => /and the big one it came from/.test(await toastText(p)), "the toast says the big one closed");
  s = await store(p);
  assert(!s.starts.big && !s.starts[keepId], "both gone from the phone", Object.keys(s.starts));
  const big = s.outbox.find((e) => e.op === "done" && e.body.ref === "big");
  assert(big && big.body.outcome === "done", "the big one is closed as done (a step was done)", s.outbox.map((e) => e.body));
  assert(s.gone.big && s.gone.s1 && s.gone.s2, "each leaves a tombstone", s.gone);
  await p.click("#toastUndo");
  await p.waitForTimeout(150);
  s = await store(p);
  assert(s.starts.big && s.starts.big.state === "split" && s.starts[keepId] && !s.gone.big && !s.gone[keepId], "UNDO brings both back", Object.keys(s.starts));
  assert(!s.outbox.some((e) => e.op === "done" && (e.body.ref === "big" || e.body.ref === keepId)), "and nothing about them waits to go");
  await p.context().close();
});

await block("an older export never brings back a start you finished", async () => {
  const { page: p } = await phone({ "now.store.v1": seedStore({ f1: aStart("f1", "Fold the laundry", 3600e3) }) });
  const old = await store(p);
  await p.click("#firstActs >> text=/Start/");
  await p.click("#firstActs >> text=Done");
  await p.waitForTimeout(200);
  await tab(p, "stuck");
  await p.setInputFiles("#impFile", { name: "old.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schema: "joeos.now.export/v2", build: "1.0.1", at: since(7200e3), store: old, lanes: {} })) });
  await until(async () => /Imported/.test(await toastText(p)), "imported");
  const s = await store(p);
  assert(!s.starts.f1 && s.gone.f1, "still finished", s.starts);
  assert(s.outbox.filter((e) => e.op === "done" && e.body.ref === "f1").length === 1, "one done, never two");
  await p.context().close();
});

await block("a refused dump is in sight on STUCK: retry says what happened; back to the box (kept through a relaunch), or let it go", async () => {
  const d = await startMockDoor({ key: "k-refused-list" });
  const seed = seedStore({}, { outbox: [
    { id: "bad!id", op: "dump", at: since(600e3), body: { text: "a private thought about the move" }, tries: 1, dead: "receipt_id_invalid" },
    { id: "bad!id2", op: "dump", at: since(500e3), body: { text: "another refused one" }, tries: 1, dead: "receipt_id_invalid" },
  ] });
  const { page: p } = await phone({ "now.store.v1": seed, "now.door_url": d.url, "now.door_key": d.key });
  await tab(p, "stuck");
  const list = await p.textContent("#deadList");
  assert(/a private thought about the move/.test(list) && /another refused one/.test(list) && /receipt_id_invalid/.test(list), "each dump, with the door's word for why", list);
  await p.click("#doorActs >> text=/Retry 2 refused/");
  await until(async () => /2 refused again — receipt_id_invalid/.test(await toastText(p)), "retry says both were refused again");
  const toBox = () => p.click("#deadList .park:has-text('a private thought') >> text=to box");
  await toBox();
  await until(async () => (await p.inputValue("#dumpBox")) === "a private thought about the move", "back in the box");
  assert(!(await store(p)).outbox.some((e) => e.id === "bad!id"), "out of the outbox");
  await p.click("#toastUndo");
  await until(async () => (await store(p)).outbox.some((e) => e.id === "bad!id" && e.dead), "UNDO puts it back");
  assert((await p.inputValue("#dumpBox")) === "" && !(await store(p)).boxed, "and clears the box");
  await tab(p, "stuck");
  await toBox();
  await until(async () => (await p.inputValue("#dumpBox")) === "a private thought about the move", "in the box again");
  await p.reload();                                                              // iOS threw the app away
  await until(async () => (await p.inputValue("#dumpBox")) === "a private thought about the move", "still in the box after a relaunch");
  await p.click("#dumpGo");
  await until(() => d.state.raw.some((r) => r.text === "a private thought about the move"), "sent under a new id");
  assert(!(await store(p)).boxed, "nothing kept once it went");
  await tab(p, "stuck");
  await p.click("#deadList >> [aria-label='Let it go']");
  await until(async () => /Let go/.test(await toastText(p)), "let go");
  assert(!(await store(p)).outbox.length && await p.isHidden("#deadList"), "gone, and the list with it");
  await until(async () => !/bad/.test(await lampClass(p, "lampOut")), "the OUT lamp is no longer red");
  await p.context().close(); await d.close();
});

await block("a door that stops listing floor/done/lane (rolled back, or another door) gets none of them", async () => {
  const d = await startMockDoor({ key: "k-rollback-1", mode: "v2" });
  const p = await keyedPhone(d);
  await until(async () => ((await store(p)).sync.ops || []).includes("floor"), "the v2 door listed its ops");
  d.state.mode = "live";                                                         // rolled back to @3
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(async () => ((await store(p)).sync.ops || []).length === 0, "the phone forgot the ops");
  const n = d.state.posts.length;
  await logFloor(p, { family: 4, energy: 4, recharge: 4, balance: 4, harmony: 4, control: 4 });
  await p.waitForTimeout(4000);
  assert(!d.state.posts.slice(n).some((x) => x.op === "floor"), "no floor sent to a door that does not take it", d.state.posts.slice(n).map((x) => x.op));
  const env = (await store(p)).outbox.find((e) => e.op === "floor");
  assert(env && !env.dead, "parked on the phone, not refused", env);
  await p.context().close(); await d.close();
});

await block("an answer the door already had is shown as that, not as sent", async () => {
  const d = await startMockDoor({ key: "k-already-1" });
  d.put({ id: "c-already", kind: "WORD", text: "Renew the domain?", options: ["Yes", "No"] });
  const p = await keyedPhone(d, { hash: "#cards" });
  await until(async () => /Renew the domain/.test(await p.textContent("#deck")), "card on the deck");
  d.state.cards[0].answered = { choice: "Yes", at: since(60e3) };               // answered on another phone
  await tapAns(p, "No");
  await until(async () => /the door already had an answer/.test(await p.textContent("#decidedList")), "Decided says so", 9000);
  assert(!d.state.raw.some((r) => r.card_id === "c-already" && r.choice === "No"), "the door kept its own answer");
  await p.context().close(); await d.close();
});

/* =================================================================== guards */
console.log("\nGUARDS — PROMISES THAT HAD NO TEST");

await block("export carries your data and never the door URL or key; import brings it back on a fresh phone", async () => {
  const d = await startMockDoor({ key: "k-export-SECRET-77" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem("__seeded")) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem("__seeded", "1"); } }, { "now.door_url": d.url, "now.door_key": d.key });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.clock.install({ time: new Date("2026-09-24T16:00:00Z") });   // noon ET — no dark window to fight
  await p.goto(APP);
  d.state.down = true;                                                // the dump must still be sitting here to export
  await dump(p, "export me please");
  await until(async () => /held on this phone/.test(await toastText(p)), "the dump is held, door down");
  await logFloor(p, { family: 3, energy: 3, recharge: 3, balance: 3, harmony: 3, control: 3 });
  await tab(p, "now");
  await p.click(".lane >> text=Laundry");
  await until(async () => /1 of 4 today/.test(await p.textContent("#sLanesAge")), "a lane ticked");
  await tab(p, "stuck");
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#storeActs >> text=Export")]);
  const file = await download.path();
  const text = fs.readFileSync(file, "utf8");
  const bundle = JSON.parse(text);
  assert(bundle.schema === "joeos.now.export/v2", "v2 schema", bundle.schema);
  assert(!text.includes(d.key) && !text.includes(d.url) && !text.includes("/exec"), "no door secret and no door address in the file");
  assert(Object.values(bundle.store.floor).some((f) => f.v.harmony === 3), "the floor reading is in the file", bundle.store.floor);
  assert(bundle.store.outbox.some((e) => e.op === "dump" && e.body.text === "export me please"), "the held dump is in the file", bundle.store.outbox);

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });   // a brand-new phone, no seed
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(APP);
  await tab(p2, "stuck");
  await p2.setInputFiles("#impFile", file);
  await until(async () => /Imported/.test(await toastText(p2)), "the toast says Imported");
  const s2 = await store(p2);
  assert(Object.values(s2.floor).some((f) => f.v.harmony === 3), "the floor reading landed on the new phone", s2.floor);
  assert(s2.outbox.some((e) => e.op === "dump" && e.body.text === "export me please"), "the held dump landed on the new phone", s2.outbox);
  assert((await p2.evaluate(() => localStorage.getItem("now.door_key"))) === null, "no door key arrived with the file");
  await ctx.close(); await ctx2.close(); await d.close();
});

await block("a 0.9 export file imports through the migration path", async () => {
  const v1 = {
    schema: "joeos.now.export/v1",
    store: {
      items: { i1: { id: "i1", text: "Pack lunches", at: since(3600e3), state: "landed" } },
      cards: {}, floor: {}, receipts: {}, counters: {}, decisions: {},
    },
    held: [{ text: "held in the file", at: since(900e3), receipt_id: "1a2b3c4d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }],
  };
  const file = path.join(SHOTS, "v1-export.json");
  fs.writeFileSync(file, JSON.stringify(v1));
  const { page: p } = await phone();
  await tab(p, "stuck");
  await p.setInputFiles("#impFile", file);
  await until(async () => /Imported/.test(await toastText(p)), "imported toast");
  const s = await store(p);
  assert(Object.values(s.starts).some((x) => x.text === "Pack lunches" && x.state === "waiting"), "the 0.9 item is a start", s.starts);
  assert(s.outbox.some((e) => e.op === "dump" && e.id === "1a2b3c4d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" && e.body.text === "held in the file"), "the held dump is in the outbox, with its id", s.outbox);
  await p.context().close();
});

await block("a red floor goes dark too: NOW and CARDS hide, the door hears fail, DUMP still goes", async () => {
  const d = await startMockDoor({ key: "k-red-floor-1" });
  const T = Date.parse("2026-09-24T16:00:00Z");                        // noon ET
  const p = await keyedPhone(d, { clockAt: "2026-09-24T16:00:00Z" });
  await until(() => d.state.posts.some((x) => x.op === "cards"), "boot pull");
  await logFloor(p, { family: 3, energy: 3, recharge: 3, balance: 3, harmony: 1, control: 1 });   // C · Redline
  await p.clock.runFor(4000);                                          // past the 3.5 s hold
  const n = d.state.posts.length;
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await until(() => d.state.posts.slice(n).some((x) => x.op === "cards"), "a pull after the red floor");
  await tab(p, "now");                                                 // logFloor left us on the FLOOR tab
  assert(await p.isVisible("#nowDark"), "NOW shows the dark note");
  assert(!(await p.isVisible("#nowBody")), "NOW body hides");
  await tab(p, "cards");
  assert(await p.isVisible("#cardsDark"), "CARDS shows the dark note");
  assert(!(await p.isVisible("#deck")), "the deck hides");
  const cardsPosts = d.state.posts.filter((x) => x.op === "cards");
  const last = JSON.parse(cardsPosts[cardsPosts.length - 1].floor);
  assert(last.state === "fail", "the door is told fail", last);
  assert(!("harmony" in last) && !("control" in last), "never the six raw vector numbers", last);
  await dump(p, "dump during a red floor");
  await until(() => d.state.raw.some((r) => r.text === "dump during a red floor"), "DUMP still goes");
  await p.clock.setSystemTime(T + 12 * 3600e3 + 60e3);                 // stale reading, and 00:01 ET — not night either
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await tab(p, "now");
  await until(async () => !(await p.isVisible("#nowDark")), "NOW is no longer dark once the reading goes stale");
  await p.context().close(); await d.close();
});

await block("a hostile card cannot run code on the phone", async () => {
  const d = await startMockDoor({ key: "k-xss-1" });
  d.put({
    id: "c-xss-1", kind: "WORD",
    text: '<img src=x onerror="window.__pwned=1">',
    options: ['<b>Yes</b>', '<script>window.__pwned=2</script>'],
    recommend: '<b>Yes</b>',
    because: '"><svg onload=window.__pwned=3>',
    source_file: '"><svg onload=window.__pwned=3>',
  });
  const p = await keyedPhone(d, { hash: "#cards" });
  await until(async () => /img src=x/.test(await p.textContent("#deck")), "the hostile card is shown");
  const deckText = await p.textContent("#deck");
  assert(deckText.includes("<img src=x"), "the tag reads as literal text on the deck", deckText);
  await p.waitForTimeout(650);                                        // read it like a person before tapping
  await p.click("#ans .btn.primary");
  await until(async () => /onerror/.test(await p.textContent("#decidedList")), "the card moved to Decided");
  const pwned = await p.evaluate(() => window.__pwned);
  assert(pwned === undefined, "nothing it carried ever ran", pwned);
  const stray = await p.locator("#deck img, #deck svg, #deck script, #decidedList img").count();
  assert(stray === 0, "no live img/svg/script element made it into the DOM", stray);
  await p.context().close(); await d.close();
});

await block("the home-screen app opens with no signal (service worker, on localhost)", async () => {
  const host2 = http.createServer(serveStatic);
  await new Promise((ok) => host2.listen(0, "127.0.0.1", ok));
  const LOCAL_APP = `http://localhost:${host2.address().port}/`;       // hostname "localhost" — the one non-https origin the worker registers on

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.clock.install({ time: new Date("2026-09-24T16:00:00Z") });   // noon ET — a later DUMP is never held by the dark window
  await p.goto(LOCAL_APP);
  await p.evaluate(() => navigator.serviceWorker.ready);
  if (!(await p.evaluate(() => navigator.serviceWorker.controller))) await p.reload();   // the very first load is never controlled
  await until(async () => !!(await p.evaluate(() => navigator.serviceWorker.controller)), "the page is under the worker");

  const shelled = await p.evaluate(async () => {
    const c = await caches.open("now-shell-v1");
    const keys = await c.keys();
    return keys.some((k) => { const u = new URL(k.url).pathname; return u === "/" || u.endsWith("index.html"); });
  });
  assert(shelled, "the shell (index.html) is in the cache");

  const build = await p.textContent("#verNum");
  host2.closeAllConnections?.(); host2.close();
  // Only the app's own host dies here. setOffline(true) would also silence the mock door below,
  // which is not the promise under test — the worker standing in for a dead origin, not the network as a whole.
  await p.reload();
  await until(async () => await p.isVisible("#dumpGo"), "the shell still opens with its own host dead");
  assert((await p.textContent("#verNum")) === build, "the cached build tag still shows", await p.textContent("#verNum"));

  const d = await startMockDoor({ key: "k-sw-shell-1" });
  await setDoor(p, d.url, d.key);
  await dump(p, "dumped while the app's own host is dead");
  await until(() => d.state.raw.some((r) => r.text === "dumped while the app's own host is dead"), "a DUMP still reaches a door that is still up");
  await ctx.close(); await d.close();
});

/* =================================================================== report */
await door.close();
await browser.close();
host.close();
const bad = results.filter((r) => !r[0]).length;
if (errors.length) console.log("\nPAGE ERRORS\n  " + [...new Set(errors)].join("\n  "));
console.log("\nE2E " + (results.length - bad) + "/" + results.length + (bad || errors.length ? "  — FAILED" : "  — the walker keeps its promises against the door"));
process.exit(bad || errors.length ? 1 : 0);
