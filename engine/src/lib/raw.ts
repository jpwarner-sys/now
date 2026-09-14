import { ORIGIN_SURFACE } from "./ids";
import { utcIsoZ, utcStampCompact } from "./clock";
import { sha256Hex } from "./hash";

export const RAW_NAME_RE = /^raw_\d{4}-\d{2}-\d{2}T\d{6}_[A-Za-z0-9._-]+\.md$/;
export const RAW_MAX_BYTES = 8000;

export function rawFileName(id: string, at = new Date()): string {
  return `raw_${utcStampCompact(at)}_${id}.md`;
}

export async function buildRawFile(
  text: string,
  id: string,
  at = new Date(),
): Promise<{ name: string; body: string; sha256: string; bytes: number; truncated: boolean }> {
  const trimmed = text.trim();
  const truncated = trimmed.length > RAW_MAX_BYTES;
  const capture = truncated ? trimmed.slice(0, RAW_MAX_BYTES) : trimmed;
  const sha256 = await sha256Hex(capture);
  const body = [
    "---",
    'schema: "lab.intake.raw/v1"',
    `as_of: "${utcIsoZ(at)}"`,
    `source_hash: "${sha256}"`,
    `bytes: ${capture.length}`,
    'sanitizer: "STEWARD"',
    'vessel_read_restriction: "STEWARD only (R-050)"',
    `origin_surface: "${ORIGIN_SURFACE}"`,
    `truncated: ${truncated}`,
    "---",
    capture,
    "",
  ].join("\n");
  return { name: rawFileName(id, at), body, sha256, bytes: capture.length, truncated };
}
