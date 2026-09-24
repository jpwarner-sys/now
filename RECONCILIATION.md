# Reconciliation — how Walker and joe-os-now became NOW

## 1.1 — audited, and checked against the real door (2026-09-24)

1.0 was checked against a mock of the door written from memory. 1.1 was checked against the door's own @3 source, run under an Apps Script shim, and against an audit of the page by lens (time, iOS, security, UX, the door, the tests), every finding reproduced before it was fixed:

- **Nothing sent can be lost or doubled:** a dump too big *on the wire* (JSON escaping counts line breaks and quotes twice) is caught at DUMP, and one already queued is set aside instead of stopping the queue; UNDO runs on the wall clock and never takes back what is already in the air; two open copies never overwrite each other's store; the 02:00 rule is checked before every send, not once per flush.
- **What the phone says is true:** an old floor reading stops holding cards after 12 hours, like the red-floor dark; an answer the door already had is shown as that, not as *sent*; a door that stops listing floor/done/lane (rolled back, or another door) gets none of them; the clock counts minutes to the cutoff forward, so DST is honest; what you finish after midnight counts to the day it belongs to (the day ends at the 02:00 cutoff, not at midnight).
- **Nothing is trapped or hidden:** what the door refused is listed on STUCK with its reason — retry, back to the box (kept through a relaunch until it goes), or let go; FIRST keeps its buttons on the card at real phone heights; a 0.9 park comes back; the last step of a broken-down start closes the big one; Not today has UNDO; a finished start never comes back from an older export.
- **Only the page's own code runs:** a Content-Security-Policy pins both scripts by hash.
- **Found in the door, not fixable here:** the @3 card store deletes its own index on every save, so no filed card reaches the phone (DOOR.md §5.7). The fix is one line in the door; it is the door seat's to deploy.

## 1.0 — rebuilt from first principles (2026-09-24)

0.9.x was a reconciliation: the walker's face with the engine's brain, and every transport either of them had ever used still inside — the artifact runtime's database, its model and its Drive connector, a Google sign-in path, a keyed door, a held-dump queue beside a store beside a pull stamp. On the phone where it actually lives, only one of those does anything: **the keyed door.** The rest were dead weight that made the one live path hard to see and easy to break.

1.0 keeps what was right and rebuilds what was not:

- **Kept, byte for byte in behaviour:** the face (every screen, the type scale, the lamps, the DUMP bar, "Garbage or Gold?"), the floor matrix, FIRST, lanes, the cutoff lamp, the dark window. The 29 contract cases pass against the same vectors.
- **Rebuilt:** the plumbing, as **one door with an outbox and a pull** (README, DOOR.md). Everything outbound is an envelope with an id minted once; the door de-duplicates on it; nothing leaves the outbox until the door says ok.
- **Removed:** the artifact runtime paths (`db`, `sample`, `mcp`), the Google sign-in and Drive multipart writer, and STUCK's two ask-a-model buttons — none of them can run on the hosted phone. STUCK's *Break it down* stays, written by hand.
- **Fixed against the live door:** the door reads any unknown op as a dump, so the phone never sends an op the door has not listed; the `since` cursor lost held cards (D1/D2), so the pull asks from zero; refusals are named by the door's `error` word, and a refusal that can never succeed is not retried forever (D4); a 0.9 held dump without a receipt id would have migrated to an id the door refuses; the door boxes no longer lose what you typed on a redraw (the Save trap); a keyless *Test door* knock.
- **Carried across:** a 0.9.x phone upgrades with nothing lost (README § Storage). The 0.9 keys are read, never written.

What 1.0 cannot fix from this repo is the other side of the door: nothing in the stack files cards into it yet, and the ledger does not read answers from it. DOOR.md §6 says what that takes.

Everything below describes 0.9.x and is kept as the record.

---

Two apps were built for the same job, in two conversations, on the same night. This file says exactly what each one was, what came from where, and what was left behind — so the app at `index.html` can be judged instead of taken on trust.

Everything named here is in this repo. `legacy/walker.html` is the first app, unmodified except for one redacted constant. `engine/` is the second app's source, unmodified except for one redacted file.

## The two halves

**Walker** — `legacy/walker.html`, 46 KB, one hand-written file, no build step. Iterated screen by screen with the owner: the FIRST card, the CARDS deck, the four status strips, the DUMP bar where a tap sends a thought away and a hold keeps it, the lamp rule (status is a lamp, never a sentence), the type scale, the 13.5px floor, "Garbage or Gold?". It was the daily driver. Its weakness was its brain: FIRST was whatever had waited longest, and the floor chip was an average of six numbers.

