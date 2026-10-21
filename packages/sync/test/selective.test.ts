// Selective sync (exclude), version contents and the empty-vault guard.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setupEnv, type TestEnv } from './helpers.js';
import { EMPTY_VAULT_MESSAGE } from '../src/engine.js';

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const w = async (dir: string, rel: string, content: string | Buffer) => {
  await mkdir(join(dir, rel, '..'), { recursive: true });
  await writeFile(join(dir, rel), content);
};
const r = (dir: string, rel: string) => readFile(join(dir, rel), 'utf8');
const noImages = (p: string) => /\.png$/i.test(p);

describe('selective sync', () => {
  it('excluded files are not uploaded or downloaded, and excluding never deletes', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    const b = await env.device('B', { exclude: noImages });
    await w(a.dir, 'note.md', 'hello');
    await w(a.dir, 'pic.png', 'PNG1');
    await w(b.dir, 'local.png', 'only on B');
    await w(b.dir, 'Private/secret.md', 'not for the server');
    b.engine.setExclude((p) => noImages(p) || p === 'Private' || p.startsWith('Private/'));
    for (const d of [a, b, a]) expect((await d.engine.syncNow()).state).toBe('synced');
    expect(await r(b.dir, 'note.md')).toBe('hello');
    expect(existsSync(join(b.dir, 'pic.png'))).toBe(false);
    expect(existsSync(join(a.dir, 'local.png'))).toBe(false);
    expect(existsSync(join(a.dir, 'Private/secret.md'))).toBe(false);

    // A excludes images after they were synced: nothing is deleted anywhere
    const c = await env.device('C');
    await c.engine.syncNow();
    expect(await r(c.dir, 'pic.png')).toBe('PNG1');
    c.engine.setExclude(noImages);
    await c.engine.syncNow();
    await a.engine.syncNow();
    expect(await r(a.dir, 'pic.png')).toBe('PNG1');
    expect(await r(c.dir, 'pic.png')).toBe('PNG1');
    // ...and C neither pushes its edits to the excluded file nor receives A's
    await w(c.dir, 'pic.png', 'PNG-C');
    await w(a.dir, 'pic.png', 'PNG-A');
    await c.engine.syncNow();
    await a.engine.syncNow();
    await c.engine.syncNow();
    expect(await r(a.dir, 'pic.png')).toBe('PNG-A');
    expect(await r(c.dir, 'pic.png')).toBe('PNG-C');

    // B includes images again: the server's images arrive, its local one uploads
    b.engine.setExclude(undefined);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(await r(b.dir, 'pic.png')).toBe('PNG-A');
    expect(await r(a.dir, 'local.png')).toBe('only on B');
    expect(await r(a.dir, 'Private/secret.md')).toBe('not for the server');
  });

  it('versionContent returns old versions', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    await w(a.dir, 'n.md', 'one');
    await a.engine.syncNow();
    await w(a.dir, 'n.md', 'two');
    await a.engine.syncNow();
    const v = await a.engine.listVersions('n.md');
    expect(v.map((x) => x.version)).toEqual([2, 1]);
    expect((await a.engine.versionContent('n.md', 1)).toString()).toBe('one');
    await unlink(join(a.dir, 'n.md'));
    await a.engine.syncNow();
    const trash = await a.engine.listTrash();
    expect((await a.engine.trashContent(trash[0].fileId)).toString()).toBe('two');
  });

  it('an emptied or missing vault folder pauses instead of deleting everywhere', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    const b = await env.device('B');
    for (let i = 0; i < 4; i++) await w(a.dir, `n${i}.md`, `note ${i}`);
    await a.engine.syncNow();
    await b.engine.syncNow();
    for (let i = 0; i < 4; i++) await unlink(join(a.dir, `n${i}.md`));
    let s = await a.engine.syncNow();
    expect(s.state).toBe('error');
    expect(s.message).toContain(EMPTY_VAULT_MESSAGE);
    await rm(a.dir, { recursive: true, force: true });
    s = await a.engine.syncNow();
    expect(s.state).toBe('error');
    await b.engine.syncNow();
    expect(await r(b.dir, 'n3.md')).toBe('note 3');
    // a deliberate delete of a few notes still syncs
    await unlink(join(b.dir, 'n0.md'));
    expect((await b.engine.syncNow()).state).toBe('synced');
    expect((await b.engine.listTrash()).length).toBe(1);
  });
});
