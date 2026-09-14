import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { etClock, isDarkHours, minutesToCutoff } from "./clock";
import { detectTransport, dropRaw, type DoorTransport } from "./door";
import { doneItem, dump as dumpRaw, logFloor as logFloorDoc, parkItem, resumeItem, startItem, tickLane as tickLaneDoc } from "./ledger";
import { readLanes as readLocalLanes, type LaneKey, type LaneLog } from "./lanes";
import { readFloorMemo, writeFloorMemo, type FloorMemo } from "./floorMemo";
import type { FloorState, Vector } from "./state";
import { fetchHero } from "./brain";
import type { HeroPayload } from "./iris";
import { heldDumps, holdDump, openStore, releaseHeld, type ItemDoc, type LaneDoc, type StoreKind } from "./walker";

type Toast = { msg: string; at: number };

export type DumpOutcome = "sent" | "QUEUED" | "DARK_WINDOW";

type Store = {
  /** Now list: items in state started|parked, newest first */
  items: ItemDoc[];
  /** dumps held on this phone (text never left the device) */
  held: number;
  storeKind: StoreKind | null;
  transport: DoorTransport;
  toast: string;
  dark: boolean;
  runningId: string | null;
  endsAt: number | null;
  /** ET wall clock, HH:MM, ticks every 15s */
  clock: string;
  /** minutes to the 02:00 cutoff, or null outside 22:00–02:00 */
  cutoffIn: number | null;
  lanes: LaneLog;
  lastFloor: FloorMemo | null;
  /** iris.hero/v1 from the local brain; null = not reachable (render nothing) */
  hero: HeroPayload | null;
  refresh: () => Promise<void>;
  tickLane: (key: LaneKey) => Promise<void>;
  rememberFloor: (st: FloorState, at: string) => Promise<void>;
  dump: (text: string) => Promise<DumpOutcome>;
  start: (text: string) => Promise<DumpOutcome>;
  resume: (id: string) => void;
  park: (id?: string) => void;
  done: (id: string) => Promise<boolean>;
  logFloor: (vec: Vector) => Promise<{ at: string }>;
  showToast: (msg: string) => void;
};

const Ctx = createContext<Store | null>(null);

function lanesFromDocs(docs: LaneDoc[], fallback: LaneLog): LaneLog {
  const log: LaneLog = { ...fallback };
  for (const d of docs) {
    const day: Record<string, true> = {};
    if (d.school) day.school = true;
    if (d.lunches) day.lunches = true;
    if (d.laundry) day.laundry = true;
    if (d.cooking) day.cooking = true;
    if (Object.keys(day).length) log[d.day || d.id] = day;
    else delete log[d.day || d.id];
  }
  return log;
}

