// The signed-in Toolbay account. Two sources, both read-only for us:
//  1. TOOLBAY_TOKEN, set by the hub when it launches us. Read once at startup, kept in memory only
//     and removed from process.env so renderers and community plugins never inherit it.
//  2. The hub's stored session (the raw bearer token). Windows/Linux: the OS keychain entry, service
//     "ai.toolbay.desktop", account "session" (toolbay-desktop KEYRING_SERVICE / KEYRING_USER).
//     macOS: the 0600 file the hub (0.1.13+) writes, ~/Library/Application Support/
//     ai.toolbay.desktop/session; the Keychain is never touched on macOS, so no password prompts
//     after updates (see sync/keychain.ts). We never write our own copy.
import { keychainGet } from "./sync/keychain";

const KEYRING_SERVICE = "ai.toolbay.desktop";
const KEYRING_USER = "session";

let envToken: string | null = null;

export function captureEnvToken(): void {
  const t = process.env.TOOLBAY_TOKEN;
  if (t && t.trim()) envToken = t.trim();
  delete process.env.TOOLBAY_TOKEN;
}

export function keychainToken(): string | null {
  return keychainGet(KEYRING_SERVICE, KEYRING_USER);
}

let sawKeychain = false;

/**
 * Current token. The hub's keychain session is read fresh each time (the hub may sign in or out
 * while we run); the TOOLBAY_TOKEN the hub launched us with is the fallback. Once the keychain
 * session has been seen and then disappears, the hub signed out, so the launch token is dropped
 * too. Never persisted by us.
 */
export function token(): string | null {
  const k = keychainToken();
  if (k) {
    sawKeychain = true;
    return k;
  }
  if (sawKeychain) envToken = null;
  return envToken;
}

export function signedIn(): boolean {
  return token() !== null;
}

export interface Account {
  id: string;
  name: string;
  handle: string;
  email?: string;
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
    return { id: String(u.id ?? ""), name: u.name ?? "", handle: u.handle ?? "", email: u.email ?? undefined, avatarUrl: u.avatarUrl ?? undefined };
  } catch {
    return null;
  }
}
