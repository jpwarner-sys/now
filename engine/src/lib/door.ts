/**
 * The raw door. One RAW_SHAPE_v1 file into the feeds folder, then a size readback and a receipt.
 * Transports, in order: (a) artifact mcp "Google Drive" create_file, (b) OAuth Drive multipart (localhost dev).
 * Dark window 02:00–05:59 ET: no door call, hold on the phone (R-068). No door: hold, QUEUED.
 * The text NEVER enters the store, a receipt, or logMeta.
 */
import { mintId } from "./hash";
import { isDarkHours } from "./clock";
import { accessToken, gfetch } from "./google";
import { LIVE } from "./ids";
import { logMeta } from "./log";
import { buildRawFile } from "./raw";
import { holdDump, nowIso, openStore, type Readback, type ReceiptDoc } from "./walker";

export type DoorTransport = "mcp" | "oauth" | "none";
export type DropResult = { ok: true; receipt: ReceiptDoc } | { ok: false; reason: "QUEUED" | "DARK_WINDOW" };

type Created = { id: string; fileSize: number };

let lastTransport: DoorTransport = "none";

/** Last transport the door actually resolved. Display only. */
export function doorTransport(): DoorTransport {
  return lastTransport;
}

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

async function mcpClient(): Promise<any | null> {
  try {
    const use = window.claude?.use;
    if (typeof use !== "function") return null;
    const mcp = await window.claude!.use("mcp");
    return mcp && typeof mcp.callTool === "function" ? mcp : null;
  } catch {
    return null;
  }
}

/** Which door would answer right now. Never throws. */
export async function detectTransport(): Promise<DoorTransport> {
  if (await mcpClient()) lastTransport = "mcp";
  else if (accessToken()) lastTransport = "oauth";
  else lastTransport = "none";
  return lastTransport;
}

function parseCreated(r: any): Created {
  let payload: any = r?.payload;
  if (!payload && Array.isArray(r?.content) && r.content[0]?.text) payload = JSON.parse(r.content[0].text);
  if (!payload && r?.id) payload = r;
  const id = String(payload?.id || "");
  if (!id) throw new Error("DOOR_NO_ID");
  const size = parseInt(String(payload?.fileSize ?? payload?.size ?? "-1"), 10);
  return { id, fileSize: Number.isFinite(size) ? size : -1 };
}

async function createViaMcp(mcp: any, name: string, body: string): Promise<Created> {
  const r = await mcp.callTool(
    "Google Drive",
    "create_file",
    {
      title: name,
      parentId: LIVE.feedsFolder,
      contentMimeType: "text/plain",
      disableConversionToGoogleType: true,
      textContent: body,
    },
    { cache: false },
  );
  return parseCreated(r);
}

/** OAuth path (localhost dev). Kept from the old ledger; asks Drive for the stored size. */
export async function createRawOnDrive(name: string, body: string): Promise<Created> {
  const meta = {
    name,
    parents: [LIVE.feedsFolder],
    mimeType: "text/plain",
  };
  const boundary = "nowshell_" + mintId();
  const payload =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n` +
    `--${boundary}--`;
  const res = await gfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: payload,
  });
  if (!res.ok) throw new Error(`DRIVE_${res.status}`);
  const j = (await res.json()) as { id?: string; name?: string; size?: string };
  if (!j.id) throw new Error("DRIVE_NO_ID");
  logMeta("drive.raw", { id: j.id, name: j.name || name });
  return parseCreated({ payload: { id: j.id, fileSize: j.size ?? "-1" } });
}

/** Drop one raw. Held on the phone when no door answers. Returns the receipt, never the text. */
export async function dropRaw(text: string): Promise<DropResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "QUEUED" };
  if (isDarkHours()) {
    holdDump(trimmed);
    logMeta("door.dark", { held: true });
    return { ok: false, reason: "DARK_WINDOW" };
  }
  const id = mintId();
  const raw = await buildRawFile(trimmed, id);
  const mcp = await mcpClient();
  let created: Created | null = null;
  try {
    if (mcp) {
      lastTransport = "mcp";
      created = await createViaMcp(mcp, raw.name, raw.body);
    } else if (accessToken()) {
      lastTransport = "oauth";
      created = await createRawOnDrive(raw.name, raw.body);
    } else {
      lastTransport = "none";
    }
  } catch (err) {
    logMeta("door.fail", { transport: lastTransport, reason: err instanceof Error ? err.message : "error" });
    created = null;
  }
  if (!created) {
    holdDump(trimmed);
    return { ok: false, reason: "QUEUED" };
  }
  const bodyBytes = utf8ByteLength(raw.body);
  const readback: Readback = created.fileSize === bodyBytes ? "ok" : "size mismatch";
  const receipt: ReceiptDoc = {
    id: raw.name.replace(/\.md$/, ""),
    at: nowIso(),
    name: raw.name,
    bytes: raw.bytes,
    sha: raw.sha256,
    file_bytes: created.fileSize,
    file_id: created.id,
    readback,
  };
  const store = await openStore();
  await store.set("receipts", receipt.id, receipt);
  logMeta("door.receipt", { id: receipt.id, file_id: receipt.file_id, readback, transport: lastTransport });
  return { ok: true, receipt };
}
