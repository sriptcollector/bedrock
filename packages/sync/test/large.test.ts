// Large attachments: chunked upload, killed mid-way, resumed by a fresh engine, verified by hash.

import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { setupEnv, type TestEnv } from './helpers.js';
import { hashFile } from '../src/chunker.js';
import { CHUNK_SIZE } from '../src/constants.js';

const LONG = !!process.env.BEDROCK_LONG_TESTS;
const MB = 1024 * 1024;

let env: TestEnv;
afterEach(async () => env?.close());

async function randomFile(path: string, size: number): Promise<string> {
  const fh = await open(path, 'w');
  const h = createHash('sha256');
  for (let o = 0; o < size; o += 4 * MB) {
    const b = randomBytes(Math.min(4 * MB, size - o));
    h.update(b);
    await fh.write(b);
  }
  await fh.close();
  return h.digest('hex');
}

describe('large attachments', () => {
  for (const sizeMb of LONG ? [50, 300] : [50]) {
    it(`${sizeMb} MB file: killed upload resumes, second device verifies by hash`, async () => {
      env = await setupEnv();
      const a = await env.device('A');
      const b = await env.device('B');
      const size = sizeMb * MB;
      const total = Math.ceil(size / CHUNK_SIZE);
      const hash = await randomFile(join(a.dir, `video ${sizeMb}.bin`), size);

      // first run: the "process dies" after a third of the chunk uploads
      let puts = 0;
      let dead = false;
      const killAfter = Math.floor(total / 3);
      const killer: typeof fetch = async (url, init) => {
        if (dead) throw new Error('process killed');
        if (init?.method === 'PUT' && String(url).includes('/v1/chunks/')) {
          if (++puts > killAfter) {
            dead = true;
            throw new Error('process killed');
          }
        }
        return fetch(url, init);
      };
      a.newEngine({ fetch: killer });
      const t0 = performance.now();
      const s1 = await a.engine.syncNow();
      expect(s1.state).toBe('offline');
      const storedAfterKill = env.server.stats.chunkPuts;
      expect(storedAfterKill).toBeGreaterThanOrEqual(killAfter);
      expect(storedAfterKill).toBeLessThan(total);

      // second run: a brand-new engine on the same state dir (like an app restart)
      a.newEngine();
      const s2 = await a.engine.syncNow();
      const upMs = performance.now() - t0;
      expect(s2.state).toBe('synced');
      const resumedChunks = a.engine.api.stats.chunksUp;
      expect(resumedChunks).toBe(total - storedAfterKill); // only the missing chunks were sent again

      const t1 = performance.now();
      const s3 = await b.engine.syncNow();
      const downMs = performance.now() - t1;
      expect(s3.state).toBe('synced');
      const got = await hashFile(join(b.dir, `video ${sizeMb}.bin`));
      expect(got).toEqual({ hash, size });
      console.log(
        `large: ${sizeMb} MB (${total} chunks): killed after ${storedAfterKill} chunks, resumed with ${resumedChunks}; ` +
          `upload total ${(upMs / 1000).toFixed(1)} s, download ${(downMs / 1000).toFixed(1)} s, rss ${(process.memoryUsage().rss / MB).toFixed(0)} MB`,
      );
    });
  }
});
