/*
 * mock-door.mjs — a stand-in for walker-door, for tests only. Never shipped.
 *
 * mode "live" answers the way the walker-door @3 source does — checked against that source running
 * in an Apps Script shim (door harness, 2026-09-24), not against memory:
 *   - POST text/plain with a JSON body → 302 → the browser GETs an echo URL → JSON there
 *   - wrong key / a body over 32 KB (UTF-8 bytes) / unreadable JSON / not an object → an EMPTY body
 *   - refusals are {ok:false, code:<n>, error:<word>}; the codes are the live ones (422, 429, 500)
 *   - no op, or an op it does not know → treated as a dump (a body without dump fields is refused
 *     schema_or_origin — nothing is filed)
 *   - 60 dump writes per rolling hour, then rate_limited; a replay of a written receipt still answers
 *   - card_put validates like the door (id, kind, text ≤ 240, options cut to 4 × 40, recommend, walls,
 *     50 open cards) and stamps the card held_until_ok from the LAST floor any pull posted
 *   - cards: `card.at > since` string compare; the hold is PER CARD, set when it was filed; an ok
 *     (or unknown) pull releases every held card; a thin pull hides only cards filed while thin
 *   - GET with no key → "walker-door"
 *   - state.htmlNext = N: the next N POSTs get an HTML error page, as Google serves when it, not the
 *     door, answers (the door's own code answers JSON or an empty body, never a page)
 *   - state.knockNext = N (of state.knockOp, when set): the POST is 302'd to GET /exec instead of the
 *     echo — the only way fetch turns a POST into a GET — so doGet answers "walker-door". knockAfter:
 *     false = doPost never ran (nothing read or written); true = it ran, only the way back went wrong.
 *     knockDelayMs holds that 302 back, so a knocked request can be made to finish last.
 * mode "v2" adds the proposed ops (DOOR.md §5): it advertises them and takes floor/done/lane,
 * and returns starts and a brief on the pull.
 *
 * put(card) is the tests' back door: no validation (short ids like "c-1" are fine), but the same
 * floor stamp as card_put.
 */
import http from "node:http";

const RID = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9_-]{8,64})$/;
const SV = /^[A-Za-z0-9._-]{1,32}$/;
const KINDS = ["SPEND", "MAIL_OUT", "IRREVERSIBLE", "WORD"];
const WALLS = ["_hearth", "raw_", "0_law", "1_model", "2_now", "modules/life"];
const fail = (code, error) => ({ ok: false, code, error });
const walled = (s) => { s = String(s || "").toLowerCase(); return !!s && WALLS.some((w) => s.includes(w)); };
const isoZ = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

