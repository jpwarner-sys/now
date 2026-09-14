/** Ids and statuses only. Never dump bodies. */
export function logMeta(event: string, meta: Record<string, string | number | boolean | null | undefined>): void {
  console.info(`[now] ${event}`, meta);
}
