# DOOR — the one wire between the walker and the stack

The walker (this app) never talks to Drive, the Sheet, a model, or an agent. It talks to **one door**: the `walker-door` web app, whose source lives in the tree at `6_APP/_door/` and is changed only by its own seat through clasp — never from this repo. Everything the phone sends the stack, and everything the stack sends the phone, crosses here.

This file is the contract. **Live** means the door deployed today (`@3 cards-post`) does it. **Proposed** means the phone is already built for it and the door does not yet do it. A proposed op is never sent to a door that has not advertised it (§4).

## 1. Transport — every call

- `POST <door URL>` with a JSON body, sent as `Content-Type: text/plain;charset=utf-8`. That makes it a CORS *simple request*: no preflight, which the door cannot answer. The door replies `302`; the browser follows it with a `GET` to an echo URL, and that response carries the JSON. (Sending `application/json` breaks this — 0.9.5.)
- **The key is a field in the body.** It is never in a URL, a query string, a header, a log line, or this repo. The door URL and key are typed into the phone once (STUCK → The door) and live only in its `localStorage` (`now.door_url`, `now.door_key`).
- An **empty body** means the door stopped before reading: a wrong or missing key, a body over 32 KB, or JSON it could not parse. The phone reads it as `unauthorized` and keeps everything. It never sends the other two.
- A refusal after the key is accepted is `{"ok": false, "code": <number>, "error": "<word>"}`. The HTTP status is 200 either way; **the word is the reason.**
- `GET <door URL>` with no key answers the plain text `walker-door`. It proves the URL and touches nothing (STUCK → Test door).

## 2. Out — what the phone sends (live)

Everything outbound is an **envelope** in the phone's outbox, `{id, op, at, body}`, kept in order until the door says `ok`. The id is minted once and reused on every retry, and the door de-duplicates on it, so a retry is never a second write.

### `dump` — a thought, out of the head

```json
{ "key": "…", "text": "call the plumber", "receipt_id": "<uuid>",
  "schema": "lab.intake.raw/v1", "origin_surface": "walker", "surface_version": "1.0.1" }
```

No `op` field: the door reads a body without one as a dump. `receipt_id` is the envelope id (a UUID). The door writes one `raw_<UTC stamp>_<receipt_id>.md` into the intake feeds with the RAW_SHAPE front matter, and answers:

```json
{ "ok": true, "receipt_id": "<uuid>", "bytes": 16 }
```

The phone keeps a **receipt** — id, time, its own byte count, the door's byte count, `readback: ok | size mismatch` — and drops the text. The text is never stored on the phone past this point.

A START (hold DUMP) is a dump *and* a start: the start keeps the text on the phone until Done, under the **same id** as its dump, so the stack can match the two.

