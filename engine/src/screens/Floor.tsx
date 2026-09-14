import { useState } from "react";
import { computeState, emptyVector, VECS, type VecKey, type Vector } from "../lib/state";
import { useStore } from "../lib/store";
import { etDateTime, isDarkHours } from "../lib/clock";

export function FloorScreen() {
  const { showToast, dark, rememberFloor, logFloor } = useStore();
  const [vec, setVec] = useState<Vector>(emptyVector);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof computeState> | null>(null);

  function setKey(key: VecKey, n: number) {
    setTouched((t) => ({ ...t, [key]: true }));
    setVec((v) => ({ ...v, [key]: n }));
  }

  async function submit() {
    if (busy) return;
    if (isDarkHours()) {
      showToast("Walker's dark. Log it in the morning.");
      return;
    }
    const any = VECS.some((v) => touched[v.key]);
    if (!any) {
      showToast("Move the sliders that changed — untouched ones don't count.");
      return;
    }
    setBusy(true);
    try {
      const payload: Vector = emptyVector();
      for (const v of VECS) payload[v.key] = touched[v.key] ? vec[v.key] : null;
      await logFloor(payload);
      const rec = computeState(payload);
      setResult(rec);
      await rememberFloor(rec, etDateTime());
      setTouched({});
      setVec(emptyVector());
      showToast("Floor logged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dark && <div className="banner">Walker&apos;s dark. Floor does not write until 06:00 ET.</div>}
      <div className="card">
        <div className="muted" style={{ marginBottom: 4 }}>
          Six vectors. Thirty seconds. Where&apos;s the floor?
        </div>
        <div className="tiny" style={{ marginBottom: 6 }}>
          Move each one you&apos;re logging. Untouched sliders don&apos;t count. Numbers only, into the store.
        </div>
        {VECS.map((v) => (
          <div className="vec" key={v.key}>
            <div className="lab">
              <span>{v.label}</span>
              <span className="val">{touched[v.key] ? vec[v.key] : "—"}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={vec[v.key] ?? 3}
              onChange={(e) => setKey(v.key, Number(e.target.value))}
              aria-label={v.label}
            />
          </div>
        ))}
        <div style={{ height: 14 }} />
        <button className="btn primary" type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? "Logging…" : "Log floor check"}
        </button>
        {result && (
          <div className="stateBox">
            <b style={{ color: result.color }}>
              State {result.code} — {result.name}
            </b>
            <div className="muted" style={{ marginTop: 4 }}>
              {result.line}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
