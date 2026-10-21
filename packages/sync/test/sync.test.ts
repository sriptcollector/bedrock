import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket as WsWebSocket } from 'ws';
import { readTree, settle, setupEnv, sleep, treeDiff, type TestEnv } from './helpers.js';
import { generateVaultKey } from '../src/crypto.js';

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

const w = async (dir: string, rel: string, content: string | Buffer) => {
  await mkdir(join(dir, rel, '..'), { recursive: true });
  await writeFile(join(dir, rel), content);
};
const r = (dir: string, rel: string) => readFile(join(dir, rel), 'utf8');

async function expectConverged(dirs: string[]) {
  const trees = await Promise.all(dirs.map((d) => readTree(d)));
  for (const t of trees.slice(1)) expect(treeDiff(trees[0], t)).toEqual([]);
  return trees[0];
}

describe('sync between devices', () => {
  it('uploads, downloads, renames, deletes and syncs empty folders', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    const b = await env.device('B');
    await w(a.dir, 'Welcome.md', '# Hi\n');
    await w(a.dir, 'Folder/Sub/note.md', 'deep');
    await w(a.dir, 'img.bin', Buffer.from([0, 1, 2, 255]));
    await mkdir(join(a.dir, 'Empty'));
    await w(a.dir, '.obsidian/app.json', '{}');
    await w(a.dir, '.obsidian/workspace.json', '{"local":true}');
    await settle([a, b]);
    expect(await r(b.dir, 'Folder/Sub/note.md')).toBe('deep');
    expect(existsSync(join(b.dir, 'Empty'))).toBe(true);
    expect(existsSync(join(b.dir, '.obsidian/workspace.json'))).toBe(false);
    expect(await r(b.dir, '.obsidian/app.json')).toBe('{}');

    // rename + move + delete on B
    await rename(join(b.dir, 'Welcome.md'), join(b.dir, 'Start here.md'));
    await rename(join(b.dir, 'Folder'), join(b.dir, 'Renamed folder'));
    await unlink(join(b.dir, 'img.bin'));
    const before = env.server.stats.chunkPuts;
    await settle([b, a]);
    expect(env.server.stats.chunkPuts).toBe(before); // renames reuse chunks, nothing re-uploaded
    const t = await expectConverged([a.dir, b.dir]);
    expect([...t.keys()].sort()).toEqual(['.obsidian/app.json', 'Empty/', 'Renamed folder/Sub/note.md', 'Start here.md']);
    // history survives the rename: same file id, 2 versions
    const versions = await a.engine.listVersions('Start here.md');
    expect(versions.map((v) => v.path)).toEqual(['Start here.md', 'Welcome.md']);
  });

  it('offline edits to different notes on 3 devices converge', async () => {
    env = await setupEnv();
    const devs = [await env.device('A'), await env.device('B'), await env.device('C')];
    for (let i = 0; i < 9; i++) await w(devs[0].dir, `n${i}.md`, `note ${i}\n`);
    await settle(devs);
    await env.stopServer(); // everyone offline
    for (let d = 0; d < 3; d++) {
      for (let i = d; i < 9; i += 3) await w(devs[d].dir, `n${i}.md`, `note ${i}\nedited on ${devs[d].name}\n`);
      await w(devs[d].dir, `new-${devs[d].name}.md`, `created offline on ${devs[d].name}`);
      const s = await devs[d].engine.syncNow();
      expect(s.state).toBe('offline');
      expect(s.message).toMatch(/Offline/);
    }
    await env.startServer();
    await settle(devs);
    const t = await expectConverged(devs.map((d) => d.dir));
    expect(t.size).toBe(12);
    for (let i = 0; i < 9; i++) expect(t.get(`n${i}.md`)).toBe(`note ${i}\nedited on ${devs[i % 3].name}\n`);
  });

  it('same note edited offline on 3 devices: separate lines merge cleanly', async () => {
    env = await setupEnv();
    const devs = [await env.device('A'), await env.device('B'), await env.device('C')];
    const base = ['# Title', '', 'para one', '', 'para two', '', 'para three', '', 'end'].join('\n');
    await w(devs[0].dir, 'shared.md', base);
    await settle(devs);
    const lines = base.split('\n');
    const edits = [
      [2, 'para one (A)'],
      [4, 'para two (B)'],
      [6, 'para three (C)'],
    ] as const;
    for (let d = 0; d < 3; d++) {
      const l = [...lines];
      l[edits[d][0]] = edits[d][1];
      await w(devs[d].dir, 'shared.md', l.join('\n'));
    }
    await settle(devs);
    const t = await expectConverged(devs.map((d) => d.dir));
    expect(t.get('shared.md')).toBe(['# Title', '', 'para one (A)', '', 'para two (B)', '', 'para three (C)', '', 'end'].join('\n'));
    expect([...t.keys()].filter((k) => k.includes('conflict'))).toEqual([]);
  });

  it('same line edited offline on 3 devices: one conflict copy per losing device, nothing lost', async () => {
    env = await setupEnv();
    const devs = [await env.device('A'), await env.device('B'), await env.device('C')];
    await w(devs[0].dir, 'plan.md', 'line 1\nthe plan\nline 3\n');
    await settle(devs);
    for (const d of devs) await w(d.dir, 'plan.md', `line 1\nthe plan by ${d.name}\nline 3\n`);
    await settle(devs);
    const t = await expectConverged(devs.map((d) => d.dir));
    const copies = [...t.keys()].filter((k) => k.startsWith('plan (conflict'));
    expect(copies.length).toBe(2);
    const all = [...t.values()].join('\n');
    for (const d of devs) expect(all).toContain(`the plan by ${d.name}`);
    expect(t.get('plan.md')).toMatch(/the plan by [ABC]/);
    expect(devs.reduce((n, d) => n + d.conflicts.length, 0)).toBe(2);
  });

  it('binary edited on two devices keeps both copies', async () => {
    env = await setupEnv();
    const [a, b] = [await env.device('A'), await env.device('B')];
    await w(a.dir, 'pic.png', Buffer.from('v1'));
    await settle([a, b]);
    await w(a.dir, 'pic.png', Buffer.from('v2-from-A'));
    await w(b.dir, 'pic.png', Buffer.from('v2-from-B'));
    await settle([a, b]);
    const t = await expectConverged([a.dir, b.dir]);
    expect([...t.values()].sort()).toEqual(['v2-from-A', 'v2-from-B']);
  });

  it('delete vs edit: the edit wins and the file comes back', async () => {
    env = await setupEnv();
    const [a, b] = [await env.device('A'), await env.device('B')];
    await w(a.dir, 'x.md', 'original');
    await w(a.dir, 'y.md', 'original y');
    await settle([a, b]);
    // A deletes x first, B edits it; for y the order is reversed (B edits and pushes first)
    await unlink(join(a.dir, 'x.md'));
    await w(b.dir, 'x.md', 'edited on B');
    await a.engine.syncNow();
    await b.engine.syncNow();
    await w(b.dir, 'y.md', 'edited y on B');
    await b.engine.syncNow();
    await unlink(join(a.dir, 'y.md'));
    await settle([a, b]);
    const t = await expectConverged([a.dir, b.dir]);
    expect(t.get('x.md')).toBe('edited on B');
    expect(t.get('y.md')).toBe('edited y on B');
  });

  it('the same new file created on two devices with identical content does not duplicate; different content keeps both', async () => {
    env = await setupEnv();
    const [a, b] = [await env.device('A'), await env.device('B')];
    await w(a.dir, 'Daily/2026-10-21.md', '# Daily template\n');
    await w(b.dir, 'Daily/2026-10-21.md', '# Daily template\n');
    await w(a.dir, 'Ideas.md', 'idea from A');
    await w(b.dir, 'Ideas.md', 'idea from B');
    await settle([a, b]);
    const t = await expectConverged([a.dir, b.dir]);
    expect([...t.keys()].filter((k) => k.startsWith('Daily/'))).toEqual(['Daily/2026-10-21.md']);
    expect([...t.entries()].filter(([k]) => k.startsWith('Ideas')).map(([, v]) => v).sort()).toEqual(['idea from A', 'idea from B']);
  });

  it('paths differing only by case never clobber each other', async () => {
    env = await setupEnv();
    const [a, b] = [await env.device('A'), await env.device('B')];
    // two devices create README.md and readme.md (as a Linux machine could); on Windows/macOS they would collide
    await w(a.dir, 'README.md', 'upper');
    await w(b.dir, 'readme.md', 'lower');
    await settle([a, b]);
    const t = await expectConverged([a.dir, b.dir]);
    expect([...t.values()].sort()).toEqual(['lower', 'upper']);
    const keys = [...t.keys()].map((k) => k.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('remote rename swap (a<->b) applies without clobbering', async () => {
    env = await setupEnv();
    const [a, b] = [await env.device('A'), await env.device('B')];
    await w(a.dir, 'a.md', 'content A');
    await w(a.dir, 'b.md', 'content B');
    await settle([a, b]);
    // A pushes the three renames in two steps; B receives them in one pull as a swap of two paths
    await rename(join(a.dir, 'a.md'), join(a.dir, 'tmp.md'));
    await a.engine.syncNow();
    await rename(join(a.dir, 'b.md'), join(a.dir, 'a.md'));
    await rename(join(a.dir, 'tmp.md'), join(a.dir, 'b.md'));
    await a.engine.syncNow();
    await settle([b, a]);
    expect(b.conflicts).toEqual([]);
    const t = await expectConverged([a.dir, b.dir]);
    expect(t.get('a.md')).toBe('content B');
    expect(t.get('b.md')).toBe('content A');
  });

  it('version history and restore', async () => {
    env = await setupEnv();
    const [a, b] = [await env.device('A'), await env.device('B')];
    await w(a.dir, 'doc.md', 'v1');
    await a.engine.syncNow();
    await w(a.dir, 'doc.md', 'v2');
    await a.engine.syncNow();
    await w(a.dir, 'doc.md', 'v3');
    await settle([a, b]);
    const vs = await b.engine.listVersions('doc.md');
    expect(vs.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(vs[0].current).toBe(true);
    expect(vs[2].device).toBe('A');
    await b.engine.restoreVersion('doc.md', 1);
    expect(await r(b.dir, 'doc.md')).toBe('v1');
    await settle([a, b]);
    expect(await r(a.dir, 'doc.md')).toBe('v1');
    expect((await a.engine.listVersions('doc.md')).length).toBe(4);
  });

  it('recycle bin: list and restore a deleted file', async () => {
    env = await setupEnv();
    const [a, b] = [await env.device('A'), await env.device('B')];
    await w(a.dir, 'notes/gone.md', 'precious');
    await settle([a, b]);
    await unlink(join(b.dir, 'notes/gone.md'));
    await settle([b, a]);
    expect(existsSync(join(a.dir, 'notes/gone.md'))).toBe(false);
    const trash = await a.engine.listTrash();
    expect(trash.map((x) => [x.path, x.restorable])).toEqual([['notes/gone.md', true]]);
    const restoredAt = await a.engine.restoreFromTrash(trash[0].fileId);
    expect(restoredAt).toBe('notes/gone.md');
    await settle([a, b]);
    expect(await r(b.dir, 'notes/gone.md')).toBe('precious');
    expect(await a.engine.listTrash()).toEqual([]);
  });

  it('quota exceeded gives a clear error; space comes back after emptying the recycle bin', async () => {
    env = await setupEnv({ quotaBytes: 300_000 });
    const a = await env.device('A');
    await w(a.dir, 'small.md', 'fits');
    await w(a.dir, 'big1.bin', Buffer.alloc(200_000, 1));
    let s = await a.engine.syncNow();
    expect(s.state).toBe('synced');
    await w(a.dir, 'big2.bin', Buffer.alloc(200_000, 2));
    s = await a.engine.syncNow();
    expect(s.state).toBe('error');
    expect(s.errorKind).toBe('quota');
    expect(s.message).toMatch(/vault is full/);
    await unlink(join(a.dir, 'big1.bin'));
    await a.engine.syncNow();
    const freed = await a.engine.emptyTrash();
    expect(freed.freedBytes).toBeGreaterThan(200_000);
    s = await a.engine.syncNow();
    expect(s.state).toBe('synced');
    expect((await a.engine.usage()).usedBytes).toBeLessThan(300_000);
  });

  it('expired token: plain error, then recovers when the token works again', async () => {
    env = await setupEnv({ devAuth: false });
    const a = await env.device('A');
    await w(a.dir, 'a.md', 'one');
    expect((await a.engine.syncNow()).state).toBe('synced');
    a.token.value = 'tok-expired';
    await w(a.dir, 'a.md', 'two');
    const s = await a.engine.syncNow();
    expect(s.state).toBe('error');
    expect(s.errorKind).toBe('auth');
    expect(s.message).toMatch(/sign-in has expired/i);
    a.token.value = 'tok-u1';
    expect((await a.engine.syncNow()).state).toBe('synced');
    const b = await env.device('B');
    await settle([a, b]);
    expect(await r(b.dir, 'a.md')).toBe('two');
  });

  it('server restart in the middle of a sync: the engine retries and finishes', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    const b = await env.device('B');
    for (let i = 0; i < 400; i++) await w(a.dir, `bulk/${i}.md`, `note ${i} `.repeat(200));
    a.newEngine({ watch: false });
    await a.engine.start();
    // restart the server while A is uploading
    await sleep(150);
    await env.restart();
    const deadline = Date.now() + 60_000;
    while (a.engine.status.state !== 'synced' && Date.now() < deadline) await sleep(100);
    expect(a.engine.status.state).toBe('synced');
    await a.engine.stop();
    await settle([a, b]);
    expect((await readTree(b.dir)).size).toBe(400);
  });

  it('a device with the wrong vault key is stopped with a clear message', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    await w(a.dir, 'a.md', 'x');
    await a.engine.syncNow();
    const b = await env.device('B', { getVaultKey: async () => generateVaultKey() });
    const s = await b.engine.syncNow();
    expect(s.state).toBe('error');
    expect(s.errorKind).toBe('key');
    expect(existsSync(join(b.dir, 'a.md'))).toBe(false);
  });

  it('live: websocket push + watcher sync a change without calling syncNow', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    const b = await env.device('B');
    a.newEngine({ watch: true, WebSocket: WsWebSocket as any, debounceMs: 100 });
    b.newEngine({ watch: true, WebSocket: WsWebSocket as any, debounceMs: 100 });
    await a.engine.start();
    await b.engine.start();
    const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 15_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await fn()) return true;
        await sleep(50);
      }
      return false;
    };
    expect(await waitFor(() => a.engine.status.state === 'synced' && b.engine.status.state === 'synced')).toBe(true);
    const t0 = Date.now();
    await w(a.dir, 'live.md', 'typed on A');
    expect(await waitFor(() => existsSync(join(b.dir, 'live.md')))).toBe(true);
    const latency = Date.now() - t0;
    console.log(`live: edit on A visible on B after ${latency} ms (watcher debounce 100 ms)`);
    // editor-style save: write temp then rename over the original
    await w(b.dir, 'live.md.tmp', 'saved via temp file on B');
    await rename(join(b.dir, 'live.md.tmp'), join(b.dir, 'live.md'));
    expect(await waitFor(async () => (await r(a.dir, 'live.md').catch(() => '')) === 'saved via temp file on B')).toBe(true);
    // folder rename picked up by the watcher
    await w(a.dir, 'F/one.md', '1');
    expect(await waitFor(() => existsSync(join(b.dir, 'F/one.md')))).toBe(true);
    await rename(join(a.dir, 'F'), join(a.dir, 'G'));
    expect(await waitFor(() => existsSync(join(b.dir, 'G/one.md')) && !existsSync(join(b.dir, 'F')))).toBe(true);
    expect((await readTree(b.dir)).size).toBe(2);
  });

  it('never overwrites a local edit typed while the download is in flight', async () => {
    env = await setupEnv();
    const a = await env.device('A');
    let armed = false;
    const b = await env.device('B', {
      fetch: async (url, init) => {
        const res = await fetch(url, init);
        if (armed && String(url).includes('/v1/chunks/fetch')) {
          armed = false;
          // the user types in the note on B after B scanned but before B writes the version from A
          await writeFile(join(b.dir, 'n.md'), 'one\ntwo\nthree\nfour\nFIVE typed during sync\n');
        }
        return res;
      },
    });
    await w(a.dir, 'n.md', 'one\ntwo\nthree\nfour\nfive\n');
    await settle([a, b]);
    await w(a.dir, 'n.md', 'ONE\ntwo\nthree\nfour\nfive\n');
    await a.engine.syncNow();
    armed = true;
    await b.engine.syncNow();
    expect(armed).toBe(false);
    expect(await r(b.dir, 'n.md')).toContain('FIVE typed during sync'); // not overwritten
    await settle([a, b]);
    const t = await expectConverged([a.dir, b.dir]);
    expect(t.get('n.md')).toBe('ONE\ntwo\nthree\nfour\nFIVE typed during sync\n'); // merged on the next pass
  });
});
