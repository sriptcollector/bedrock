/** Token bucket per key (user id or IP). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly perSec: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 if allowed, otherwise the number of seconds to wait. */
  take(key: string, cost = 1): number {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, at: t };
      this.buckets.set(key, b);
      if (this.buckets.size > 100_000) this.sweep(t);
    }
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 1000) * this.perSec);
    b.at = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return 0;
    }
    return Math.max(1, Math.ceil((cost - b.tokens) / this.perSec));
  }

  private sweep(t: number): void {
    for (const [k, b] of this.buckets) if (t - b.at > 60_000) this.buckets.delete(k);
  }
}
