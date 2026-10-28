// The protected vault key in the person's Toolbay account (tool settings sync API, tool "bedrock").
//
// Since 0.1.3 the account only ever holds item "vault-key-wrapped": the vault key encrypted with a
// key derived from the person's sync passphrase (keywrap.ts). Toolbay can't open it. A computer
// that turns sync on either creates the vault key and stores it wrapped (first computer), or
// downloads the wrapped key and opens it with the passphrase (every other computer). Each computer
// then keeps the opened key in its OS keychain so the passphrase is asked only once per computer.
//
// Bedrock 0.1.2 and older stored the raw key as item "vault-key". That item is deleted from the
// account (deleteRawKey) and toolbay.ai no longer returns or accepts it. The old key counts as
// exposed: turning sync back on makes a new vault key and re-encrypts the synced data (rotate.ts).
//
// Race: two computers setting up sync at the same moment both PUT with baseVersion 0; the server
// applies only the first, the second gets a conflict and asks for the passphrase set first.

import { SyncError, type FetchLike } from './api.js';
import { ESCROW_ITEM_KEY, TOOL_SLUG, WRAPPED_KEY_ITEM } from './constants.js';
import { isWrappedKey, type WrappedKey } from './keywrap.js';

export interface Keychain {
  /** Returns the stored base64 key, or null. */
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export interface AccountWrappedKey {
  key: WrappedKey;
  version: number;
}

export class AccountKeyStore {
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
    if (!res.ok) {
      let msg = '';
      try {
        msg = (await res.json())?.error ?? '';
      } catch {
        /* not json */
      }
      throw new SyncError(msg || `Toolbay settings sync failed (${res.status})`, res.status >= 500 ? 'network' : 'client', res.status);
    }
    return res.json();
  }

  /** The account's wrapped vault key, or null if sync was never set up on this account. */
  async getWrapped(): Promise<AccountWrappedKey | null> {
    const it = (await this.call('GET'))?.items?.[WRAPPED_KEY_ITEM];
    if (!it || it.deleted || !isWrappedKey(it.value)) return null;
    return { key: it.value, version: it.version };
  }

  /**
   * Stores `key` if the account's wrapped key is still at `baseVersion` (0 = none yet). Returns
   * null on success, else what the account has now (someone set up sync first).
   */
  async putWrapped(key: WrappedKey, baseVersion: number): Promise<AccountWrappedKey | null> {
    const r = await this.call('PUT', { changes: [{ key: WRAPPED_KEY_ITEM, baseVersion, value: key }] });
    if (r?.applied?.[WRAPPED_KEY_ITEM]) return null;
    const theirs = r?.conflicts?.[WRAPPED_KEY_ITEM];
    if (theirs && isWrappedKey(theirs.value)) return { key: theirs.value, version: theirs.version };
    const again = await this.getWrapped();
    if (again) return again;
    throw new SyncError('Could not save the protected vault key in your Toolbay account. Try again.', 'client');
  }

  /**
   * Deletes the raw vault key Bedrock 0.1.2 and older kept in the account. Current toolbay.ai
   * hides that item and deletes it whatever version we name; an older server still shows it, so we
   * name its real version when we can see it. Never reads or keeps the key itself.
   */
  async deleteRawKey(): Promise<void> {
    const it = (await this.call('GET'))?.items?.[ESCROW_ITEM_KEY];
    const baseVersion = it && !it.deleted && Number.isInteger(it.version) ? it.version : 0;
    await this.call('PUT', { changes: [{ key: ESCROW_ITEM_KEY, baseVersion, deleted: true }] });
    const left = (await this.call('GET'))?.items?.[ESCROW_ITEM_KEY];
    if (left && !left.deleted && left.value) throw new SyncError('Toolbay still has the old vault key; will try again.', 'network');
  }
}
