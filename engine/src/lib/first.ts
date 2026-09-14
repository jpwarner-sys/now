/**
 * FIRST: one next physical action. Pure TS port of joeos-core/src/joeos/ops.py (score + next_physical_action).
 * Same verb list, same weights, same clip. Asserted against joeos-core/contract/first_vectors.json.
 */
import { isTripped, type FloorState, type Vector } from "./state";

export const STOP_LINE = "Stop. Protect the floor.";

export const PHYSICAL_VERBS = [
  "call", "text", "email", "send", "book", "confirm", "pick up", "pickup", "drop", "buy", "pay",
  "print", "sign", "fill", "pack", "wash", "fold", "cook", "prep", "put", "move", "clean", "open",
  "write", "read", "check", "fix", "reply", "walk", "drive", "order", "cancel", "schedule",
] as const;

export type Capture = {
  id: string;
  text: string;
  status: string;
  /** "YYYY-MM-DD HH:MM" (ET wall clock, naive) or null */
  at: string | null;
};

export type Ops = {
  action_text: string;
  reason: string;
  capture_id: string | null;
  state_code: string | null;
};

function words(t: string): number {
  return (t.match(/\S+/g) || []).length;
}

/** naive "YYYY-MM-DD HH:MM" -> UTC ms (same arithmetic as a naive python datetime) */
function naiveMs(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
}

const Y2030 = Date.UTC(2030, 0, 1);

export function openCaptures(caps: Capture[]): Capture[] {
  return caps.filter((c) => c.status !== "done" && c.status !== "dropped" && c.status !== "parked");
}

export function score(c: Capture, state: FloorState | null): number {
  const t = c.text.toLowerCase().trim();
  const n = words(t);
  if (n === 0) return -1e9;
  let s = 0;
  const cap = state && state.code === "B" ? 8 : 14;
  s += Math.max(0, cap - n);
  for (let rank = 0; rank < PHYSICAL_VERBS.length; rank++) {
    const v = PHYSICAL_VERBS[rank];
    if (t.startsWith(v + " ") || t === v) {
      s += 10 - rank * 0.1;
      break;
    }
  }
  const at = naiveMs(c.at);
  if (at != null) s += 0.0001 * Math.max(0, Math.floor((Y2030 - at) / 86_400_000));
  if (t.includes("?")) s -= 4;
  return s;
}

/** `hour` = ET wall-clock hour of "now" (0-23). */
export function nextPhysicalAction(caps: Capture[], vec: Vector | null, state: FloorState | null, hour: number): Ops {
  const afterCutoff = hour < 6 && hour >= 2;
  const mayStop = afterCutoff || (vec != null && isTripped(vec));
  const code = state ? state.code : null;
  if (state && state.code === "C" && mayStop) return { action_text: STOP_LINE, reason: "State C with a live tripwire.", capture_id: null, state_code: "C" };
  if (afterCutoff) return { action_text: STOP_LINE, reason: "After the 02:00 cutoff.", capture_id: null, state_code: code };
  const pool = openCaptures(caps);
  if (!pool.length) return { action_text: "Nothing parked. Dump one thing.", reason: "Empty Captures.", capture_id: null, state_code: code };
  let best = pool[0];
  let bestScore = score(best, state);
  for (let i = 1; i < pool.length; i++) {
    const sc = score(pool[i], state);
    if (sc > bestScore) {
      best = pool[i];
      bestScore = sc;
    }
  }
  const n = words(best.text);
  const text = n <= 14 ? best.text : best.text.split(/\s+/).filter(Boolean).slice(0, 14).join(" ") + "…";
  const why = n <= (state && state.code === "B" ? 8 : 14) ? "shortest verb-first open capture" : "oldest open capture";
  return { action_text: text, reason: why, capture_id: best.id, state_code: code };
}
