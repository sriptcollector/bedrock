// Bearer token -> Toolbay user id, by asking toolbay.ai who the token belongs to.
// Positive answers are cached 5 minutes, "not signed in" answers 30 seconds. If toolbay.ai cannot
// be reached we answer 503 (the client treats that as "offline, retry") and cache nothing.

import { createHash } from 'node:crypto';

export class AuthError extends Error {
  status = 401;
}
export class UpstreamError extends Error {
  status = 503;
}

export interface AuthOptions {
  toolbayApi: string;
  devAuth?: boolean;
  fetch?: typeof fetch;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  now?: () => number;
  maxEntries?: number;
}

type Entry = { userId: string | null; exp: number };

export class Authenticator {
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<string>>();
  private readonly posTtl: number;
  private readonly negTtl: number;
  private readonly now: () => number;
  private readonly fetch: typeof fetch;
  upstreamCalls = 0;

  constructor(private readonly opts: AuthOptions) {
    this.posTtl = opts.positiveTtlMs ?? 5 * 60_000;
    this.negTtl = opts.negativeTtlMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  static fromHeader(h: string | undefined): string | null {
    if (!h) return null;
    const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
    return m ? m[1] : null;
  }

  /** Resolves to the user id or throws AuthError / UpstreamError. */
  async verify(token: string | null): Promise<string> {
    if (!token || token.length > 4096) throw new AuthError('Missing or invalid sign-in token');
    if (this.opts.devAuth && token.startsWith('dev:')) {
      const id = token.slice(4);
      if (!/^[\w.-]{1,128}$/.test(id)) throw new AuthError('Bad dev token');
      return id;
    }
    const key = createHash('sha256').update(token).digest('hex');
    const hit = this.cache.get(key);
    if (hit && hit.exp > this.now()) {
      if (hit.userId) return hit.userId;
      throw new AuthError('Your Toolbay sign-in is not valid');
    }
    let p = this.inflight.get(key);
    if (!p) {
      p = this.lookup(key, token).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private remember(key: string, userId: string | null): void {
    this.cache.delete(key);
    this.cache.set(key, { userId, exp: this.now() + (userId ? this.posTtl : this.negTtl) });
    const max = this.opts.maxEntries ?? 50_000;
    while (this.cache.size > max) this.cache.delete(this.cache.keys().next().value!);
  }

  private async lookup(key: string, token: string): Promise<string> {
    this.upstreamCalls++;
    let res: Response;
    try {
      res = await this.fetch(new URL('/api/v1/me', this.opts.toolbayApi), {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new UpstreamError('Could not reach Toolbay to check your sign-in');
    }
    if (res.status === 401 || res.status === 403) {
      this.remember(key, null);
      throw new AuthError('Your Toolbay sign-in is not valid');
    }
    if (!res.ok) throw new UpstreamError(`Toolbay sign-in check failed (${res.status})`);
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError('Toolbay sign-in check returned bad data');
    }
    const id = body?.user?.id;
    if (id === undefined || id === null || id === '') throw new UpstreamError('Toolbay sign-in check returned no user');
    const userId = String(id);
    this.remember(key, userId);
    return userId;
  }
}
