import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { DumpScreen } from "./screens/Dump";
import { FloorScreen } from "./screens/Floor";
import { NowScreen } from "./screens/Now";
import { SettingsScreen } from "./screens/Settings";
import { useStore } from "./lib/store";
import { memoIsFresh } from "./lib/floorMemo";

const TABS = [
  { to: "/dump", label: "Dump" },
  { to: "/now", label: "Now" },
  { to: "/floor", label: "Floor" },
  { to: "/settings", label: "Set" },
] as const;

type Tone = "ok" | "warn" | "bad" | "off";

/** Status is a lamp, not a sentence (Joe, 2026-09-13). Tap a lamp → the sentence, as a toast. */
function Lamp({ label, tone, sentence }: { label: string; tone: Tone; sentence: string }) {
  const { showToast } = useStore();
  return (
    <button type="button" className={`lamp ${tone}`} onClick={() => showToast(sentence)} aria-label={`${label}: ${sentence}`}>
      <span>{label}</span>
      <span className="dot" />
    </button>
  );
}

export function App() {
  const { toast, dark, cutoffIn, lastFloor, storeKind, transport, held } = useStore();
  const fresh = memoIsFresh(lastFloor);

  const storeTone: Tone = storeKind === "artifact" ? "ok" : storeKind === "local" ? "warn" : "bad";
  const storeSentence =
    storeKind === "artifact"
      ? "Store: walker_v0 artifact database. Writes land in the shared store."
      : storeKind === "local"
        ? "Store: this phone only (walker.v0). Carries over when the app lands at the walker URL."
        : "Store: not open yet.";

  const rawTone: Tone = dark ? "warn" : held > 0 ? "warn" : transport === "none" ? "bad" : "ok";
  const rawSentence = dark
    ? "Raw door closed 02:00–05:59 ET. Dumps are held on this phone until 06:00."
    : held > 0
      ? `${held} queued on this phone. They go out on the next dump that finds a door.`
      : transport === "mcp"
        ? "Raw door: Drive connector. Stamps land in the feeds folder with a receipt."
        : transport === "oauth"
          ? "Raw door: Google sign-in. Stamps land in the feeds folder with a receipt."
          : "Raw door: none. Sign in (Set) or open the app at the walker URL.";

  const floorTone: Tone = dark ? "bad" : fresh && lastFloor ? (lastFloor.color.includes("bad") ? "bad" : lastFloor.color.includes("warn") ? "warn" : "ok") : "off";
  const floorSentence = dark
    ? "Walker's dark. No writes until 06:00."
    : fresh && lastFloor
      ? `State ${lastFloor.code} — ${lastFloor.name}. Logged ${lastFloor.atLabel} ET.`
      : "No floor check in the last 16 hours.";

  const cutoffTone: Tone = cutoffIn == null ? "off" : cutoffIn <= 30 ? "bad" : cutoffIn <= 90 ? "warn" : "ok";
  const cutoffSentence =
    cutoffIn == null ? "" : `02:00 cutoff in ${Math.floor(cutoffIn / 60)}h ${String(cutoffIn % 60).padStart(2, "0")}m. The rule is the rule.`;

  return (
    <div className="app">
      <header className="top">
        <h1>Joe_OS <span className="ver">0.3</span></h1>
        <div className="lamps">
          <Lamp label="STORE" tone={storeTone} sentence={storeSentence} />
          <Lamp label="RAW" tone={rawTone} sentence={rawSentence} />
          <Lamp label="FLOOR" tone={floorTone} sentence={floorSentence} />
          {cutoffIn != null && <Lamp label="CUTOFF" tone={cutoffTone} sentence={cutoffSentence} />}
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/now" replace />} />
          <Route path="/dump" element={<DumpScreen />} />
          <Route path="/now" element={<NowScreen />} />
          <Route path="/floor" element={<FloorScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
        </Routes>
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "on" : "")}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div id="toast" className={toast ? "on" : ""}>
        {toast}
      </div>
    </div>
  );
}