**joe-os-now** — `engine/`, Vite + React + Capacitor, with a Python core (`joeos-core`, not in this repo) holding the real logic and its contract tests. Its brain was right: a scoring chooser ported from `ops.py`, the live v5.1 state matrix from `state.py`, lanes, an iris hero card, a store adapter that finds a shared database when one exists and falls back to local when it doesn't, and a raw door with two transports. Its weakness was its face: a different header, lanes where the FIRST card belongs, tabs reading DUMP/NOW/FLOOR/SET, no FIRST card at all, no CARDS deck.

A ruling said to merge them by building `engine/` and publishing the build over the first app's URL. The token port happened — colours, type scale — and stopped there. **The merge never landed.** Rendering the built `dist/` is what proved it: the engine was sound, the composition was not the one that had been iterated.

## Which direction the merge ran

**The brain was carried into the face, not the other way round.** The face was the part that had been argued over screen by screen and was already right; the brain was three self-contained pieces of logic that port cleanly into plain JavaScript. Moving three algorithms is a smaller and more checkable job than recomposing a React app screen by screen, and it does not put the working layout at risk.

So `index.html` is `legacy/walker.html` with the brain replaced. Every ported block is marked `NOW-V1` in the file and can be diffed against its source here.

## What was ported, and from where

| In `index.html` | Ported from | What it replaced |
|---|---|---|
| `PHYSICAL_VERBS`, `scoreItem()`, `pickFirst()` | `engine/src/lib/first.ts` (itself a port of `joeos-core/ops.py`) | oldest-first. Same 32 verbs in the same order, `10 − rank × 0.1` for a leading verb, `max(0, cap − words)` with cap 14 (8 under State B), `−4` for a question, `0.0001 × days` as the age tie-break. |
| `chipFor()` and its `isNum/lowv/highv/isTripped` helpers | `engine/src/lib/state.ts` (`computeState`) | the average-of-six R/L/F/H chip. Now the live v5.1 matrix: **C** Redline · **A** High drive, low control · **B** Low battery · **!** Tripwire · **D** Full house, thin buffer · **E** Flow · **F** Steady · **—** Incomplete, tested in the same order. |
| `LANES`, `laneStreak()`, `toggleLane()`, `renderLanes()` | `engine/src/lib/lanes.ts` | nothing — new. Skip-days are stepped over, never counted against a streak; today untouched does not break one. |
| `minutesToCutoff()`, `syncCutoff()` | `engine/src/lib/clock.ts` | nothing — new. The 02:00 lamp appears only from 23:00, amber at 90 minutes, red at 30. |
| `createRawOnDrive()`, the GIS token client | `engine/src/lib/door.ts`, `engine/src/lib/google.ts` | a connector-only door. Drive v3 multipart with the same boundary shape, the same `fields=id,name,size`, the same size readback. |
| Export / import of the store | nothing — new | Each copy keeps its own store, so the only honest way to move one is to hand you the file. |

## Why the matrix and not the mean

The old chip averaged whatever vectors were set. Energy 1 and control 1 with four good numbers averaged to something comfortable, and the app carried on asking things of you. The matrix tests `energy ≤ 2 || control ≤ 2` as a tripwire in its own right, before any averaging, and it tests harmony-and-control together for Redline. A mean cannot see either. This is the single biggest behavioural difference between the old app and this one, and it is the one worth checking first.

## What was left behind

- **The React codebase, its tests and CI.** Real losses. `engine/` is here so nothing is lost from the record, and so the port can be diffed against its source, but the app that ships is one file.
- **The Capacitor shells** (`android/`, `ios/`). Not in this repo; a home-screen install covers the need.
- **`iris.ts`'s hero card.** It reads a brain over HTTP from `joeos-core`'s local server. A phone cannot reach that, so it is unported rather than faked.
- **`ledger.ts`'s Sheet writes.** Retired by ruling before this work — no app writes the sheet; the store does, and a separate pipe carries store to sheet.
- **`sample`** — the ask-Claude route behind STUCK's two buttons. It exists only inside Claude's artifact runtime, so on this hosted copy those two buttons are inert. The only capability with no substitute.

## What is redacted

`engine/src/lib/ids.ts` in this repo is a placeholder file. The real one holds a Google Sheet id, an Apps Script web-app deployment id, two Drive folder ids, a file id and an account hint. Two of those are irreplaceable and one is effectively an endpoint. `legacy/walker.html` had one of the same folder ids inline; it is redacted the same way.

Both files are otherwise byte-for-byte as they were. `engine/` will type-check and build with the placeholders in place; it will not reach anything live until the real values are restored locally. **`index.html` — the app that actually ships — never had any of them:** it asks for a door URL and a door key on the device, under STUCK → Raw door, and keeps them there.

## What is still unreconciled

- The two live copies of NOW — this one and the artifact one — **have separate stores.** Export and import move records between them; nothing syncs.
- The five checks from the ruling have not been run against this app: a dump that reads back to the right byte count, a card tap that writes a decision, a floor log of numbers only, an install that survives reload with the store intact, and the Python brain and this app agreeing on the same NEXT for the same store. Until they pass, this is not the daily driver.
