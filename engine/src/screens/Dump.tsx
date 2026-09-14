import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

const HOLD_MS = 500;

export function DumpScreen() {
  const { dump, start, dark, held, showToast } = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  const pressing = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  async function fire(mode: "dump" | "start") {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      if (mode === "start") await start(v);
      else await dump(v);
      setText("");
    } catch (err) {
      // never swallow: a silent failure looked like "nothing happens" on the phone (01:07 ET)
      showToast(`Dump failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void fire("dump");
  }

  function onDown() {
    if (busy || !text.trim()) return;
    pressing.current = true;
    clearTimer();
    timer.current = window.setTimeout(() => {
      if (pressing.current) setArmed(true);
    }, HOLD_MS);
  }

  function onUp() {
    if (!pressing.current) return;
    pressing.current = false;
    clearTimer();
    void fire(armed ? "start" : "dump");
  }

  function onCancel() {
    pressing.current = false;
    clearTimer();
    setArmed(false);
  }

  return (
    <>
      {dark && (
        <div className="banner">
          Walker&apos;s dark (02:00–05:59 ET). No door call. Dumps queue on this phone until 06:00.
        </div>
      )}
      <form className="card" onSubmit={onSubmit}>
        <div className="tag">DUMP</div>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Garbage or Gold?"
          autoComplete="off"
          enterKeyHint="done"
          aria-label="Garbage or Gold?"
        />
        <div style={{ height: 10 }} />
        <button
          className={`btn primary${armed ? " running" : ""}`}
          type="button"
          style={{ width: "100%", touchAction: "none", userSelect: "none" }}
          disabled={busy || !text.trim()}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onPointerLeave={onCancel}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={armed ? "Start" : "Dump"}
        >
          {busy ? "…" : armed ? "START" : "DUMP"}
        </button>
        <div className="tiny" style={{ marginTop: 8 }}>
          {held > 0 ? `${held} queued on this phone` : "Tap = dump. Hold = start (8 min)."}
        </div>
      </form>
    </>
  );
}