export function startMockDoor({ key = "test-key", mode = "live" } = {}) {
  const state = {
    mode,
    posts: [],          // every body received, key stripped, in order
    raw: [],            // raw files the door wrote (dumps and answers)
    cards: [],          // what seats filed with card_put
    events: [],         // v2: floor / done / lane
    starts: [],         // v2: starts the stack wants on the phone
    brief: null,        // v2
    down: false,        // true = drop every connection (network failure)
    delayMs: 0,         // a slow door
    htmlNext: 0,        // the next N POSTs get Google's error page instead of the door's JSON
    knockNext: 0,       // the next N POSTs (of knockOp, when set) are 302'd to GET /exec instead of the echo —
    knockOp: null,      //   the only way fetch turns a POST into a GET — so doGet answers "walker-door".
    knockAfter: false,  //   false: doPost never ran (nothing read or written); true: it ran, only the way back went wrong
    knockDelayMs: 0,    //   the knocked 302 comes back this late
    gets: 0,            // GET /exec calls (doGet runs)
    lastFloor: null,
    seen: new Map(),    // receipt_id → first reply (7-day de-dup)
    rate: [],           // accepted dump writes, ms
  };
  const echoes = new Map();
  let seq = 0;

  function parseFloor(floor) {
    let f = floor;
    if (f === undefined || f === null || f === "") return null;
    if (typeof f === "string") { const low = f.toLowerCase(); if (["ok", "thin", "fail"].includes(low)) return { state: low }; try { const o = JSON.parse(f); f = o && typeof o === "object" ? o : { state: low }; } catch { f = { st: f, state: low }; } }
    return f && typeof f === "object" ? f : null;
  }
  function held(f) {
    if (!f) return false;
    const st = String(f.state || "").toLowerCase();
    return st === "thin" || st === "fail" || f.red === true || ["C", "!", "A", "B", "D", "—"].includes(String(f.st || ""));
  }
  function applyFloor(f) {
    if (!f) return;
    state.lastFloor = f;
    if (!held(f)) for (const c of state.cards) c.held_until_ok = false;
  }

  function dump(b) {
    if (b.schema !== "lab.intake.raw/v1" || !["walker", "walker_v0"].includes(b.origin_surface)) return fail(422, "schema_or_origin");
    const rid = String(b.receipt_id || "").trim();
    if (!rid) return fail(422, "receipt_id_required");
    if (!RID.test(rid)) return fail(422, "receipt_id_invalid");
    if (b.surface_version !== undefined && b.surface_version !== null && b.surface_version !== "" && !SV.test(String(b.surface_version))) return fail(422, "surface_version_invalid");
    const text = String(b.text || "");
    if (state.seen.has(rid)) return state.seen.get(rid);
    const now = Date.now();
    state.rate = state.rate.filter((t) => t > now - 3600e3);
    if (state.rate.length >= 60) return fail(429, "rate_limited");
    state.rate.push(now);
    const bytes = Buffer.byteLength(text, "utf8");
    state.raw.push({ receipt_id: rid, origin_surface: "walker", surface_version: b.surface_version, bytes, text });
    const reply = { ok: true, receipt_id: rid, bytes };
    state.seen.set(rid, reply);
    return reply;
  }

  function cardPut(b) {
    const id = String(b.id || "").trim();
    if (!RID.test(id)) return fail(422, "id_invalid");
    if (!KINDS.includes(String(b.kind || ""))) return fail(422, "kind_invalid");
    const text = String(b.text || "");
    if (!text || text.length > 240) return fail(422, "text");
    if (walled(text) || walled(b.source_file)) return fail(422, "walled");
    const options = [];
    if (b.options && b.options.length) for (let i = 0; i < b.options.length && options.length < 4; i++) { const l = String(b.options[i] || "").trim(); if (l) options.push(l.slice(0, 40)); }
    if (!options.length) return fail(422, "options");
    const recommend = String(b.recommend || "");
    if (recommend && !options.includes(recommend)) return fail(422, "recommend");
    let ttl = Number(b.ttl_h); if (!isFinite(ttl) || ttl <= 0) ttl = 24; if (ttl > 720) ttl = 720;
    const at = String(b.at || isoZ());
    applyFloor(parseFloor(b.floor));
    const prev = state.cards.find((c) => c.id === id);
    if (prev && prev.answered) return fail(422, "already_answered");
    const h = held(state.lastFloor);
    const card = { id, at, kind: String(b.kind), text, options, recommend, ttl_h: ttl, source_file: String(b.source_file || ""), held_until_ok: h };
    if (prev) Object.assign(prev, card);
    else {
      if (state.cards.filter((c) => !c.answered).length >= 50) return fail(422, "cards_full");
      state.cards.push(card);
    }
    return { ok: true, id, held_until_ok: h, at };
  }

  function reply(b) {
    const { key: _k, ...rest } = b;
    state.posts.push(rest);
    const v2 = state.mode === "v2";
    switch (b.op) {
      case "cards": {
        applyFloor(parseFloor(b.floor));
        const since = b.since === undefined || b.since === null ? "0" : String(b.since);
        const keep = (c) => { if (["", "0"].includes(since) || !c.at) return true; return /^\d+$/.test(since) && /^\d+$/.test(String(c.at)) ? Number(c.at) > Number(since) : String(c.at) > since; };
        const cards = state.cards
          .filter((c) => !c.answered && !c.held_until_ok && !walled(c.text) && !walled(c.source_file) && keep(c))
          .map((c) => ({ id: c.id, at: c.at, kind: c.kind, text: c.text, options: c.options, recommend: c.recommend, ttl_h: c.ttl_h, source_file: c.source_file || "" }));
        const out = { ok: true, cards, stamp: isoZ() };
        if (v2) { out.ops = ["floor", "done", "lane"]; out.door = "walker-door@mock-v2"; out.starts = state.starts; out.brief = state.brief; }
        return out;
      }
      case "card_answer": {
        const id = String(b.id || "").trim(), choice = String(b.choice || "").trim();
        if (!id) return fail(422, "id_required");
        if (!choice) return fail(422, "choice_required");
        const c = state.cards.find((x) => x.id === id);
        if (!c) return fail(422, "not_found");
        if (c.answered) return { ok: true, id, already: true };
        const born = Date.parse(c.at || "");
        if (isFinite(born) && Date.now() > born + (Number(c.ttl_h) || 24) * 3600e3) return fail(422, "expired");
        if (Array.isArray(c.options) && c.options.length && !c.options.includes(choice)) return fail(422, "choice_invalid");
        c.answered = { choice, at: b.at };
        const body = "card_id: " + id + "\nchoice: " + choice + "\nkind: " + (c.kind || "") + "\nat: " + b.at + "\n";
        state.raw.push({ receipt_id: id, origin_surface: "walker_decision", card_id: id, choice, at: b.at });
        return { ok: true, id, receipt_id: id, bytes: Buffer.byteLength(body) };
      }
      case "card_put":
        return cardPut(b);
      case "floor": case "done": case "lane":
        if (v2) {
          if (!state.events.find((e) => e.event_id === b.event_id)) state.events.push(rest);
          return { ok: true, event_id: b.event_id };
        }
        return dump(b);                              // the live door: an unknown op is a dump (and without dump fields, refused)
      default:
        return dump(b);
    }
  }

  const server = http.createServer((req, res) => {
    if (state.down) { req.socket.destroy(); return; }
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (req.url.startsWith("/exec") && req.method === "GET") {
      state.gets++;
      res.writeHead(200, { ...cors, "Content-Type": "text/plain" });
      res.end("walker-door");
      return;
    }
    if (req.url.startsWith("/exec") && req.method === "POST") {
      if (/[?&]key=/.test(req.url)) state.keyInUrl = true;
      const chunks = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => {
        const buf = Buffer.concat(chunks);
        state.contentTypes = (state.contentTypes || []).concat(req.headers["content-type"]);
        let op = "dump";
        try { op = JSON.parse(buf.toString("utf8")).op || "dump"; } catch {}
        const knock = state.knockNext > 0 && (!state.knockOp || state.knockOp === op);
        if (knock) state.knockNext--;
        let out = "";
        if (knock && !state.knockAfter) {
          // doPost never runs
        } else if (state.htmlNext > 0) {                     // Google answered, not the door (the door's code never sends a page)
          state.htmlNext--;
          out = '<!DOCTYPE html><html><head><title>Error</title></head><body><div>Sorry, unable to open the file at this time.</div>' +
            '<p>Please try again: https://door.example.invalid/exec/abcdefghijklmnopqrstuvwx</p></body></html>';
        } else if (buf.length <= 32768) {             // bytes, as the door counts them
          let b = null;
          try { b = JSON.parse(buf.toString("utf8")); } catch { b = null; }
          if (b && typeof b === "object" && !Array.isArray(b) && b.key === key) out = JSON.stringify(reply(b));
        }
        const id = "e" + ++seq;
        echoes.set(id, out);
        setTimeout(() => { res.writeHead(302, { ...cors, Location: knock ? "/exec" : "/echo?id=" + id }); res.end(); }, state.delayMs + (knock ? state.knockDelayMs : 0));
      });
      return;
    }
    if (req.url.startsWith("/echo") && req.method === "GET") {
      const id = new URL(req.url, "http://x").searchParams.get("id");
      const body = echoes.get(id) || "";
      res.writeHead(200, { ...cors, "Content-Type": body.startsWith("<") ? "text/html" : "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/exec`, key, state,
        put(card) { state.cards.push({ ttl_h: 24, at: new Date().toISOString(), held_until_ok: held(state.lastFloor), ...card }); },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
      });
    });
  });
}
