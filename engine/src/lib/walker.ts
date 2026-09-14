/**
 * Store adapter (walker_v0 contract). Seven collections, two backends behind one factory.
 * ArtifactStore = window.claude.use("db") with a write-through local mirror; LocalStore = localStorage "walker.v0".
 * Prose lives in `items` only (a start). Receipts / counters / floor / lanes carry no text. Log ids only.
 */
import { logMeta } from "./log";

export type Kind = "items" | "cards" | "decisions" | "floor" | "receipts" | "counters" | "lanes";
export const KINDS: Kind[] = ["items", "cards", "decisions", "floor", "receipts", "counters", "lanes"];

export type ItemState = "started" | "parked";
export type ItemDoc = {
  id: string;
  text: string;
  at: string;
  state: ItemState;
  words: number;
  parent: string | null;
  started_at: string;
  timer_end: string;
};
export type CardDoc = { id: string; at: string; kind: string; ref: string | null };
export type DecisionDoc = { id: string; at: string; choice: string; ref: string | null };
export type FloorVec = {
  family: number | null;
  energy: number | null;
  recharge: number | null;
  balance: number | null;
  harmony: number | null;
  control: number | null;
};
export type FloorDoc = { id: string; at: string; v: FloorVec };
export type Readback = "ok" | "size mismatch";
export type ReceiptDoc = {
  id: string;
  at: string;
  name: string;
  bytes: number;
  sha: string;
  file_bytes: number;
  file_id: string;
  readback: Readback;
};
export type CounterDoc = { id: string; day: string; done: number };
export type LaneDoc = {
  id: string;
  day: string;
  school: boolean;
  lunches: boolean;
  laundry: boolean;
  cooking: boolean;
  at: string;
};

export type DocOf = {
  items: ItemDoc;
  cards: CardDoc;
  decisions: DecisionDoc;
  floor: FloorDoc;
  receipts: ReceiptDoc;
  counters: CounterDoc;
  lanes: LaneDoc;
};
export type Doc = DocOf[Kind];

export type StoreKind = "artifact" | "local";

export interface WalkerStore {
  kind: StoreKind;
  set<K extends Kind>(kind: K, id: string, doc: DocOf[K]): Promise<void>;
  del(kind: Kind, id: string): Promise<void>;
  list<K extends Kind>(kind: K): Promise<DocOf[K][]>;
  subscribe<K extends Kind>(kind: K, cb: (docs: DocOf[K][]) => void): () => void;
}

export const MIRROR_KEY = "walker.v0";
export const HELD_KEY = "walker.held";

export function nowIso(): string {
  return new Date().toISOString();
}

// ---------- local mirror (localStorage, guarded, in-memory fallback) ----------

type Mirror = Record<Kind, Record<string, Doc>>;

function emptyMirror(): Mirror {
  return { items: {}, cards: {}, decisions: {}, floor: {}, receipts: {}, counters: {}, lanes: {} };
}

let memMirror: Mirror | null = null;

function readMirror(): Mirror {
  const m = emptyMirror();
  let parsed: unknown = null;
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed && memMirror) return memMirror;
  if (parsed && typeof parsed === "object") {
    const bag = parsed as Record<string, unknown>;
    for (const k of KINDS) {
      const v = bag[k];
      if (Array.isArray(v)) {
        for (const d of v) if (d && typeof d === "object" && typeof (d as Doc).id === "string") m[k][(d as Doc).id] = d as Doc;
      } else if (v && typeof v === "object") {
        for (const [id, d] of Object.entries(v as Record<string, unknown>)) {
          if (d && typeof d === "object") m[k][id] = { ...(d as Doc), id } as Doc;
        }
      }
    }
  }
  memMirror = m;
  return m;
}

function writeMirror(m: Mirror): void {
  memMirror = m;
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(m));
  } catch {
    /* in-memory only */
  }
}

function mirrorList<K extends Kind>(kind: K): DocOf[K][] {
  return Object.values(readMirror()[kind]) as DocOf[K][];
}

function mirrorSet(kind: Kind, id: string, doc: Doc): void {
  const m = readMirror();
  m[kind][id] = { ...doc, id };
  writeMirror(m);
}

function mirrorDel(kind: Kind, id: string): void {
  const m = readMirror();
  delete m[kind][id];
  writeMirror(m);
}

function mirrorReplace(kind: Kind, docs: Doc[]): void {
  const m = readMirror();
  const next: Record<string, Doc> = {};
  for (const d of docs) next[d.id] = d;
  m[kind] = next;
  writeMirror(m);
}

// ---------- listeners ----------

type Cb = (docs: Doc[]) => void;

class Bus {
  private subs: Record<Kind, Set<Cb>> = {
    items: new Set(),
    cards: new Set(),
    decisions: new Set(),
    floor: new Set(),
    receipts: new Set(),
    counters: new Set(),
    lanes: new Set(),
  };
  on(kind: Kind, cb: Cb): () => void {
    this.subs[kind].add(cb);
    return () => {
      this.subs[kind].delete(cb);
    };
  }
  emit(kind: Kind, docs: Doc[]): void {
    for (const cb of Array.from(this.subs[kind])) {
      try {
        cb(docs);
      } catch {
        /* a listener never breaks the store */
      }
    }
  }
}

// ---------- LocalStore ----------

class LocalStore implements WalkerStore {
  kind: StoreKind = "local";
  private bus = new Bus();