function outcome(r: { ok: true } | { ok: false; reason: "QUEUED" | "DARK_WINDOW" }): DumpOutcome {
  return r.ok ? "sent" : r.reason;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ItemDoc[]>([]);
  const [held, setHeld] = useState(heldDumps().length);
  const [storeKind, setStoreKind] = useState<StoreKind | null>(null);
  const [transport, setTransport] = useState<DoorTransport>("none");
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(isDarkHours());
  const [toastClock, setToastClock] = useState<Toast | null>(null);
  const [clock, setClock] = useState(etClock());
  const [cutoffIn, setCutoffIn] = useState<number | null>(minutesToCutoff());
  const [laneDocs, setLaneDocs] = useState<LaneDoc[]>([]);
  const [localLanes, setLocalLanes] = useState<LaneLog>({});
  const [lastFloor, setLastFloor] = useState<FloorMemo | null>(null);
  const [hero, setHero] = useState<HeroPayload | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setToastClock({ msg, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!toastClock) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toastClock]);

  // store subscriptions: items + lanes
  useEffect(() => {
    let offItems = () => undefined as void;
    let offLanes = () => undefined as void;
    let live = true;
    void openStore().then((s) => {
      if (!live) return;
      setStoreKind(s.kind);
      offItems = s.subscribe("items", (docs) => {
        if (live) setItems(docs);
      });
      offLanes = s.subscribe("lanes", (docs) => {
        if (live) setLaneDocs(docs);
      });
    });
    return () => {
      live = false;
      offItems();
      offLanes();
    };
  }, []);

  const refresh = useCallback(async () => {
    setLocalLanes(await readLocalLanes());
    setLastFloor(await readFloorMemo());
    setDark(isDarkHours());
    setHeld(heldDumps().length);
    setTransport(await detectTransport());
    const s = await openStore();
    setStoreKind(s.kind);
    setItems(await s.list("items"));
    setLaneDocs(await s.list("lanes"));
    setHero(await fetchHero());
  }, []);

  useEffect(() => {
    let live = true;
    const id = window.setInterval(() => {
      void fetchHero().then((h) => {
        if (live) setHero(h);
      });
    }, 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      setDark(isDarkHours());
      setClock(etClock());
      setCutoffIn(minutesToCutoff());
    }, 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // flush held dumps when a door answers and it is not the dark window
  const flushHeld = useCallback(async () => {
    if (isDarkHours() || heldDumps().length === 0) return;
    const t = await detectTransport();
    setTransport(t);
    if (t === "none") return;
    const pending = releaseHeld();
    let sent = 0;
    for (let i = 0; i < pending.length; i++) {
      if (isDarkHours()) {
        for (const h of pending.slice(i)) holdDump(h.text);
        break;
      }
      const r = await dropRaw(pending[i].text); // re-holds on its own when the door fails
      if (r.ok) sent++;
      else {
        for (const h of pending.slice(i + 1)) holdDump(h.text);
        break;
      }
    }
    setHeld(heldDumps().length);
    if (sent) showToast(`${sent} sent from the phone queue.`);
  }, [showToast]);

  useEffect(() => {
    if (dark) return;
    void flushHeld();
    const id = window.setInterval(() => void flushHeld(), 60_000);
    return () => window.clearInterval(id);
  }, [dark, flushHeld]);

  const tickLane = useCallback(async (key: LaneKey) => {
    await tickLaneDoc(key);
  }, []);

  const rememberFloor = useCallback(async (st: FloorState, at: string) => {
    setLastFloor(await writeFloorMemo(st, at));
  }, []);

  const dump = useCallback(
    async (text: string) => {
      const r = await dumpRaw(text);
      setHeld(heldDumps().length);
      const o = outcome(r);
      showToast(o === "sent" ? "Dropped. Receipt in the store." : o === "DARK_WINDOW" ? "Dark. Queued on this phone." : "Queued on this phone.");
      return o;
    },
    [showToast],
  );

  const start = useCallback(
    async (text: string) => {
      const { door } = await startItem(text);
      setHeld(heldDumps().length);
      const o = outcome(door);
      showToast(o === "sent" ? "Start · 8 min" : "Start · 8 min (raw queued on this phone)");
      return o;
    },
    [showToast],
  );

  const resume = useCallback(
    (id: string) => {
      void resumeItem(id);
      showToast("Start · 8 min");
    },
    [showToast],
  );

  const running = useMemo(() => {
    const started = items.filter((x: ItemDoc) => x.state === "started").sort((a: ItemDoc, b: ItemDoc) => (a.started_at < b.started_at ? 1 : -1));
    return started[0] ?? null;
  }, [items]);

  const park = useCallback(
    (id?: string) => {
      const target = id || running?.id;
      if (target) void parkItem(target);
      showToast("Parked. Still captured.");
    },
    [running, showToast],
  );

  const done = useCallback(
    async (id: string) => {
      const c = await doneItem(id);
      showToast(`Done. ${c.done} today.`);
      return true;
    },
    [showToast],
  );

  const logFloor = useCallback(async (vec: Vector) => {
    const doc = await logFloorDoc(vec);
    return { at: doc.at };
  }, []);

  const nowList = useMemo(
    () => items.filter((x: ItemDoc) => x.state === "started" || x.state === "parked").sort((a: ItemDoc, b: ItemDoc) => (a.at < b.at ? 1 : -1)),
    [items],
  );
  const lanes = useMemo(() => lanesFromDocs(laneDocs, localLanes), [laneDocs, localLanes]);
  const endsAt = running ? Date.parse(running.timer_end) : null;

  const value = useMemo<Store>(
    () => ({
      items: nowList,
      held,
      storeKind,
      transport,
      toast,
      dark,
      runningId: running?.id ?? null,
      endsAt: endsAt != null && Number.isFinite(endsAt) ? endsAt : null,
      clock,
      cutoffIn,
      lanes,
      lastFloor,
      hero,
      refresh,
      tickLane,
      rememberFloor,
      dump,
      start,
      resume,
      park,
      done,
      logFloor,
      showToast,
    }),
    [nowList, held, storeKind, transport, toast, dark, running, endsAt, clock, cutoffIn, lanes, lastFloor, hero, refresh, tickLane, rememberFloor, dump, start, resume, park, done, logFloor, showToast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("store");
  return s;
}
