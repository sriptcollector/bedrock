// The signed-in Toolbay account. Two sources, both read-only for us:
//  1. TOOLBAY_TOKEN, set by the hub when it launches us. Read once at startup, kept in memory only
//     and removed from process.env so renderers and community plugins never inherit it.
//  2. The hub's OS keychain entry: service "ai.toolbay.desktop", account "session"
//     (same as toolbay-desktop/src-tauri/src/api.rs KEYRING_SERVICE / KEYRING_USER; the value is the
//     raw bearer token). We never write our own copy.
const KEYRING_SERVICE = "ai.toolbay.desktop";
const KEYRING_USER = "session";

let envToken: string | null = null;

export function captureEnvToken(): void {
  const t = process.env.TOOLBAY_TOKEN;
  if (t && t.trim()) envToken = t.trim();
  delete process.env.TOOLBAY_TOKEN;
}

export function keychainToken(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Entry } = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    const v = new Entry(KEYRING_SERVICE, KEYRING_USER).getPassword();
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Current token: the hub's env token wins, else the keychain session. Never persisted by us. */
export function token(): string | null {
  return envToken ?? keychainToken();
}

export function signedIn(): boolean {
  return token() !== null;
}

export interface Account {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string;
}

/** Who is signed in, from toolbay.ai (the only host the token is ever sent to). */
export async function account(): Promise<Account | null> {
  const t = token();
  if (!t) return null;
  try {
    const base = (process.env.TOOLBAY_API_BASE || "https://toolbay.ai").replace(/\/$/, "");
    const r = await fetch(`${base}/api/v1/me`, {
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const v: any = await r.json();
    const u = v.user ?? v;
    return { id: String(u.id ?? ""), name: u.name ?? "", handle: u.handle ?? "", avatarUrl: u.avatarUrl };
  } catch {
    return null;
  }
}
