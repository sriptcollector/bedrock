import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StateStore, type FileRecord } from '../src/state.js';
import { tempDir } from './helpers.js';

const rec = (i: number): FileRecord => ({ id: `id-${i}`, kind: 'file', v: 1, sp: `n/${i}.md`, sh: 'h', sd: false, lp: `n/${i}.md`, lh: 'h', ld: false, lm: 1, ls: 2 });

describe('state persistence', () => {
  it('saves atomically and reloads 10k records quickly', async () => {
    const dir = await tempDir('state');
    const s = new StateStore(dir);
    await s.load();
    for (let i = 0; i < 10_000; i++) s.put(rec(i));
    s.data.lastSeq = 42;
    let t = performance.now();
    await s.save();
    const saveMs = performance.now() - t;
    const s2 = new StateStore(dir);
    t = performance.now();
    await s2.load();
    const loadMs = performance.now() - t;
    expect(s2.data.lastSeq).toBe(42);
    expect(s2.all().length).toBe(10_000);
    expect(s2.byLocalPath('N/5.MD')?.id).toBe('id-5');
    console.log(`state: save 10k records ${saveMs.toFixed(0)} ms, load ${loadMs.toFixed(0)} ms`);
    expect(saveMs).toBeLessThan(2000);
  });
  it('keeps the path index in sync with updates and removals', async () => {
    const s = new StateStore(await tempDir('state'));
    await s.load();
    const r = rec(1);
    s.put(r);
    s.update(r, { lp: 'm/1.md' });
    expect(s.byLocalPath('n/1.md')).toBeUndefined();
    expect(s.byLocalPath('M/1.md')?.id).toBe('id-1');
    s.update(r, { ld: true });
    expect(s.byLocalPath('m/1.md')).toBeUndefined();
    s.remove('id-1');
    expect(s.get('id-1')).toBeUndefined();
  });
  it('survives a corrupt state file', async () => {
    const dir = await tempDir('state');
    await writeFile(join(dir, 'sync-state.json'), '{not json');
    const s = new StateStore(dir);
    await s.load();
    expect(s.all()).toEqual([]);
    await s.save(true);
    expect(JSON.parse(await readFile(join(dir, 'sync-state.json'), 'utf8')).format).toBe(1);
  });
});
