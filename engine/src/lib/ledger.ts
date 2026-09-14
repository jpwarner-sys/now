/**
 * Ledger = the walker_v0 store. No Sheet. No app writes the Sheet.
 * A start is the ONE place prose lives (items). Everything else is ids, numbers, booleans, stamps.
 */
import { mintId } from "./hash";
import { etToday } from "./clock";
import { dropRaw, type DropResult } from "./door";
import type { LaneKey } from "./lanes";
import { logMeta } from "./log";
import type { Vector } from "./state";
import { nowIso, openStore, type CounterDoc, type FloorDoc, type ItemDoc, type LaneDoc } from "./walker";

export const TIMER_MS = 8 * 60_000;

function words(t: string): number {
  return (t.match(/\S+/g) || []).length;
}

/** Dump = raw door only. Nothing lands in the store but a receipt. */
export function dump(text: string): Promise<DropResult> {
  return dropRaw(text);
}

/** Start = raw door AND an items doc with the text. Timer runs 8 min from now. */
export async function startItem(text: string): Promise<{ item: ItemDoc; door: DropResult }> {
  const trimmed = text.trim();
  const at = nowIso();
  const item: ItemDoc = {
    id: mintId(),
    text: trimmed,
    at,
    state: "started",
    words: words(trimmed),
    parent: null,
    started_at: at,
    timer_end: new Date(Date.parse(at) + TIMER_MS).toISOString(),
  };
  const store = await openStore();
  await store.set("items", item.id, item);
  logMeta("item.start", { id: item.id, words: item.words });
  const door = await dropRaw(trimmed);
  return { item, door };
}

/** Restart a parked item: fresh 8 min. */
export async function resumeItem(id: string): Promise<void> {
  const store = await openStore();
  const cur = (await store.list("items")).find((x) => x.id === id);
  if (!cur) return;
  const at = nowIso();
  await store.set("items", id, { ...cur, state: "started", started_at: at, timer_end: new Date(Date.parse(at) + TIMER_MS).toISOString() });
  logMeta("item.resume", { id });
}

export async function parkItem(id: string): Promise<void> {
  const store = await openStore();
  const cur = (await store.list("items")).find((x) => x.id === id);
  if (!cur) return;
  await store.set("items", id, { ...cur, state: "parked" });
  logMeta("item.park", { id });
}

/** Done = the items doc goes away; the day's counter goes up. */
export async function doneItem(id: string, day = etToday()): Promise<CounterDoc> {
  const store = await openStore();
  await store.del("items", id);
  const cur = (await store.list("counters")).find((c) => c.id === day);
  const next: CounterDoc = { id: day, day, done: (cur?.done ?? 0) + 1 };
  await store.set("counters", day, next);
  logMeta("item.done", { id, day, done: next.done });
  return next;
}

/** Floor = numbers only. */
export async function logFloor(vec: Vector): Promise<FloorDoc> {
  const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  const doc: FloorDoc = {
    id: mintId(),
    at: nowIso(),
    v: {
      family: num(vec.family),
      energy: num(vec.energy),
      recharge: num(vec.recharge),
      balance: num(vec.balance),
      harmony: num(vec.harmony),
      control: num(vec.control),
    },
  };
  const store = await openStore();
  await store.set("floor", doc.id, doc);
  logMeta("floor.logged", { id: doc.id });
  return doc;
}

/** Lanes = one doc per ET day, four booleans. Tick toggles. */
export async function tickLane(key: LaneKey, day = etToday()): Promise<LaneDoc> {
  const store = await openStore();
  const cur = (await store.list("lanes")).find((l) => l.id === day);
  const next: LaneDoc = {
    id: day,
    day,
    school: !!cur?.school,
    lunches: !!cur?.lunches,
    laundry: !!cur?.laundry,
    cooking: !!cur?.cooking,
    at: nowIso(),
  };
  next[key] = !next[key];
  await store.set("lanes", day, next);
  logMeta("lane.toggle", { key, day, on: next[key] });
  return next;
}
