import { Preferences } from "@capacitor/preferences";
import type { FloorState } from "./state";

/** Last logged floor state, kept on device so the header chip means something between checks. */
/** at = ISO instant (for freshness math); atLabel = ET "YYYY-MM-DD HH:MM" for display */
export type FloorMemo = { code: string; name: string; color: string; at: string; atLabel: string };

const KEY = "joeos.now.lastFloor.v1";

export async function readFloorMemo(): Promise<FloorMemo | null> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return null;
    const m = JSON.parse(value) as FloorMemo;
    return m && typeof m.code === "string" ? m : null;
  } catch {
    return null;
  }
}

export async function writeFloorMemo(st: FloorState, atLabel: string): Promise<FloorMemo> {
  const memo: FloorMemo = { code: st.code, name: st.name, color: st.color, at: new Date().toISOString(), atLabel };
  await Preferences.set({ key: KEY, value: JSON.stringify(memo) });
  return memo;
}

/** Older than 16h reads as stale: chip goes neutral, name says so. */
export function memoIsFresh(m: FloorMemo | null, now = Date.now()): boolean {
  if (!m) return false;
  const t = Date.parse(m.at);
  return Number.isFinite(t) && now - t < 16 * 3_600_000;
}
