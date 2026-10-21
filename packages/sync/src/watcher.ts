// Recursive fs.watch (works on Windows, macOS and Linux in Node 20+). Collects changed paths and
// reports them after a quiet period, so editors that save via temp file + rename, or write a file
// in several bursts, produce one sync instead of many.

import { watch, type FSWatcher } from 'node:fs';
import { isIgnored, type IgnoreOptions } from './ignore.js';
import { toPosix } from './paths.js';

export interface WatcherOptions {
  debounceMs?: number;
  maxWaitMs?: number;
  /** Above this many pending paths, ask for a full scan instead. */
  maxPaths?: number;
}

export class VaultWatcher {
  private w: FSWatcher | null = null;
  private pending = new Set<string>();
  private overflow = false;
  private timer: NodeJS.Timeout | null = null;
  private firstAt = 0;
  private retry: NodeJS.Timeout | null = null;

  constructor(
    private readonly root: string,
    private readonly ignore: IgnoreOptions,
    private readonly onChange: (paths: Set<string> | null) => void,
    private readonly opts: WatcherOptions = {},
  ) {}

  get active(): boolean {
    return this.w !== null;
  }

  start(): void {
    if (this.w) return;
    try {
      this.w = watch(this.root, { recursive: true, persistent: false }, (_ev, name) => this.event(name ? String(name) : null));
      this.w.on('error', () => this.restart());
    } catch {
      this.w = null;
      this.retry = setTimeout(() => this.start(), 10_000);
      this.retry.unref?.();
    }
  }

  private restart(): void {
    this.stopWatch();
    this.overflow = true;
    this.flushSoon();
    this.retry = setTimeout(() => this.start(), 5_000);
    this.retry.unref?.();
  }

  private event(name: string | null): void {
    if (name === null) this.overflow = true;
    else {
      const p = toPosix(name).replace(/^\/+|\/+$/g, '');
      if (!p || isIgnored(p, this.ignore)) return;
      this.pending.add(p);
      if (this.pending.size > (this.opts.maxPaths ?? 2000)) this.overflow = true;
    }
    this.flushSoon();
  }

  private flushSoon(): void {
    const now = Date.now();
    if (!this.timer) this.firstAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.opts.debounceMs ?? 1500, this.firstAt + (this.opts.maxWaitMs ?? 10_000) - now));
    this.timer = setTimeout(() => this.flush(), wait);
    this.timer.unref?.();
  }

  private flush(): void {
    this.timer = null;
    const paths = this.overflow ? null : this.pending;
    this.pending = new Set();
    this.overflow = false;
    this.onChange(paths);
  }

  private stopWatch(): void {
    try {
      this.w?.close();
    } catch {
      /* ignore */
    }
    this.w = null;
  }

  stop(): void {
    this.stopWatch();
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = this.retry = null;
    this.pending.clear();
  }
}
