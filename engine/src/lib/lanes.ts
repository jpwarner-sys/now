import { Preferences } from "@capacitor/preferences";
import { etToday } from "./clock";
import { logMeta } from "./log";

/**
 * L's lanes. The four things she actually wants off her plate.
 * Tokenized: "L" only. Never a real name. Local-first; no Sheet write yet.
 */
export const LANES = [
  { key: "school", label: "School run", hint: "Kids to school", when: "AM", skipDays: [0, 6] },
  { key: "lunches", label: "Lunches", hint: "Packed the night before", when: "PM", skipDays: [5, 6] },
  { key: "laundry", label: "Laundry", hint: "Stains treated, loads moved", when: "ANY", skipDays: [] },
  { key: "cooking", label: "Cooking", hint: "A real meal on the table", when: "PM", skipDays: [] },
] as const;

export type LaneKey = (typeof LANES)[number]["key"];
export type LaneDay = Partial<Record<LaneKey, true>>;
/** yyyy-mm-dd (ET) -> lanes ticked that day */
export type LaneLog = Record<string, LaneDay>;

const KEY = "joeos.now.lanes.v1";

export async function readLanes(): Promise<LaneLog> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return {};
    const parsed = JSON.parse(value) as LaneLog;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function toggleLane(key: LaneKey, day = etToday()): Promise<LaneLog> {
  const log = await readLanes();
  const d: LaneDay = { ...(log[day] || {}) };
  if (d[key]) delete d[key];
  else d[key] = true;
  if (Object.keys(d).length) log[day] = d;
  else delete log[day];
  await Preferences.set({ key: KEY, value: JSON.stringify(log) });
  logMeta("lane.toggle", { key, day, on: !!d[key] });
  return log;
}

function shiftDay(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const n = new Date(t);
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`;
}

function dow(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Consecutive days the lane was ticked, counting back from today.
 * Today untouched does not break the streak (you haven't failed yet).
 * Skip-days (weekends for school, Fri/Sat for lunches) are stepped over, never counted.
 */
export function laneStreak(log: LaneLog, key: LaneKey, today = etToday()): number {
  const lane = LANES.find((l) => l.key === key);
  const skip = new Set<number>(lane ? lane.skipDays : []);
  let day = today;
  let n = 0;
  let first = true;
  for (let guard = 0; guard < 400; guard++) {
    if (skip.has(dow(day))) {
      day = shiftDay(day, -1);
      continue;
    }
    const on = !!log[day]?.[key];
    if (on) n++;
    else if (!first) break;
    first = false;
    day = shiftDay(day, -1);
  }
  return n;
}

export function lanesDoneToday(log: LaneLog, today = etToday()): number {
  return Object.keys(log[today] || {}).length;
}
