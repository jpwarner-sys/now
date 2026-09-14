/**
 * Iris layer, face side. Pure TS mirror of joeos-core/src/joeos/iris.py.
 * CONTRACT: spec/iris_hero_v1.md (binding on brain and face). No I/O, no sheet ids.
 */
import { torontoHour } from "./clock";
import type { VecKey } from "./state";

export const HERO_SCHEMA = "iris.hero/v1";
export const STALE_HOURS = 16;

export const MISSING_CAPACITY = "[MISSING: CAPACITY FEED]";
export const MISSING_NEXT = "[MISSING: NEXT FEED]";
export const MISSING_EVIDENCE = "[MISSING: EVIDENCE FEED]";

export type ModeBand = "ok" | "thin" | "floor_fail";
export type Tone = "good" | "warn" | "bad" | "muted";
export type HeroSource = "demo" | "csv" | "sheet";
export type MissingFeed = "CAPACITY FEED" | "NEXT FEED" | "EVIDENCE FEED";

export type HeroCapacity = {
  state: { code: string; name: string; line: string; tone: Tone };
  /** null = ABSENT, never 0 */
  axes: Record<VecKey, number | null>;
  /** ET wall time as written by the app, "YYYY-MM-DD HH:MM" */
  logged_at: string;
  age_hours: number;
  stale: boolean;
  tripwire: boolean;
};

export type HeroMode = { band: ModeBand; reason: string };
export type HeroWriteGate = { open: boolean; reason: "day" | "dark 02–05" | "first light 06:00" };
export type HeroNext = { action_text: string; reason: string; capture_id: string | null };
export type HeroEvidence = {
  checks_7d: number;
  tripwires_7d: number;
  states_7d: Record<string, number>;
  last_check: string | null;
  lanes: Record<string, number>;
};

export type HeroLines = { CAPACITY: string; MODE: string; NEXT: string; EVIDENCE: string };

export type HeroPayload = {
  schema: typeof HERO_SCHEMA;
  as_of: string;
  source: HeroSource;
  missing: MissingFeed[];
  capacity: HeroCapacity | null;
  mode: HeroMode;
  write_gate: HeroWriteGate;
  next: HeroNext | null;
  evidence: HeroEvidence | null;
  hero: HeroLines;
};

/** Older than 16h is STALE. Exactly 16h is not. */
export function isStale(ageHours: number): boolean {
  return ageHours > STALE_HOURS;
}

/** What mode_of needs: the subset of the capacity feed the rule reads. */
export type ModeInput = { state: { code: string }; age_hours: number; stale: boolean; tripwire: boolean };

/**
 * Mode rule S1-D, in the spec's order. First match wins. Same reasons as iris.py.
 *   floor_fail  capacity present and (tripwire or state C)
 *   thin        capacity missing, stale, state in {A, B, D, !}, or incomplete (—)
 *   ok          otherwise (E, F)
 */
export function modeOf(capacity: ModeInput | null | undefined): HeroMode {
  if (!capacity) return { band: "thin", reason: "capacity missing" };
  const code = capacity.state.code;
  if (capacity.tripwire) return { band: "floor_fail", reason: "tripwire: energy<=2 or control<=2" };
  if (code === "C") return { band: "floor_fail", reason: "state C" };
  if (capacity.stale) return { band: "thin", reason: `stale (${capacity.age_hours}h > 16h)` };
  if (code === "A" || code === "B" || code === "D" || code === "!") return { band: "thin", reason: `state ${code}` };
  if (code === "—") return { band: "thin", reason: "incomplete check" };
  return { band: "ok", reason: `${code} and fresh` };
}

/** 02:00–05:59 ET the surface is closed (only PARK may leave). 06:00 is first light. */
export function writeGate(d: Date = new Date()): HeroWriteGate {
  const h = torontoHour(d);
  if (h >= 2 && h < 6) return { open: false, reason: "dark 02–05" };
  if (h === 6) return { open: true, reason: "first light 06:00" };
  return { open: true, reason: "day" };
}

export function isMissingLine(s: string): boolean {
  return s.startsWith("[MISSING:");
}

export function toneVar(tone: Tone | undefined): string {
  switch (tone) {
    case "good":
      return "var(--good)";
    case "warn":
      return "var(--warn)";
    case "bad":
      return "var(--bad)";
    default:
      return "var(--ink3)";
  }
}