  async set<K extends Kind>(kind: K, id: string, doc: DocOf[K]): Promise<void> {
    mirrorSet(kind, id, doc);
    this.bus.emit(kind, mirrorList(kind));
  }
  async del(kind: Kind, id: string): Promise<void> {
    mirrorDel(kind, id);
    this.bus.emit(kind, mirrorList(kind));
  }
  async list<K extends Kind>(kind: K): Promise<DocOf[K][]> {
    return mirrorList(kind);
  }
  subscribe<K extends Kind>(kind: K, cb: (docs: DocOf[K][]) => void): () => void {
    const off = this.bus.on(kind, cb as Cb);
    cb(mirrorList(kind));
    return off;
  }
}

// ---------- ArtifactStore ----------

class ArtifactStore implements WalkerStore {
  kind: StoreKind = "artifact";
  private bus = new Bus();
  private db: any;
  private live: Partial<Record<Kind, Doc[]>> = {};
  private firstSnap: Partial<Record<Kind, boolean>> = {};
  private listening: Partial<Record<Kind, boolean>> = {};

  constructor(db: any) {
    this.db = db;
  }

  private col(kind: Kind): any {
    return this.db.collection(kind);
  }

  private listen(kind: Kind): void {
    if (this.listening[kind]) return;
    this.listening[kind] = true;
    try {
      this.col(kind).onSnapshot(
        (snap: any) => {
          const docs: Doc[] = (snap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data ? d.data() : {}) }));
          const remote = new Set(docs.map((d) => d.id));
          if (!this.firstSnap[kind]) {
            this.firstSnap[kind] = true;
            // offline reconcile: anything the mirror has that the store lacks goes up.
            const mirror = mirrorList(kind) as Doc[];
            let pushed = 0;
            for (const d of mirror) {
              if (remote.has(d.id)) continue;
              pushed++;
              docs.push(d);
              this.col(kind)
                .doc(d.id)
                .set({ ...d, id: d.id })
                .catch(() => logMeta("store.reconcile.fail", { kind, id: d.id }));
            }
            if (pushed) logMeta("store.reconcile", { kind, pushed });
          }
          this.live[kind] = docs;
          mirrorReplace(kind, docs);
          this.bus.emit(kind, docs);
        },
        (err: any) => {
          logMeta("store.snapshot.err", { kind, reason: err && err.message ? String(err.message) : "error" });
        },
      );
    } catch (err) {
      logMeta("store.listen.fail", { kind, reason: err instanceof Error ? err.message : "error" });
    }
  }

  async set<K extends Kind>(kind: K, id: string, doc: DocOf[K]): Promise<void> {
    const whole = { ...doc, id };
    mirrorSet(kind, id, whole);
    this.bus.emit(kind, mirrorList(kind));
    try {
      await this.col(kind).doc(id).set(whole);
    } catch (err) {
      logMeta("store.set.fail", { kind, id, reason: err instanceof Error ? err.message : "error" });
    }
  }

  async del(kind: Kind, id: string): Promise<void> {
    mirrorDel(kind, id);
    this.bus.emit(kind, mirrorList(kind));
    try {
      await this.col(kind).doc(id).delete();
    } catch (err) {
      logMeta("store.del.fail", { kind, id, reason: err instanceof Error ? err.message : "error" });
    }
  }

  async list<K extends Kind>(kind: K): Promise<DocOf[K][]> {
    this.listen(kind);
    return (this.live[kind] as DocOf[K][] | undefined) ?? mirrorList(kind);
  }

  subscribe<K extends Kind>(kind: K, cb: (docs: DocOf[K][]) => void): () => void {
    const off = this.bus.on(kind, cb as Cb);
    cb(((this.live[kind] as DocOf[K][] | undefined) ?? mirrorList(kind)) as DocOf[K][]);
    this.listen(kind);
    return off;
  }
}

// ---------- factory ----------

let opened: Promise<WalkerStore> | null = null;

export function openStore(): Promise<WalkerStore> {
  if (opened) return opened;
  opened = (async () => {
    let db: any = null;
    try {
      db = await (window as any).claude?.use?.("db");
    } catch {
      db = null;
    }
    if (db && typeof db.collection === "function") {
      logMeta("store.open", { kind: "artifact" });
      return new ArtifactStore(db);
    }
    logMeta("store.open", { kind: "local" });
    return new LocalStore();
  })();
  return opened;
}

// ---------- held dumps (text stays on this phone until a door answers) ----------

export type Held = { text: string; at: string };

let memHeld: Held[] = [];

export function heldDumps(): Held[] {
  try {
    const raw = localStorage.getItem(HELD_KEY);
    if (!raw) return memHeld;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memHeld = parsed.filter((h) => h && typeof h.text === "string") as Held[];
      return memHeld;
    }
  } catch {
    /* fall through */
  }
  return memHeld;
}

function writeHeld(list: Held[]): void {
  memHeld = list;
  try {
    localStorage.setItem(HELD_KEY, JSON.stringify(list));
  } catch {
    /* in-memory only */
  }
}

export function holdDump(text: string): Held {
  const h: Held = { text, at: nowIso() };
  writeHeld([...heldDumps(), h]);
  logMeta("dump.held", { held: memHeld.length });
  return h;
}

/** Takes every held dump off the phone list and returns them. Caller re-holds what it cannot deliver. */
export function releaseHeld(): Held[] {
  const all = heldDumps();
  writeHeld([]);
  return all;
}
