# NOW

A one-screen daily surface. Five routes — **NOW**, **CARDS**, **FLOOR**, **STUCK**, and a DUMP bar that is always in reach.

Live: **https://jpwarner-sys.github.io/now/**

One HTML file, no build step, no dependencies, no analytics, no network calls except the two you opt into (below). Read `index.html` top to bottom in a few minutes — that is the entire app.

## What it does

**NOW** — one card, one thing. FIRST picks it; the card says *why* it picked it. Start runs a 25-minute timer; Done deletes it and counts it. Beneath: four status strips (raw, done, cards, floor) and a lanes row.

**CARDS** — decisions waiting on you, one at a time, with a recommendation. The phone **pulls** open cards from the keyed door (POST `cards`) on launch, on focus, on a 5-minute heartbeat, and on a service-worker `{type:"pull"}` message. A tap POSTs `card_answer`. `later` hides a card until the next launch. Expired cards (`ttl_h`) are not answerable.

**FLOOR** — six vectors, 1–5, tap what you know and skip what you don't. Untouched logs as ABSENT, never as 0. The chip is computed on the device from what is set; only the reading is stored.

**STUCK** — one next physical step, or break a big thing into stages.

**DUMP** — tap to send a thought out and forget it; hold to keep it as a start until Done.

## The rules it enforces

- **02:00–05:59 goes dark.** No writes, no list, no ask. From 23:00 a cutoff lamp shows amber at 90 minutes and red at 30. A lamp, not a clock.
- **A red floor goes dark too.** State C (Redline) blanks the screen rather than asking anything of you.
- **Status is a lamp, never a sentence.** Tap a lamp to get the sentence.
- **The dump text is never stored.** A dump leaves a receipt — byte count, hash, readback — and nothing else.

## FIRST

Open items are scored: shorter wins (14 words, 8 when the floor reads Low battery), an imperative physical verb wins big, older breaks ties, a question is penalised. A port of the same chooser that runs in `joeos-core/ops.py`, verb list and weights intact.

## The floor matrix

Six vectors resolve to one state: **C** Redline · **A** High drive, low control · **B** Low battery · **!** Tripwire · **D** Full house, thin buffer · **E** Flow · **F** Steady · **—** Incomplete. Energy or control at 2 or below is a tripwire on its own — an average cannot see that, which is why this is a matrix and not a mean.

## Storage

`localStorage` on the device. Six collections — items, cards, decisions, floor, receipts, counters — plus a held-dump queue. It survives reload and offline. It does not sync between devices, and nothing is sent anywhere.

*Note: This app is hosted at `now.ontologyhome.ca` (no DNS resolution required, it's a local alias/subdomain). The storage keys are prefixed with `now.` to prevent collisions with other apps if hosted on a shared domain like `github.io`.*

**Every copy of this app keeps its own store.** To move what is in one, use **STUCK → Your data**: *Export* writes a single JSON file to the device — starts, cards, decisions, floor readings, receipts, counters and lanes; *Import* merges one back in, newest write winning per record. Credentials are never exported. Nothing is uploaded.

## The raw door (optional)

Off by default and shipped with no credentials — **this repo is public and carries neither a door URL nor a door key.**

To turn it on, open **STUCK → Raw door** and paste two values, both kept in `localStorage` on this device (`now.door_url` and `now.door_key`) and never committed:

1. A **door URL** — the door endpoint you already have.
2. A **door key** — the shared secret that endpoint expects in the JSON body.

Enter them once per device. DUMP then POSTs JSON `{key, text, receipt_id, schema, origin_surface}` to that URL — **the dump key stays in the JSON body.** Cards pull POSTs JSON `{op:"cards", key, since, floor}` as `text/plain;charset=utf-8` (CORS-simple, same as DUMP) — **the key stays in the JSON body, never in a URL.** When both values are set, that keyed path is preferred.

Without both values every dump queues on the device and the raw lamp stays red. Nothing is lost; the next dump retries the queue. The toast says which of the two is missing.

## Install

Open the live URL in Safari → Share → **Add to Home Screen**. Standalone, dark status bar, its own icon.

## Tests

```
node test.js
```

No dependencies, no build, no framework. It reads `index.html` as text, pulls the shipped functions out of it, and runs them against `contract/` — joeos-core's own vectors, the same files that test `ops.py` and `first.ts`. Door-ship greps (no URL/key, `now.door_*`, `last_pull_stamp`, `card_put`/`card_answer`, four pull triggers) plus **29 cases: 14 floor-matrix, 15 FIRST.** All must pass.

A port is only worth something if it gives the same answers as the thing it was ported from. This is how that is checked rather than asserted.

## Where it came from

This app is a reconciliation of two earlier ones. **[RECONCILIATION.md](RECONCILIATION.md)** maps every ported piece to its source, says which direction the merge ran and why, and lists what was left behind. Both originals are here to diff against.

## Layout

```
index.html                 the whole app — read this
RECONCILIATION.md          what came from where, and what didn't
manifest.webmanifest       standalone display, icons
icon.svg  icon-192.png  icon-512.png  icon-512-maskable.png  apple-touch-icon.png

legacy/walker.html         the first app — the face this one kept
engine/                    the second app — the brain this one took
  src/lib/first.ts           the FIRST chooser, ported into index.html
  src/lib/state.ts           the v5.1 floor matrix, ported into index.html
  src/lib/lanes.ts           lanes and streaks, ported into index.html
  src/lib/clock.ts           the 02:00 cutoff, ported into index.html
  src/lib/door.ts            the raw door, both transports
  src/lib/ids.ts             REDACTED — see RECONCILIATION.md
```

`engine/` and `legacy/` are reference, not build inputs. Nothing in this repo compiles; `index.html` is the app.

## Licence

Personal project, no licence granted. Read it, learn from it, don't ship it as yours.
