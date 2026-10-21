// 10k-note vault: initial upload, second-device download, steady-state no-op sync.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setupEnv, type TestEnv } from './helpers.js';

const N = Number(process.env.BEDROCK_SCALE_NOTES ?? (process.env.BEDROCK_LONG_TESTS ? 10_000 : 2_000));

let env: TestEnv;
afterEach(async () => env?.close());

const time = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const r = await fn();
  return [r, performance.now() - t];
};

describe(`${N}-note vault`, () => {
  it('uploads, downloads and does no-op syncs fast', async () => {
    env = await setupEnv();
    const log = (m: string) => m.startsWith('cycle') && console.log(m);
    const a = await env.device('A', { log });
    const b = await env.device('B', { log });
    const body = (i: number) => `# Note ${i}\n\ntags: #t${i % 50}\n\n${'Lorem ipsum dolor sit amet, [[link]] consectetur. '.repeat(10 + (i % 40))}\nid ${i}\n`;
    let bytes = 0;
    const [, writeMs] = await time(async () => {
      for (let f = 0; f < 100; f++) await mkdir(join(a.dir, `folder ${f}`), { recursive: true });
      const batch: Promise<void>[] = [];
      for (let i = 0; i < N; i++) {
        const c = body(i);
        bytes += c.length;
        batch.push(writeFile(join(a.dir, `folder ${i % 100}`, `note ${i}.md`), c));
        if (batch.length >= 200) await Promise.all(batch.splice(0));
      }
      await Promise.all(batch);
    });
    const [s1, upMs] = await time(() => a.engine.syncNow());
    expect(s1.state).toBe('synced');
    const reqUp = a.engine.api.stats.requests;
    const [s2, downMs] = await time(() => b.engine.syncNow());
    expect(s2.state).toBe('synced');
    const reqDown = b.engine.api.stats.requests;
    expect(await readFile(join(b.dir, 'folder 7', 'note 7.md'), 'utf8')).toBe(body(7));
    const [, noopA] = await time(() => a.engine.syncNow());
    const [, noopB] = await time(() => b.engine.syncNow());
    const reqNoop = b.engine.api.stats.requests - reqDown;
    await writeFile(join(a.dir, 'folder 3', 'note 3.md'), body(3) + 'edited\n');
    const [, oneEditA] = await time(() => a.engine.syncNow());
    const [, oneEditB] = await time(() => b.engine.syncNow());
    expect(await readFile(join(b.dir, 'folder 3', 'note 3.md'), 'utf8')).toBe(body(3) + 'edited\n');
    const mb = (bytes / 1024 / 1024).toFixed(1);
    console.log(
      [
        `scale: ${N} notes, ${mb} MB (writing them to disk took ${(writeMs / 1000).toFixed(1)} s)`,
        `  initial upload (device A):   ${(upMs / 1000).toFixed(1)} s, ${reqUp} HTTP requests`,
        `  initial download (device B): ${(downMs / 1000).toFixed(1)} s, ${reqDown} HTTP requests`,
        `  no-op sync, full rescan:     A ${noopA.toFixed(0)} ms, B ${noopB.toFixed(0)} ms (${reqNoop} request)`,
        `  one edited note:             push ${oneEditA.toFixed(0)} ms, pull ${oneEditB.toFixed(0)} ms`,
      ].join('\n'),
    );
  });
});
