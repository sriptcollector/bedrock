// Vault key escrow through the Toolbay tool settings sync API.
//
// The first device creates the key and stores it in the account (item "vault-key" of this tool's
// settings). Every other device signed in to the same Toolbay account fetches it from there and
// caches it in the OS keychain. No password for people to remember. Honest caveat: whoever controls
// the Toolbay account can get the key; the sync server and its storage bucket alone cannot.
//
// Race: two brand-new devices may both find no key and both create one. Both PUT with
// baseVersion 0; the server applies only the first, the second gets the first key back under
// `conflicts` and uses it. Nothing was encrypted with the losing key because nobody syncs before
// obtainVaultKey returns.

import { SyncError, type FetchLike } from './api.js';
import { ESCROW_ITEM_KEY, TOOL_SLUG } from './constants.js';
import { generateVaultKey, KEY_BYTES } from './crypto.js';

export interface Keychain {
  /** Returns the stored base64 key, or null. */
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export interface ObtainKeyOptions {
  toolbayApi?: string;
  token: string;
  slug?: string;
  keychain: Keychain;
  fetch?: FetchLike;
}

interface EscrowValue {
  v: 1;
  key: string; // base64, 32 bytes
  createdAt: number;
}

function decodeKey(value: unknown): Uint8Array | null {
  const b64 = typeof value === 'string' ? value : (value as EscrowValue | null)?.key;
  if (typeof b64 !== 'string') return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length === KEY_BYTES ? new Uint8Array(buf) : null;
}

const b64 = (k: Uint8Array) => Buffer.from(k).toString('base64');

export class KeyEscrow {
  private readonly base: string;
  private readonly fetchFn: FetchLike;
  constructor(
    toolbayApi: string,
    private readonly token: string,
    private readonly slug: string = TOOL_SLUG,
    fetchFn?: FetchLike,
  ) {
    this.base = toolbayApi.replace(/\/+$/, '');
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  private url(): string {
    return `${this.base}/api/v1/me/tools/${encodeURIComponent(this.slug)}/sync`;
  }

  private async call(method: 'GET' | 'PUT', body?: unknown): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url(), {
        method,
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new SyncError(`Cannot reach Toolbay (${(e as Error).message})`, 'network');
    }
    if (res.status === 401 || res.status === 403) throw new SyncError('Your Toolbay sign-in has expired. Sign in to Toolbay again to keep syncing.', 'auth', res.status);
    if (!res.ok) throw new SyncError(`Toolbay settings sync failed (${res.status})`, res.status >= 500 ? 'network' : 'client', res.status);
    return res.json();
  }

  /** The escrowed key, or null if the account has none yet. */
  async fetch(): Promise<Uint8Array | null> {
    const r = await this.call('GET');
    return decodeKey(r?.items?.[ESCROW_ITEM_KEY]?.value);
  }

  /** Stores `key` if the account has none. Returns the key that won (ours, or the one already there). */
  async create(key: Uint8Array): Promise<Uint8Array> {
    const value: EscrowValue = { v: 1, key: b64(key), createdAt: Date.now() };
    const r = await this.call('PUT', { changes: [{ key: ESCROW_ITEM_KEY, baseVersion: 0, value }] });
    if (r?.applied?.[ESCROW_ITEM_KEY]) return key;
    const theirs = decodeKey(r?.conflicts?.[ESCROW_ITEM_KEY]?.value);
    if (theirs) return theirs;
    const again = await this.fetch(); // conflict without a value (e.g. deleted meanwhile): read it back
    if (again) return again;
    throw new SyncError('Could not store the vault key in your Toolbay account', 'client');
  }
}

/**
 * Returns this account's vault key: from the account when reachable (so a stale keychain entry is
 * corrected), else from the keychain (offline start), else creates one.
 */
export async function obtainVaultKey(o: ObtainKeyOptions): Promise<Uint8Array> {
  const escrow = new KeyEscrow(o.toolbayApi ?? 'https://toolbay.ai', o.token, o.slug ?? TOOL_SLUG, o.fetch);
  const cached = decodeKey(await o.keychain.get().catch(() => null));
  let remote: Uint8Array | null;
  try {
    remote = await escrow.fetch();
  } catch (e) {
    if (cached && e instanceof SyncError && e.kind === 'network') return cached;
    throw e;
  }
  if (remote) {
    if (!cached || b64(cached) !== b64(remote)) await o.keychain.set(b64(remote));
    return remote;
  }
  // No key in the account yet. If this device already has one (e.g. it created the vault before
  // escrow existed), publish that one; otherwise make a new one.
  const winner = await escrow.create(cached ?? generateVaultKey());
  await o.keychain.set(b64(winner));
  return winner;
}