Limits the phone enforces before sending: text ≤ 30,000 bytes (the door's cap is 32 KB for the whole body, and over it the door goes silent). The door takes 60 writes per rolling hour; `rate_limited` holds the rest for the next sync.

### `card_answer` — your tap on a card

```json
{ "op": "card_answer", "key": "…", "id": "<card id>", "choice": "Yes", "at": "<ISO time of the tap>" }
```

→ `{ "ok": true, "id": "…", "receipt_id": "…", "bytes": … }`, or `{ "ok": true, "id": "…", "already": true }` if it was answered before. Both mean done. The door files the answer as a raw record (`origin_surface: walker_decision`).

The answer waits 3.5 s on the phone before it goes, so UNDO can take it back.

## 3. In — what the stack sends the phone (live)

### `cards` — the decisions waiting on you

```json
{ "op": "cards", "key": "…", "since": "0", "floor": "{\"st\":\"F\",\"red\":false,\"n\":6,\"state\":\"ok\",\"at\":\"…\"}" }
```

→

```json
{ "ok": true, "stamp": "2026-09-24T12:00:00Z",
  "cards": [ { "id": "…", "at": "…", "kind": "WORD", "text": "…", "options": ["Yes","No"],
               "recommend": "Yes", "ttl_h": 24, "source_file": "…" } ] }
```

- `floor` is the phone's **band**, never the six numbers: `state` is `ok` (E or F, all six set), `thin` (A, B, D, or incomplete), `fail` (C or a tripwire), or `unknown` (never logged). The door **holds** cards back while the band is not ok — the stack does not ask a thin floor for decisions.
- **`since` is always `"0"`.** The door filters `card.at > since` as a string compare. With a real cursor, a card held for a thin floor falls behind the cursor and is never delivered (door defect D1), and so does a card a seat stamped with a slow clock (D2). Asking from zero returns the whole open set — at most 50 cards — every time. The phone de-duplicates by id.
- Because a pull with an ok (or unknown) band is the whole open set, a card the phone still shows that is **missing** from it was answered elsewhere or purged; the phone lets it go. After a thin pull it keeps everything.
- `kind` is `SPEND`, `MAIL_OUT`, `IRREVERSIBLE` or `WORD`. `recommend`, when present, is one of `options` and is drawn as the primary button. A card past `at + ttl_h` is shown as expired and cannot be answered (the door would refuse it).

### Where cards come from

A seat files a card with `card_put` — a keyed call from the stack's side, never from the phone:

```json
{ "op": "card_put", "key": "…", "id": "…", "kind": "WORD", "text": "≤240 chars",
  "options": ["≤4 options, ≤40 chars each"], "recommend": "one of options", "ttl_h": 24,
  "at": "…", "source_file": "…" }
```

**This is the half that is not wired yet.** See §6.

## 4. What the phone does with an answer from the door

Every error word lands in one of four buckets (`CORE.classify`):

| verdict | words | what happens |
|---|---|---|
| **stop** | `network` `offline` `unauthorized` `no_door` `bad_response` `rate_limited` `server` `write_failed` `http_5xx` | Stop this round. Keep everything, in order. The OUT lamp names the reason. |
| **final** | `expired` `not_found` `choice_invalid` `choice_required` `id_required` `schema_or_origin` `receipt_id_required` `receipt_id_invalid` `surface_version_invalid` `payload_too_large` | This envelope will never be taken as it is. An answer is dropped and its card says *not taken · expired*. A dump keeps its text on the phone, marked refused, until you retry it (STUCK → The door) — a dump is never thrown away for you. |
| **refused** | `unknown_op` `unsupported` `bad_op` `not_implemented` | The door does not know this op. It is parked with the others (below). |
| **retry** | anything else | Keep it; try next round. |

**The door does not know the clock.** 02:00–05:59 ET (America/Toronto, never a fixed UTC hour) the phone sends nothing and pulls nothing. DUMP still works: it holds on the phone, and goes after six (R-068).

**Unknown ops are dumps at the live door.** So the phone sends only `dump` and `card_answer` — plus any op the door lists in `ops` on a pull (§5). Everything else waits on the phone, in order, capped at 300, and goes the day the door lists it.

## 5. Proposed — the phone is ready, the door is not

Each of these is a door change for the door's own seat. None of them changes a live shape; a door that does none of them keeps working with this phone exactly as it does today.

1. **Advertise.** Add `"ops": ["floor","done","lane"]` (whichever it takes) and `"door": "walker-door@4"` to the `cards` response. The phone starts sending those ops on the next sync.
2. **`floor`** — each reading, so the ledger stops depending on a copy of the app that is not on the phone:
   `{ "op":"floor", "key", "event_id", "at", "origin_surface":"walker", "v": {"family":3,"energy":null,…} }`. Absent is `null`, never 0. The chip is not sent; the stack computes it from the reading.
3. **`done`** — a start closed on the phone:
   `{ "op":"done", "key", "event_id", "at", "origin_surface":"walker", "ref":"<start id>", "from":"phone|stack", "outcome":"done|dropped", "words":4 }`. For a phone start, `ref` is the `receipt_id` of the dump that created it. No text.
4. **`lane`** — a lane tick: `{ "op":"lane", …, "day":"2026-09-24", "lane":"laundry", "on":true }`. Rapid toggles are coalesced on the phone; last one wins.
5. **Starts and a brief, in the pull.** The `cards` response may carry
   `"starts": [ {"id":"…","text":"Call the vendor","at":"…","why":"…"} ]` — next physical actions the stack wants on the NOW list (they enter FIRST like anything you typed, marked *stack*, and their `done` goes back with `from: "stack"`) — and `"brief": "one line"`, shown as the STACK strip. A start you finished is never re-filed on the phone even if the door sends it again.
6. **Door defects** noted 2026-09-21, which the phone now works around but the door should still fix: D1/D2 (`since` compare — the phone sends `"0"`), D3 (expired, unanswered cards are never purged, so the store fills to `cards_full`).

## 6. The other side of the door — what the stack must do for cards to reach the phone

The phone pulls whatever is in the door. Today, **nothing files cards into the door**: the seat that turns stack questions into cards writes them somewhere the hosted phone cannot reach, and the pipe that carries decisions to the ledger reads from that same place. Until one of these lands, the CARDS tab can only ever show cards a person filed by hand:

- **Cards in:** the card-filing seat calls `card_put` (§3) instead of writing elsewhere. A seat needs a key to do that — or the door reads a folder the seats already write to, and no seat ever holds the key. That choice is the operator's.
- **Answers out:** the ledger pipe reads decisions from the door (a keyed read of answered cards — the door already keeps them 7 days) instead of from the other copy.
- **Floor, done, lanes out:** §5.2–5.4.

## 7. Testing this contract

`node test.js` checks every live shape above byte-for-byte against `CORE.wire` / `CORE.pullBody`, and that the key appears in no URL anywhere. `node test/e2e.mjs` drives the real page in headless Chromium against `test/mock-door.mjs`, which answers like the live door — including the 302 → echo, the empty body on a bad key, the `error` words, `unknown op → dump`, and the thin-floor hold — and, switched to `v2`, like the proposed one.
