import { logMeta } from "./log";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const TOKEN_KEY = "joeos.now.token";
const EMAIL_KEY = "joeos.now.email";

type TokenBag = { access: string; exp: number };

let mem: TokenBag | null = null;

function readBag(): TokenBag | null {
  if (mem && mem.exp > Date.now() + 15_000) return mem;
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const bag = JSON.parse(raw) as TokenBag;
    if (bag.access && bag.exp > Date.now() + 15_000) {
      mem = bag;
      return bag;
    }
  } catch {
    /* ignore */
  }
  mem = null;
  return null;
}

function writeBag(bag: TokenBag | null) {
  mem = bag;
  try {
    if (bag) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(bag));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
}

export function hasClientId(): boolean {
  return clientId().length > 0;
}

export function accessToken(): string | null {
  return readBag()?.access ?? null;
}

export function signedEmail(): string | null {
  try {
    return sessionStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

async function pullEmail(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { email?: string };
    return j.email || null;
  } catch {
    return null;
  }
}

export async function signIn(): Promise<{ ok: boolean; error?: string; email?: string }> {
  const id = clientId();
  if (!id) return { ok: false, error: "NO_CLIENT_ID" };
  if (!window.google?.accounts?.oauth2) return { ok: false, error: "GIS_NOT_LOADED" };
  return new Promise((resolve) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPES,
      callback: (resp) => {
        void (async () => {
          if (!resp.access_token) {
            resolve({ ok: false, error: resp.error || "NO_TOKEN" });
            return;
          }
          const exp = Date.now() + Math.max(60, Number(resp.expires_in) || 3600) * 1000;
          writeBag({ access: resp.access_token, exp });
          const email = await pullEmail(resp.access_token);
          try {
            if (email) sessionStorage.setItem(EMAIL_KEY, email);
          } catch {
            /* ignore */
          }
          logMeta("google.signin", { email: email || null });
          resolve({ ok: true, email: email || undefined });
        })();
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

export function signOut(): void {
  const t = accessToken();
  writeBag(null);
  try {
    sessionStorage.removeItem(EMAIL_KEY);
  } catch {
    /* ignore */
  }
  if (t && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(t, () => undefined);
  }
  logMeta("google.signout", {});
}

export async function gfetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = accessToken();
  if (!token) throw new Error("NO_AUTH");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
