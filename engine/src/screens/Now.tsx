import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { LANES, laneStreak, lanesDoneToday } from "../lib/lanes";
import { etToday } from "../lib/clock";
import { isMissingLine, toneVar, type HeroLines, type HeroPayload } from "../lib/iris";

const HERO_ROWS: (keyof HeroLines)[] = ["CAPACITY", "MODE", "NEXT", "EVIDENCE"];

/** Prints hero.hero.* verbatim. Missing feeds stay literal — no fixture, no fake band. */
function HeroCard({ hero }: { hero: HeroPayload }) {
  const asOf = /T(\d{2}:\d{2})/.exec(hero.as_of)?.[1] ?? hero.as_of;
  return (
    <div className="card hero">
      {HERO_ROWS.map((k) => {
        const v = hero.hero[k];
        const missing = isMissingLine(v);
        const style = k === "CAPACITY" && !missing ? { color: toneVar(hero.capacity?.state.tone) } : undefined;
        return (
          <div className="heroRow" key={k}>
            <span className="tiny tag">{k}</span>
            <span className={`heroVal${missing ? " missing" : ""}`} style={style}>
              {v}
            </span>
          </div>
        );
      })}
      <div className="tiny heroFoot">
        brain · {hero.source} · {asOf}
      </div>
    </div>
  );
}

function clock(endsAt: number): string {
  const ms = Math.max(0, endsAt - Date.now());
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** L's four lanes. Tap = done today. Streak counts school days only for school/lunches. */
function LanesCard() {
  const { lanes, tickLane, showToast } = useStore();
  const done = lanesDoneToday(lanes);
  return (
    <div className="card lanes">
      <div className="lanesHead">
        <span className="tiny tag">LANES · L</span>
        <span className="tiny">
          {done}/{LANES.length} today
        </span>
      </div>
      <div className="laneGrid">
        {LANES.map((l) => {
          const on = !!lanes[etToday()]?.[l.key];
          const streak = laneStreak(lanes, l.key);
          return (
            <button
              key={l.key}
              type="button"
              className={`lane ${on ? "on" : ""}`}
              aria-pressed={on}
              title={l.hint}
              onClick={() => {
                void tickLane(l.key);
                if (!on) showToast(streak >= 2 ? `${l.label} · ${streak + 1} in a row` : `${l.label} · off her plate`);
              }}
            >
              <span className="laneWhen">{l.when}</span>
              <span className="laneLabel">{l.label}</span>
              <span className="laneStreak">{streak > 0 ? `×${streak}` : "—"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NowScreen() {
  const { items, resume, done, park, runningId, endsAt, hero } = useStore();
  const [tick, setTick] = useState("08:00");
  const running = items.find((c) => c.id === runningId);

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setTick(clock(endsAt)), 250);
    setTick(clock(endsAt));
    return () => window.clearInterval(id);
  }, [endsAt]);

  return (
    <>
      {hero && <HeroCard hero={hero} />}
      {running && endsAt && (
        <div className="card running" style={{ textAlign: "center" }}>
          <div className="tiny tag">NOW</div>
          <div className="verb">{running.text}</div>
          <div className="timer">{tick}</div>
          <div style={{ height: 14 }} />
          <button className="btn primary" type="button" onClick={() => void done(running.id)}>
            Done
          </button>
          <div style={{ height: 8 }} />
          <button className="btn ghost" type="button" onClick={() => park()}>
            Park it
          </button>
        </div>
      )}
      <LanesCard />
      <div className="card">
        <div className="tiny tag">NOW LIST</div>
        <div className="tiny" style={{ marginTop: 6 }}>
          Items in the store (started · parked), newest first. Start / Done / Park.
        </div>
        {items.length === 0 ? (
          <div className="muted" style={{ marginTop: 10 }}>
            Nothing parked.
          </div>
        ) : (
          items.map((c) => (
            <div className="cap" key={c.id}>
              <span className="t">
                <span className="id">{c.id.slice(0, 8)} · {c.state} · {c.words}w</span>
                {c.text}
              </span>
              <button className="go" type="button" onClick={() => resume(c.id)}>
                Start
              </button>
              <button className="x" type="button" onClick={() => void done(c.id)}>
                Done
              </button>
              <button className="p" type="button" onClick={() => park(c.id)}>
                Park
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
