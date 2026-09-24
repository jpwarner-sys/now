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
const host = http.createServer((q, r) => {
  let f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0].split("#")[0]));
  if (!f.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
  if (f.endsWith("/")) f += "index.html";
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(b); });
});
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
const since = (ms) => new Date(Date.now() - ms).toISOString();

/* =================================================================== the live door */
const door = await startMockDoor({ key: "live-test-key" });
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
  assert(door.state.raw[1].surface_version === "1.0.0" && door.state.raw[1].origin_surface === "walker", "surface_version", door.state.raw[1]);
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

await block("a card the stack filed reaches the phone; a tap goes back through the door", async () => {
  door.put({ id: "c-1", kind: "SPEND", text: "Renew the domain for a year?", options: ["Yes", "No"], recommend: "Yes", source_file: "4_WORK/active/renewals.md" });
  await tab(page, "cards"); await nudge(page);
  await until(async () => /Renew the domain/.test(await page.textContent("#deck")), "card on the deck");
  assert(await page.isVisible("#ans .btn.primary >> text=Yes"), "the recommendation is the primary button");
  assert(/spend/.test(await page.textContent("#deck .tag")) && /renewals\.md/.test(await page.textContent("#deck .because")), "kind and source shown");
  await shot(page, "cards");
  await page.click("#ans >> text=No");
  await page.waitForTimeout(1000);
  assert(!door.state.cards[0].answered, "held for the undo window");
  await until(() => door.state.cards[0].answered && door.state.cards[0].answered.choice === "No", "answer delivered", 8000);
  await until(async () => /Renew the domain for a year\? → No/.test(await page.textContent("#decidedList")) && /sent/.test(await page.textContent("#decidedList")), "decided shows sent");
});

await block("UNDO takes an answer back before it leaves", async () => {
  door.put({ id: "c-2", kind: "WORD", text: "Book the Thursday slot?", options: ["Yes", "No"], recommend: "Yes" });
  await nudge(page);
  await until(async () => /Book the Thursday slot/.test(await page.textContent("#deck")), "card 2");
  await page.click("#ans >> text=Yes");
  await page.click("#toastUndo");
  await page.waitForTimeout(4500);
  assert(!door.state.cards[1].answered, "not sent");
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

await block("floor, done and lanes are never sent to a door that does not list them (it would file them as dumps)", async () => {
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
  await page.click("#ans >> text=Yes");                      // c-2 is first: answer it
  await page.waitForTimeout(4200);
  door.state.cards.splice(door.state.cards.findIndex((c) => c.id === "c-4"), 1);   // the door lost c-4
  await until(async () => /Cancel the trial/.test(await page.textContent("#deck")), "c-4 on top");
  await page.click("#ans >> text=Yes");
  await until(async () => { const c = (await store(page)).cards["c-4"]; return c && c.answered && c.answered.refused === "not_found"; }, "refused not_found", 9000);
  assert(/not taken · not_found/.test(await page.textContent("#decidedList")), "Decided says not taken");
  assert(!(await store(page)).outbox.some((e) => e.op === "card_answer"), "not retried forever");
});

await block("an expired card cannot be answered; it can be let go", async () => {
  door.put({ id: "c-5", kind: "WORD", text: "Old question?", options: ["Yes", "No"], at: since(3 * 86400e3), ttl_h: 24 });
  await nudge(page);
  await until(async () => /Old question/.test(await page.textContent("#deck")), "expired card shown");
  assert(/expired/.test(await page.textContent("#deck .tag")) && !(await page.isVisible("#ans >> text=Yes")), "no answer buttons");
  await page.click("#ans >> text=/Dismiss/");
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

await block("every route renders at phone width with no page errors", async () => {
  for (const r of ["now", "cards", "floor", "stuck"]) { await tab(page, r); await page.waitForTimeout(150); await shot(page, "route-" + r); }
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert(w <= 390, "no horizontal scroll", w);
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

/* =================================================================== report */
await door.close();
await browser.close();
host.close();
const bad = results.filter((r) => !r[0]).length;
if (errors.length) console.log("\nPAGE ERRORS\n  " + [...new Set(errors)].join("\n  "));
console.log("\nE2E " + (results.length - bad) + "/" + results.length + (bad || errors.length ? "  — FAILED" : "  — the walker keeps its promises against the door"));
process.exit(bad || errors.length ? 1 : 0);
