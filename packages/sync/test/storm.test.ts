// Rename/move storm: 3 devices, random renames, moves, folder renames, deletes, re-creates and
// edits, then synced. After every round all devices must hold identical trees, with no duplicated
// files and no lost content (every line a device wrote this round and still had when it synced
// must exist somewhere in the final tree).
//
// "offline" mode: all ops of a round happen with no syncing, then everyone syncs.
// "interleaved" mode: devices take turns doing one op at a time and sometimes sync mid-round.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readTree, settle, setupEnv, treeDiff, type Device, type TestEnv } from './helpers.js';

const LONG = !!process.env.BEDROCK_LONG_TESTS;
const ROUNDS = LONG ? 30 : 8;
const OPS = LONG ? 14 : 8;
const SEED = Number(process.env.BEDROCK_STORM_SEED ?? 1234);

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let env: TestEnv;
afterEach(async () => env?.close());

async function storm(mode: 'offline' | 'interleaved') {
  env = await setupEnv();
  const devs = [await env.device('A'), await env.device('B'), await env.device('C')];
  const rand = rng(SEED + (mode === 'interleaved' ? 7 : 0));
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
  let uniq = 0;
  const token = (d: Device, round: number) => `L-${d.name}-${round}-${uniq++}`;

  for (let i = 0; i < 24; i++) {
    await mkdir(join(devs[0].dir, `f${i % 4}`), { recursive: true });
    await writeFile(join(devs[0].dir, `f${i % 4}/note ${i}.md`), `# note ${i}\nseed line ${i}\n`);
  }
  await settle(devs);

  const stats = { edit: 0, replace: 0, create: 0, rename: 0, move: 0, folder: 0, delete: 0, recreate: 0, midSync: 0 };
  let totalConflicts = 0;
  const t0 = performance.now();
  for (let round = 1; round <= ROUNDS; round++) {
    const introduced = new Map<string, Set<string>>(devs.map((d) => [d.name, new Set<string>()]));
    const deleted = new Map<string, string[]>(devs.map((d) => [d.name, []]));
    // a line written this round by another device must not be removed by us (that would be a legitimate loss)
    const foreign = (d: Device) => new RegExp(`^L-(?!${d.name}-)[A-Z]-${round}-\\d+$`);

    const doOp = async (d: Device) => {
      const mine = introduced.get(d.name)!;
      const del = deleted.get(d.name)!;
      const tree = await readTree(d.dir);
      const files = [...tree.keys()].filter((p) => !p.endsWith('/'));
      const folders = [...new Set(files.filter((f) => f.includes('/')).map((p) => p.split('/')[0]))];
      const op = pick(['edit', 'edit', 'replace', 'create', 'rename', 'move', 'folder', 'delete', 'recreate'] as const);
      try {
        if ((op === 'edit' || op === 'replace') && files.length) {
          const f = pick(files);
          const lines = (await readFile(join(d.dir, f), 'utf8')).split('\n');
          const t = token(d, round);
          const replaceable = lines.map((l, i) => i).filter((i) => i > 0 && i < lines.length - 1 && !foreign(d).test(lines[i]));
          if (op === 'edit' || !replaceable.length) lines.splice(lines.length - 1, 0, t);
          else lines[pick(replaceable)] = t;
          await writeFile(join(d.dir, f), lines.join('\n'));
          mine.add(t);
        } else if (op === 'create' || (op === 'recreate' && !del.length)) {
          const dir = pick(['f0', 'f1', 'f2', 'f3', 'misc']);
          await mkdir(join(d.dir, dir), { recursive: true });
          const t = token(d, round);
          await writeFile(join(d.dir, `${dir}/new ${t}.md`), `${t}\n`);
          mine.add(t);
        } else if (op === 'recreate') {
          const p = del.pop()!;
          await mkdir(join(d.dir, p, '..'), { recursive: true });
          const t = token(d, round);
          await writeFile(join(d.dir, p), `recreated\n${t}\n`, { flag: 'wx' });
          mine.add(t);
        } else if (op === 'rename' && files.length) {
          const f = pick(files);
          const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
          await rename(join(d.dir, f), join(d.dir, `${dir}renamed ${uniq++}.md`));
        } else if (op === 'move' && files.length) {
          const f = pick(files);
          const to = pick(['f0', 'f1', 'f2', 'f3', 'misc']);
          await mkdir(join(d.dir, to), { recursive: true });
          await rename(join(d.dir, f), join(d.dir, to, `${f.split('/').pop()!.replace('.md', '')} m${uniq++}.md`));
        } else if (op === 'folder' && folders.length) {
          const f = pick(folders);
          await rename(join(d.dir, f), join(d.dir, `${f.split(' ')[0]} r${uniq++}`));
        } else if (op === 'delete' && files.length > 5) {
          const f = pick(files);
          const body = tree.get(f)!;
          if (body.split('\n').some((l) => foreign(d).test(l))) return;
          await unlink(join(d.dir, f));
          del.push(f);
        } else return;
        stats[op]++;
      } catch {
        /* op not possible right now (path vanished, name taken); skip */
      }
    };

    if (mode === 'offline') {
      for (const d of devs) for (let k = 0; k < OPS; k++) await doOp(d);
    } else {
      for (let k = 0; k < OPS; k++)
        for (const d of devs) {
          await doOp(d);
          if (rand() < 0.2) {
            const s = await d.engine.syncNow();
            expect(s.state, s.message).toBe('synced');
            stats.midSync++;
          }
        }
    }

    // lines each device wrote this round and still has when it syncs
    const expected = new Set<string>();
    for (const d of devs) {
      const lines = new Set([...(await readTree(d.dir)).values()].flatMap((v) => v.split('\n')));
      for (const t of introduced.get(d.name)!) if (lines.has(t)) expected.add(t);
    }
    const before = devs.reduce((n, d) => n + d.conflicts.length, 0);
    await settle(devs, 10);
    totalConflicts += devs.reduce((n, d) => n + d.conflicts.length, 0) - before;
    const trees = await Promise.all(devs.map((d) => readTree(d.dir)));
    for (const t of trees.slice(1)) expect(treeDiff(trees[0], t)).toEqual([]);
    const contents = [...trees[0].entries()].filter(([k]) => !k.endsWith('/')).map(([, v]) => v);
    const finalLines = new Set(contents.flatMap((v) => v.split('\n')));
    const lost = [...expected].filter((t) => !finalLines.has(t));
    expect(lost, `round ${round}: lost lines`).toEqual([]);
    const dupes = contents.filter((c, i) => contents.indexOf(c) !== i);
    expect(dupes, `round ${round}: duplicated files`).toEqual([]);
    for (const d of devs) expect(d.engine.status.pendingUploads).toBe(0);
  }
  const ms = performance.now() - t0;
  const finalTree = await readTree(devs[0].dir);
  console.log(
    `storm (${mode}, seed ${SEED}): ${ROUNDS} rounds x ${OPS} ops x 3 devices, ${JSON.stringify(stats)}, ` +
      `final ${finalTree.size} entries, ${totalConflicts} conflict copies, ${(ms / 1000).toFixed(1)} s`,
  );
}

describe('rename/move storm', () => {
  const timeout = LONG ? 900_000 : 180_000;
  it(`offline rounds: ${ROUNDS} x ${OPS} ops on 3 devices converge, no duplicates, no lost lines`, () => storm('offline'), timeout);
  it(`interleaved with mid-round syncs: ${ROUNDS} x ${OPS} ops on 3 devices`, () => storm('interleaved'), timeout);
});
