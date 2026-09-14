/**
 * Brain link: reads iris.hero/v1 from the local joeos-core server.
 * Never throws. Any failure -> null (the face then renders nothing: sitting rule).
 * Log ids/statuses only — never a body.
 */
import { isDarkHours } from "./clock";
import { logMeta } from "./log";
import { HERO_SCHEMA, type HeroPayload } from "./iris";

export const BRAIN_URL = "http://localhost:8787/api/hero";
const TIMEOUT_MS = 1200;

function isHero(x: unknown): x is HeroPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.schema !== HERO_SCHEMA) return false;
  const hero = o.hero as Record<string, unknown> | null | undefined;
  if (!hero || typeof hero !== "object") return false;
  for (const k of ["CAPACITY", "MODE", "NEXT", "EVIDENCE"]) {
    if (typeof hero[k] !== "string") return false;
  }
  return typeof o.as_of === "string" && typeof o.source === "string" && !!o.mode && !!o.write_gate;
}

export async function fetchHero(): Promise<HeroPayload | null> {
  if (isDarkHours()) return null;
  if (typeof fetch !== "function") return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(BRAIN_URL, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) {
      logMeta("hero.fetch", { status: r.status, ok: false });
      return null;
    }
    const body: unknown = await r.json();
    if (!isHero(body)) {
      logMeta("hero.fetch", { status: r.status, ok: false, reason: "schema" });
      return null;
    }
    logMeta("hero.fetch", { status: r.status, ok: true, source: body.source, band: body.mode.band, missing: body.missing.length });
    return body;
  } catch {
    logMeta("hero.fetch", { ok: false, reason: ctl.signal.aborted ? "timeout" : "error" });
    return null;
  } finally {
    clearTimeout(t);
  }
}
