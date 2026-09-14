export const VECS = [
  { key: "family", label: "Family" },
  { key: "energy", label: "Energy" },
  { key: "recharge", label: "Recharge" },
  { key: "balance", label: "Balance" },
  { key: "harmony", label: "Harmony" },
  { key: "control", label: "Control" },
] as const;

export type VecKey = (typeof VECS)[number]["key"];
export type Vector = Record<VecKey, number | null>;

export type FloorState = {
  code: string;
  name: string;
  line: string;
  color: string;
};

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function lowv(v: number | null | undefined, t: number) {
  return isNum(v) && v <= t;
}
function highv(v: number | null | undefined, t: number) {
  return isNum(v) && v >= t;
}
export function isTripped(c: Vector | null | undefined): boolean {
  return !!c && (lowv(c.energy, 2) || lowv(c.control, 2));
}

/** Live v5.1 matrix. State C is "Redline — stop". Absent never trips. */
export function computeState(c: Vector | null | undefined): FloorState {
  if (!c) return { code: "—", name: "No data", line: "Log a floor check.", color: "var(--ink3)" };
  if (lowv(c.harmony, 2) && lowv(c.control, 2))
    return { code: "C", name: "Redline — stop", line: "Full stop. Zero planning, zero debate. Bedtime.", color: "var(--bad)" };
  if (highv(c.energy, 4) && lowv(c.control, 2))
    return { code: "A", name: "High drive, low control", line: "Solo technical work only. No sensitive conversations.", color: "var(--warn)" };
  if (lowv(c.energy, 2) && highv(c.control, 4))
    return { code: "B", name: "Low battery", line: "Tiny steps under 2 minutes. Rest is productive.", color: "var(--warn)" };
  if (isTripped(c))
    return { code: "!", name: "Tripwire", line: "Floor protection. One tiny step or rest.", color: "var(--bad)" };
  if (highv(c.family, 4) && lowv(c.balance, 2))
    return { code: "D", name: "Full house, thin buffer", line: "Single-action fixes only. Clear one loop at a time.", color: "var(--warn)" };
  if (highv(c.energy, 4) && highv(c.control, 4))
    return { code: "E", name: "Flow", line: "Execution window. Guard the hyperfocus.", color: "var(--good)" };
  if (!isNum(c.energy) || !isNum(c.control) || !isNum(c.harmony) || !isNum(c.family) || !isNum(c.balance))
    return { code: "—", name: "Incomplete check", line: "Some vectors weren't logged. Log a full floor check when you can.", color: "var(--ink3)" };
  return { code: "F", name: "Steady", line: "Normal momentum. One next action at a time.", color: "var(--good)" };
}

export function emptyVector(): Vector {
  return { family: null, energy: null, recharge: null, balance: null, harmony: null, control: null };
}
