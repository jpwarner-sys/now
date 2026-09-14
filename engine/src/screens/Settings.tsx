import { useState } from "react";
import { LIVE, LIVE_CONTROL, ORIGIN_SURFACE, TICKET } from "../lib/ids";
import { clientId, hasClientId, signIn, signOut, signedEmail } from "../lib/google";
import { useStore } from "../lib/store";

export function SettingsScreen() {
  const { refresh, showToast, storeKind, held, transport } = useStore();
  const [email, setEmail] = useState(signedEmail());
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    setBusy(true);
    try {
      const r = await signIn();
      if (!r.ok) {
        showToast(r.error === "NO_CLIENT_ID" ? "Set VITE_GOOGLE_CLIENT_ID" : r.error || "Sign-in failed");
        return;
      }
      setEmail(r.email || signedEmail());
      showToast("Signed in");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function onSignOut() {
    signOut();
    setEmail(null);
    showToast("Signed out");
    void refresh();
  }

  return (
    <div className="card">
      <div className="tag">SETTINGS</div>
      <div className="tiny" style={{ marginTop: 8, marginBottom: 12 }}>
        Display only. Store = walker_v0 (artifact db when published there, localStorage otherwise). No app writes the Sheet.
      </div>
      <div className="kv">
        <span>Store</span>
        <b>{storeKind ?? "opening…"}</b>
      </div>
      <div className="kv">
        <span>Queued on this phone</span>
        <b>{held}</b>
      </div>
      <div className="kv">
        <span>Feeds folder</span>
        <b>{LIVE.feedsFolder}</b>
      </div>
      <div className="kv">
        <span>Door transport</span>
        <b>{transport}</b>
      </div>
      <div className="kv">
        <span>origin_surface</span>
        <b>{ORIGIN_SURFACE}</b>
      </div>
      <div className="kv">
        <span>Google account</span>
        <b>{email || LIVE.accountHint + " (not signed in)"}</b>
      </div>
      <div className="kv">
        <span>live_control</span>
        <b>{String(LIVE_CONTROL)}</b>
      </div>
      <div className="kv">
        <span>Ticket</span>
        <b>{TICKET}</b>
      </div>
      <div className="kv">
        <span>OAuth client</span>
        <b>{hasClientId() ? clientId().slice(0, 18) + "…" : "missing"}</b>
      </div>
      <div className="kv">
        <span>iOS</span>
        <b>Blocked on Windows. Mac + App Store later. Live icon stays.</b>
      </div>
      <div style={{ height: 14 }} />
      {email ? (
        <button className="btn ghost" type="button" onClick={onSignOut}>
          Sign out
        </button>
      ) : (
        <button className="btn primary" type="button" onClick={() => void onSignIn()} disabled={busy}>
          {busy ? "Opening Google…" : "Sign in with Google (oauth door, localhost dev)"}
        </button>
      )}
      <div className="tiny" style={{ marginTop: 10 }}>
        Dark window 02:00–05:59 America/Toronto: no door call, dumps queue on this phone. Hop 2/3 is out of scope.
      </div>
    </div>
  );
}
