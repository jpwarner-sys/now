# NOW — the walker

A one-screen phone surface for one person. It does two jobs and nothing else:

1. **Get things out of your head and into the stack** — a thought, an answer, a floor reading — instantly, with no signal, and never lose one.
2. **Put what the stack needs from you in front of you** — one card at a time, one thing to do at a time — and nothing else, and nothing at all after 02:00 or on a red floor.

Live at **walker.ontologyhome.ca** (GitHub Pages; add it to the home screen as *Walker*). One HTML file, no build, no dependencies, no analytics. The header says `NOW 1.1.0` — if it doesn't, the page is cached and nothing else you are seeing can be trusted.

## The shape of it

The phone is a **terminal with a mailbox**, and there is **one door**.

```
                        ┌──────────────── the door (walker-door) ────────────────┐
  DUMP · START    ─┐    │                                                         │
  card answers    ─┼─ OUT ─▶  dump → raw intake     card_answer → decision record │
  floor/done/lane ─┘  (outbox)                        (floor/done/lane: §5, next)  │
                        │                                                         │
  CARDS deck      ◀─┐   │                                                         │
  NOW list        ◀─┼─ IN ──  cards the seats filed   (starts + brief: §5, next)  │
  STACK line      ◀─┘ (pull)                                                      │
                        └─────────────────────────────────────────────────────────┘
```

- **OUT** is an outbox on the phone. Everything you send waits there, in order, with an id minted once, until the door says `ok`. A retry is never a duplicate — the door de-duplicates on the id. No signal, a wrong key, the dark window: it waits, and the lamp says why.
- **IN** is a pull: at launch, whenever you come back to the app, when the network returns, every five minutes while it is open. It brings the cards waiting on you.
- **The door** is the only thing the phone talks to. Its contract — every field, every error word, what is live and what is next — is **[DOOR.md](DOOR.md)**.

## The five routes

**NOW** — one card, one thing. FIRST picks it and says why. Start runs 25 minutes; Done closes it and counts it; Not today brings it back tomorrow (UNDO takes either back). Beneath: the strips (out, done, cards, floor, lanes), and the rest of the waiting list, each with its age. If the stack sent a line, it sits above the card. On a short phone the whole column scrolls; the card's own buttons are never hidden inside it.

**CARDS** — decisions waiting on you, one at a time, with the recommendation as the primary button. A tap goes out after three seconds (UNDO takes it back). `later` hides a card until the next launch. An expired card can't be answered; you can let it go. *Decided* shows what your taps sent, and anything the door would not take, with the reason.

**FLOOR** — six vectors, 1–5; tap what you know, skip what you don't. Untouched logs as ABSENT, never 0. The chip is computed on the phone; the reading is what is kept.

**STUCK** — break a big thing into small steps (each becomes its own start; the last one closed closes the big one too), set up the door, and move your data between phones. Anything the door refused is listed here with the door's reason: retry it, put a dump back in the box to shorten or split it, or let it go.

**DUMP** — always in reach. Tap: out and forgotten. Hold: START — kept here until Done, *and* sent out, under the same id.

## The rules it enforces

- **02:00–05:59 ET is dark.** Nothing leaves, nothing comes in, nothing is asked. DUMP still works — it holds, and goes after six. From 23:00 a cutoff lamp appears: amber at 90 minutes, red at 30. A lamp, not a clock.
- **A red floor goes dark too.** A Redline reading in the last 12 hours blanks NOW and CARDS rather than ask anything of you.
- **Status is a lamp, never a sentence.** `out` and `in` — tap either for the sentence.
- **The dump text is not kept.** Once the door takes it, the phone keeps a receipt — id, time, byte count, the door's byte count — and drops the text. A start keeps its text only until Done.
- **The door URL and key are never in this repo.** You type them once per phone (STUCK → The door); they live in that phone's storage, and never in an export. The key travels in the request body, never in a URL.
- **Only this page's own code runs.** A Content-Security-Policy pins the page's two scripts by hash and lets it talk only to itself and the door, so text from a card can never run as code.

## FIRST, and the floor matrix

FIRST is the same chooser as `joeos-core/ops.py`: shorter wins (under 14 words, 8 on a Low-battery floor), a leading physical verb wins big, older breaks ties, a question loses.

The floor is a matrix, not a mean: **C** Redline · **A** High drive, low control · **B** Low battery · **!** Tripwire · **D** Full house, thin buffer · **E** Flow · **F** Steady · **—** Incomplete. Energy or control at 2 or below is a tripwire on its own — an average cannot see that. When the phone pulls cards it tells the door only the *band* (`ok` / `thin` / `fail` / `unknown`), never the numbers, and the door holds cards back from a thin floor.

## Storage

One namespace, `now.*`, in this phone's `localStorage`:

| key | holds |
|---|---|
| `now.store.v1` | starts, cards, floor readings, receipts, counters, the outbox, sync stamps |
| `now.lanes.v1` | the four lanes, by day |
| `now.door_url`, `now.door_key` | the door — typed on this phone, never exported |
| `now.walker.route` | the last route open |

**Upgrading from 0.9.x** is automatic and loses nothing: the first 1.0 launch reads `now.walker.v0` and `now.walker.held`, turns held dumps and unsent answers into outbox envelopes *with their original ids*, and carries starts, cards, readings, receipts and counters across. The 0.9 keys are read and never written, so rolling back to 0.9.6 still finds them.

**Export / Import** (STUCK → Your data) moves a phone's store as one JSON file. Import merges, newest record winning; a start finished on either phone never comes back; it also reads 0.9 export files.

A service worker (`sw.js`) keeps the page openable with no signal. It only ever answers same-origin GETs, network first — it never touches the door.

## Tests

```
node test.js          # no dependencies — 190 checks
node test.js --pin-csp  # after editing either script: re-pin their hashes in the CSP
node test/e2e.mjs     # headless Chromium (Playwright) against a mock door — 43 scenarios
```

`test.js` lifts the `<script id="core">` block out of the shipped `index.html` and runs it: joeos-core's own contract vectors (**14 floor-matrix, 15 FIRST** — the same files that test `ops.py`), every wire shape against DOOR.md, the 0.9 migration, the pull-merge rules, the clock on both sides of DST, and the ship greps (no door URL, key, or deployment id anywhere public; every key in `now.*`; the build tag; the CSP's hashes match the scripts).

`test/e2e.mjs` drives the real page against `test/mock-door.mjs`, which answers like the live door — 302 to an echo, an empty body on a wrong key, `error` words, unknown ops filed as dumps, cards held from a thin floor. It covers: nothing lost without a door or a signal; exactly-once delivery; cards in and answers out; UNDO, including after the phone was away; a card answered elsewhere; an answer refused; a refused dump retried, re-boxed or let go; the dark window; a 0.9.6 phone upgrading; a finished start never coming back from an old export; FIRST at real phone heights; and the proposed door taking floor, done, lanes, starts and the brief — and a rolled-back door getting none of them. Screens land in `test/shots/` for a person to look at.

## Layout

```
index.html          the whole app — CORE (pure rules) then the page
sw.js               offline shell
DOOR.md             the wire contract with the stack
manifest.webmanifest, icon*, apple-touch-icon.png
test.js             unit + contract + ship checks (node, no deps)
test/e2e.mjs        the page against a mock door (Playwright)
test/mock-door.mjs  a door that behaves like the live one
contract/           joeos-core's vectors
RECONCILIATION.md   where this came from
legacy/, engine/    the two apps it grew out of — reference, not build inputs
```

## Licence

Personal project, no licence granted. Read it, learn from it, don't ship it as yours.
