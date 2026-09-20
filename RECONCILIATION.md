# Reconciliation — how Walker and joe-os-now became NOW

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
