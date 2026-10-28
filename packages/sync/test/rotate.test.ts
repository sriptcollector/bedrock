// Vault key rotation: data synced under an old (exposed) key moves to a new key, and the old key
// can no longer read anything on the server.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readTree, settle, setupEnv, tempDir, treeDiff, type TestEnv } from './helpers.js';
import { generateVaultKey, deriveKeys } from '../src/crypto.js';
import { rotateVault } from '../src/rotate.js';
import { SyncApi } from '../src/api.js';

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const w = async (dir: string, rel: string, content: string | Buffer) => {
  await mkdir(join(dir, rel, '..'), { recursive: true });
  await writeFile(join(dir, rel), content);
};

describe('vault key rotation', () => {
  it('re-encrypts everything under the new key; other computers follow once they have it', async () => {
    env = await setupEnv();
    const oldKey = env.key;
    const a = await env.device('A');
    const b = await env.device('B');
    await w(a.dir, 'note.md', 'hello');
    await w(a.dir, 'Folder/deep.md', 'deep');
    await w(a.dir, 'big.bin', Buffer.alloc(9 * 1024 * 1024, 7)); // several chunks
    await w(b.dir, 'Private/only-remote-for-A.md', 'kept even though A leaves this folder out');
    await settle([a, b]);
    a.engine.setExclude((p) => p === 'Private' || p.startsWith('Private/'));
    const before = await readTree(b.dir);

    const newKey = generateVaultKey();
    const api = new SyncApi(env.server.url, async () => 'tok-u1');
    const staging = join(await tempDir('rot'), 'staging');
    const r = await rotateVault({ api, newKey, oldKeys: [oldKey], stagingDir: staging, deviceId: 'dev-A' });
    expect(r.action).toBe('reencrypted');
    expect(r.files).toBeGreaterThanOrEqual(4);
    expect(existsSync(staging)).toBe(false);
    const v = await api.vault();
    expect(v.keyCheck).toBe(deriveKeys(newKey).keyCheck);

    // the old key is refused by the vault now
    b.newEngine();
    const stale = await b.engine.syncNow();
    expect(stale.state).toBe('error');
    expect(stale.errorKind).toBe('key');

    // both computers on the new key: same files, no conflict copies
    for (const d of [a, b]) d.newEngine({ getVaultKey: async () => newKey });
    a.engine.setExclude((p) => p === 'Private' || p.startsWith('Private/'));
    await settle([a, b]);
    expect(treeDiff(await readTree(b.dir), before)).toEqual([]);
    expect(a.conflicts).toEqual([]);
    expect(b.conflicts).toEqual([]);
    // a third computer gets everything, including the folder A leaves out
    const c = await env.device('C', { getVaultKey: async () => newKey });
    await c.engine.syncNow();
    expect(await readFile(join(c.dir, 'Private/only-remote-for-A.md'), 'utf8')).toBe('kept even though A leaves this folder out');
    expect((await readFile(join(c.dir, 'big.bin'))).equals(Buffer.alloc(9 * 1024 * 1024, 7))).toBe(true);
  }, 60_000);

  it('without the old key the vault restarts empty and computers upload their own files again', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    await w(a.dir, 'note.md', 'hello');
    await a.engine.syncNow();
    const newKey = generateVaultKey();
    const api = new SyncApi(env.server.url, async () => 'tok-u1');
    const r = await rotateVault({ api, newKey, oldKeys: [], stagingDir: join(await tempDir('rot'), 's'), deviceId: 'dev-A' });
    expect(r.action).toBe('restarted');
    expect((await api.vault()).seq).toBe(0);
    a.newEngine({ getVaultKey: async () => newKey });
    expect((await a.engine.syncNow()).state).toBe('synced');
    expect(await readFile(join(a.dir, 'note.md'), 'utf8')).toBe('hello');
    const b = await env.device('B', { getVaultKey: async () => newKey });
    await b.engine.syncNow();
    expect(await readFile(join(b.dir, 'note.md'), 'utf8')).toBe('hello');
  }, 30_000);

  it('resumes after a failure between rekey and upload; a second run is a no-op', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    for (let i = 0; i < 5; i++) await w(a.dir, `n${i}.md`, `note ${i}`);
    await a.engine.syncNow();
    const newKey = generateVaultKey();
    const staging = join(await tempDir('rot'), 's');
    let commits = 0;
    const flaky: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/v1/commit') && ++commits === 3) throw new Error('connection lost');
      return fetch(url, init);
    };
    const api = new SyncApi(env.server.url, async () => 'tok-u1', flaky);
    await expect(rotateVault({ api, newKey, oldKeys: [env.key], stagingDir: staging, deviceId: 'dev-A' })).rejects.toThrow();
    expect(existsSync(join(staging, 'journal.json'))).toBe(true);
    const r = await rotateVault({ api, newKey, oldKeys: [env.key], stagingDir: staging, deviceId: 'dev-A' });
    expect(r.files).toBe(5);
    expect((await rotateVault({ api, newKey, oldKeys: [env.key], stagingDir: staging, deviceId: 'dev-A' })).action).toBe('none');
    const b = await env.device('B', { getVaultKey: async () => newKey });
    await b.engine.syncNow();
    for (let i = 0; i < 5; i++) expect(await readFile(join(b.dir, `n${i}.md`), 'utf8')).toBe(`note ${i}`);
  }, 30_000);

  it('refuses to wipe a vault whose key changed meanwhile', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    await w(a.dir, 'note.md', 'x');
    await a.engine.syncNow();
    const api = new SyncApi(env.server.url, async () => 'tok-u1');
    await expect(api.rekey('0'.repeat(32), deriveKeys(generateVaultKey()).keyCheck)).rejects.toMatchObject({ status: 409 });
    expect((await api.vault()).seq).toBeGreaterThan(0);
  });
});
