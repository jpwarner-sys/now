const TZ = "America/Toronto";

function parts(d = new Date()) {
  const bag: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(d)
    .forEach((p) => {
      bag[p.type] = p.value;
    });
  return bag;
}

export function torontoHour(d = new Date()): number {
  const h = Number(parts(d).hour);
  return Number.isFinite(h) ? h % 24 : 12;
}

/** 02:00–05:59 America/Toronto. No Drive / Sheet writes. */
export function isDarkHours(d = new Date()): boolean {
  const h = torontoHour(d);
  return h >= 2 && h < 6;
}

export function etDateTime(d = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function etToday(d = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Code.gs raw_* stamp is UTC compact: YYYY-MM-DDTHHMMSS */
export function utcStampCompact(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}${min}${s}`;
}

export function etClock(d = new Date()): string {
  const p = parts(d);
  return `${p.hour}:${p.minute}`;
}

/**
 * Hard rule: 02:00 ET sleep cutoff. From 23:00 the header shows a lamp for it
 * (Joe's ruling: a lamp that is green all evening is chrome). Minutes remaining, or null.
 */
export function minutesToCutoff(d = new Date()): number | null {
  const p = parts(d);
  const h = Number(p.hour);
  const m = Number(p.minute);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h >= 23) return (24 - h + 2) * 60 - m;
  if (h < 2) return (2 - h) * 60 - m;
  return null;
}

export function utcIsoZ(d = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
