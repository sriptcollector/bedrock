import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { CHUNK_SIZE } from './constants.js';

/** sha256 of a whole file, streamed. */
export async function hashFile(abs: string, knownSize?: number): Promise<{ hash: string; size: number }> {
  if (knownSize !== undefined && knownSize <= 1024 * 1024) {
    const data = await readFile(abs); // one read is much cheaper than a stream for small notes
    return { hash: createHash('sha256').update(data).digest('hex'), size: data.length };
  }
  const h = createHash('sha256');
  let size = 0;
  for await (const buf of createReadStream(abs, { highWaterMark: 1024 * 1024 })) {
    h.update(buf as Buffer);
    size += (buf as Buffer).length;
  }
  return { hash: h.digest('hex'), size };
}

/**
 * Reads a file as fixed-size chunks. Calls `onChunk` for each one in order (awaited, so callers can
 * upload as they go without holding the whole file in memory). Returns the whole-file hash and size.
 */
export async function forEachChunk(
  abs: string,
  onChunk: (data: Buffer, index: number, offset: number) => Promise<void> | void,
  chunkSize = CHUNK_SIZE,
): Promise<{ hash: string; size: number }> {
  const fh = await open(abs, 'r');
  const h = createHash('sha256');
  let offset = 0;
  let index = 0;
  try {
    for (;;) {
      const buf = Buffer.allocUnsafe(chunkSize);
      let n = 0;
      while (n < chunkSize) {
        const r = await fh.read(buf, n, chunkSize - n, offset + n);
        if (r.bytesRead === 0) break;
        n += r.bytesRead;
      }
      if (n === 0 && index > 0) break;
      const data = n === chunkSize ? buf : buf.subarray(0, n);
      h.update(data);
      await onChunk(data, index, offset);
      offset += n;
      index++;
      if (n < chunkSize) break;
    }
  } finally {
    await fh.close();
  }
  return { hash: h.digest('hex'), size: offset };
}

/** Splits an in-memory buffer the same way forEachChunk splits a file. */
export function splitChunks(data: Uint8Array, chunkSize = CHUNK_SIZE): Uint8Array[] {
  if (data.length === 0) return [data];
  const out: Uint8Array[] = [];
  for (let o = 0; o < data.length; o += chunkSize) out.push(data.subarray(o, Math.min(o + chunkSize, data.length)));
  return out;
}

/** Runs fn over items with at most `limit` in flight; results keep their order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
