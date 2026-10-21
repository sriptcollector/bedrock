import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { chunkId, decryptChunk, decryptMeta, deriveKeys, encryptChunk, encryptMeta, generateVaultKey } from '../src/crypto.js';
import { splitChunks } from '../src/chunker.js';

describe('crypto', () => {
  const keys = deriveKeys(generateVaultKey());

  it('derives distinct subkeys and a stable key check', () => {
    const k = generateVaultKey();
    const a = deriveKeys(k);
    const b = deriveKeys(k);
    expect(a.keyCheck).toBe(b.keyCheck);
    expect(a.meta.equals(a.chunk)).toBe(false);
    expect(a.chunk.equals(a.id)).toBe(false);
    expect(deriveKeys(generateVaultKey()).keyCheck).not.toBe(a.keyCheck);
    expect(() => deriveKeys(new Uint8Array(16))).toThrow();
  });

  it('round-trips chunks, including empty and 4 MB', () => {
    for (const size of [0, 1, 1000, 4 * 1024 * 1024]) {
      const data = randomBytes(size);
      const id = chunkId(keys, data);
      const enc = encryptChunk(keys, id, data);
      expect(enc.length).toBe(size + 28);
      expect(decryptChunk(keys, id, enc).equals(data)).toBe(true);
    }
  });

  it('chunk ids are deterministic per vault and differ across vaults', () => {
    const data = Buffer.from('hello');
    expect(chunkId(keys, data)).toBe(chunkId(keys, data));
    expect(chunkId(deriveKeys(generateVaultKey()), data)).not.toBe(chunkId(keys, data));
  });

  it('rejects tampering, swapped ids and wrong keys', () => {
    const a = Buffer.from('note a');
    const b = Buffer.from('note b');
    const ida = chunkId(keys, a);
    const idb = chunkId(keys, b);
    const enc = encryptChunk(keys, ida, a);
    const bad = Buffer.from(enc);
    bad[20] ^= 1;
    expect(() => decryptChunk(keys, ida, bad)).toThrow(/decrypt/);
    expect(() => decryptChunk(keys, idb, enc)).toThrow();
    expect(() => decryptChunk(deriveKeys(generateVaultKey()), ida, enc)).toThrow();
  });

  it('encrypts metadata bound to the file id; same input gives different ciphertext', () => {
    const meta = { path: 'Notes/Ünïcødé 🚀.md', kind: 'file' as const, size: 5, mtime: 1, ctime: 1, hash: 'ab', device: 'Laptop' };
    const e1 = encryptMeta(keys, 'file-1', meta);
    const e2 = encryptMeta(keys, 'file-1', meta);
    expect(e1).not.toBe(e2);
    expect(decryptMeta(keys, 'file-1', e1)).toEqual(meta);
    expect(() => decryptMeta(keys, 'file-2', e1)).toThrow();
    expect(e1).not.toContain('Notes');
  });
});

describe('chunking', () => {
  it('splits at 4 MB boundaries', () => {
    const MB = 1024 * 1024;
    expect(splitChunks(Buffer.alloc(0)).length).toBe(1);
    expect(splitChunks(Buffer.alloc(4 * MB)).length).toBe(1);
    expect(splitChunks(Buffer.alloc(4 * MB + 1)).map((c) => c.length)).toEqual([4 * MB, 1]);
    expect(splitChunks(Buffer.alloc(10 * MB)).map((c) => c.length)).toEqual([4 * MB, 4 * MB, 2 * MB]);
  });
});
