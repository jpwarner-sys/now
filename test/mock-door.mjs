/*
 * mock-door.mjs — a stand-in for walker-door, for tests only. Never shipped.
 *
 * mode "live" answers the way walker-door @3 does (DOOR.md §1–4), because those details
 * are what broke the phone before:
 *   - POST text/plain with a JSON body → 302 → the browser GETs an echo URL → JSON there
 *   - wrong key / oversize / bad JSON → an EMPTY body
 *   - refusals are {ok:false, code:<n>, error:<word>}
 *   - no op, or an op it does not know → treated as a dump
 *   - cards: `card.at > since` string compare; a floor that is not ok holds cards back
 *   - GET with no key → "walker-door"
 * mode "v2" adds the proposed ops (DOOR.md §5): it advertises them and takes floor/done/lane,
 * and returns starts and a brief on the pull.
 */
import http from "node:http";

const RID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{8,64})$/i;
const SV = /^[A-Za-z0-9._-]{1,32}$/;
const fail = (code, error) => ({ ok: false, code, error });

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
    lastFloor: null,
    seen: new Map(),    // receipt_id → first reply (7-day de-dup)
  };
  const echoes = new Map();
  let seq = 0;

  function held(floor) {
    let f = floor;
    if (typeof f === "string") { try { f = JSON.parse(f); } catch { f = { state: f }; } }
    if (!f || typeof f !== "object") return false;
    return f.state === "thin" || f.state === "fail" || f.red === true || ["C", "!", "A", "B", "D", "—"].includes(f.st);
  }

  function dump(b) {
    if (b.schema !== "lab.intake.raw/v1" || !["walker", "walker_v0"].includes(b.origin_surface)) return fail(400, "schema_or_origin");
    if (!b.receipt_id) return fail(400, "receipt_id_required");
    if (!RID.test(b.receipt_id)) return fail(400, "receipt_id_invalid");
    if (b.surface_version != null && !SV.test(b.surface_version)) return fail(400, "surface_version_invalid");
    if (typeof b.text !== "string" || !b.text) return fail(400, "schema_or_origin");
    if (state.seen.has(b.receipt_id)) return state.seen.get(b.receipt_id);
    const bytes = Buffer.byteLength(b.text, "utf8");
    state.raw.push({ receipt_id: b.receipt_id, origin_surface: "walker", surface_version: b.surface_version, bytes, text: b.text });
    const reply = { ok: true, receipt_id: b.receipt_id, bytes };
    state.seen.set(b.receipt_id, reply);
    return reply;
  }

  function reply(b) {
    const { key: _k, ...rest } = b;
    state.posts.push(rest);
    const v2 = state.mode === "v2";
    switch (b.op) {
      case "cards": {
        state.lastFloor = b.floor;
        const since = String(b.since || "0");
        const hold = held(b.floor);
        const cards = hold ? [] : state.cards
          .filter((c) => !c.answered && String(c.at) > since)
          .map(({ answered, ...c }) => c);
        const out = { ok: true, cards, stamp: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
        if (v2) { out.ops = ["floor", "done", "lane"]; out.door = "walker-door@mock-v2"; out.starts = state.starts; out.brief = state.brief; }
        return out;
      }
      case "card_answer": {
        if (!b.id) return fail(400, "id_required");
        if (!b.choice) return fail(400, "choice_required");
        const c = state.cards.find((x) => x.id === b.id);
        if (!c) return fail(404, "not_found");
        if (c.answered) return { ok: true, id: b.id, already: true };
        if (Date.now() > Date.parse(c.at) + (c.ttl_h || 24) * 3600e3) return fail(410, "expired");
        if (Array.isArray(c.options) && c.options.length && !c.options.includes(b.choice)) return fail(400, "choice_invalid");
        c.answered = { choice: b.choice, at: b.at };
        state.raw.push({ receipt_id: b.id, origin_surface: "walker_decision", card_id: b.id, choice: b.choice, at: b.at });
        return { ok: true, id: b.id, receipt_id: b.id, bytes: 64 };
      }
      case "card_put": {
        const { op: _op, ...card } = rest;
        state.cards.push({ ttl_h: 24, ...card });
        return { ok: true, id: b.id, held_until_ok: false, at: b.at };
      }
      case "floor": case "done": case "lane":
        if (v2) {
          if (!state.events.find((e) => e.event_id === b.event_id)) state.events.push(rest);
          return { ok: true, event_id: b.event_id };
        }
        return dump(b);                              // the live door: an unknown op is a dump
      default:
        return dump(b);
    }
  }

  const server = http.createServer((req, res) => {
    if (state.down) { req.socket.destroy(); return; }
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (req.url.startsWith("/exec") && req.method === "GET") {
      res.writeHead(200, { ...cors, "Content-Type": "text/plain" });
      res.end("walker-door");
      return;
    }
    if (req.url.startsWith("/exec") && req.method === "POST") {
      if (/[?&]key=/.test(req.url)) state.keyInUrl = true;
      let raw = "";
      req.on("data", (d) => { raw += d; });
      req.on("end", () => {
        state.contentTypes = (state.contentTypes || []).concat(req.headers["content-type"]);
        let out = "";
        if (raw.length <= 32768) {
          let b = null;
          try { b = JSON.parse(raw); } catch { b = null; }
          if (b && b.key === key) out = JSON.stringify(reply(b));
        }
        const id = "e" + ++seq;
        echoes.set(id, out);
        setTimeout(() => { res.writeHead(302, { ...cors, Location: "/echo?id=" + id }); res.end(); }, state.delayMs);
      });
      return;
    }
    if (req.url.startsWith("/echo") && req.method === "GET") {
      const id = new URL(req.url, "http://x").searchParams.get("id");
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(echoes.get(id) || "");
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
        put(card) { state.cards.push({ ttl_h: 24, at: new Date().toISOString(), ...card }); },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
      });
    });
  });
}
