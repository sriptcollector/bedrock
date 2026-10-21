import { describe, expect, it } from 'vitest';
import { lcsMatches, merge3, mergeText } from '../src/diff3.js';
import { mergeFile, mergeJsonText } from '../src/merge.js';

const L = (s: string) => s.split('\n');

describe('lcs', () => {
  it('finds a longest common subsequence', () => {
    const m = lcsMatches([1, 2, 3, 4, 5], [1, 3, 4, 6, 5]);
    expect(m).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
      [4, 4],
    ]);
    expect(lcsMatches([], [1])).toEqual([]);
  });
});

describe('merge3', () => {
  const base = 'a\nb\nc\nd\ne\nf\ng';
  it('merges non-overlapping edits cleanly', () => {
    const r = mergeText(base, 'A\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nd\ne\nf\nG');
    expect(r).toEqual({ clean: true, text: 'A\nb\nc\nd\ne\nf\nG' });
  });
  it('takes one side when the other did not change', () => {
    expect(mergeText(base, base, 'x').text).toBe('x');
    expect(mergeText(base, 'y', base).text).toBe('y');
  });
  it('same change on both sides is clean', () => {
    expect(mergeText(base, 'a\nB\nc\nd\ne\nf\ng', 'a\nB\nc\nd\ne\nf\ng')).toEqual({ clean: true, text: 'a\nB\nc\nd\ne\nf\ng' });
  });
  it('overlapping edits conflict', () => {
    expect(mergeText(base, 'a\nX\nc\nd\ne\nf\ng', 'a\nY\nc\nd\ne\nf\ng').clean).toBe(false);
    expect(merge3(L('a\nb'), L('a\nb1'), L('a\nb2')).conflicts).toBe(1);
  });
  it('deletion vs edit of the same line conflicts', () => {
    expect(mergeText(base, 'a\nc\nd\ne\nf\ng', 'a\nB\nc\nd\ne\nf\ng').clean).toBe(false);
  });
  it('insertions at the same place on both sides are kept (ours first)', () => {
    const r = mergeText('one\ntwo\n', 'one\ntwo\nfrom laptop\n', 'one\ntwo\nfrom desktop\n');
    expect(r).toEqual({ clean: true, text: 'one\ntwo\nfrom laptop\nfrom desktop\n' });
  });
  it('appends where one is a prefix of the other do not duplicate', () => {
    const r = mergeText('x\n', 'x\nl1\n', 'x\nl1\nl2\n');
    expect(r).toEqual({ clean: true, text: 'x\nl1\nl2\n' });
  });
  it('handles CRLF vs LF (keeps our line endings)', () => {
    const b = 'a\nb\nc\nd\ne';
    const ours = 'A\r\nb\r\nc\r\nd\r\ne';
    const theirs = 'a\nb\nc\nd\nE';
    expect(mergeText(b, ours, theirs)).toEqual({ clean: true, text: 'A\r\nb\r\nc\r\nd\r\nE' });
  });
  it('handles unicode and BOM', () => {
    const b = '﻿# Café\n日本語\n\n🚀 rocket\nend';
    const ours = '﻿# Café ☕\n日本語\n\n🚀 rocket\nend';
    const theirs = '# Café\n日本語\n\n🚀 rocket ship\nend';
    expect(mergeText(b, ours, theirs)).toEqual({ clean: true, text: '﻿# Café ☕\n日本語\n\n🚀 rocket ship\nend' });
  });
  it('empty base: both added different text -> conflict; one side empty -> other side', () => {
    expect(mergeText('', 'hello', 'world').clean).toBe(false);
    expect(mergeText('', '', 'world')).toEqual({ clean: true, text: 'world' });
    expect(mergeText('', 'a\nb\n', 'a\nb\n').clean).toBe(true);
  });
  it('large files with scattered edits merge', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const ours = [...lines];
    const theirs = [...lines];
    for (let i = 0; i < 5000; i += 100) ours[i] = `ours ${i}`;
    for (let i = 50; i < 5000; i += 100) theirs[i] = `theirs ${i}`;
    const r = mergeText(lines.join('\n'), ours.join('\n'), theirs.join('\n'));
    expect(r.clean).toBe(true);
    expect(r.text.split('\n').filter((l) => l.startsWith('ours')).length).toBe(50);
    expect(r.text.split('\n').filter((l) => l.startsWith('theirs')).length).toBe(50);
  });
});

describe('mergeFile', () => {
  it('refuses binary and missing base', () => {
    expect(mergeFile('a.png', Buffer.from('x'), Buffer.from('y'), Buffer.from('z'), true).clean).toBe(false);
    expect(mergeFile('a.md', null, Buffer.from('y'), Buffer.from('z'), true).clean).toBe(false);
    expect(mergeFile('a.md', Buffer.from([0xff, 0xfe, 0x00]), Buffer.from('y'), Buffer.from('z'), true).clean).toBe(false);
  });
  it('merges .obsidian json per key, newer side wins a key changed on both', () => {
    const base = JSON.stringify({ theme: 'obsidian', fontSize: 16, a: 1 }, null, 2);
    const ours = JSON.stringify({ theme: 'moonstone', fontSize: 16, a: 1, mine: true }, null, 2);
    const theirs = JSON.stringify({ theme: 'obsidian', fontSize: 18, b: 2 }, null, 2);
    const r = JSON.parse(mergeJsonText(base, ours, theirs, true)!);
    expect(r).toEqual({ theme: 'moonstone', fontSize: 18, mine: true, b: 2 });
    const both = JSON.parse(mergeJsonText(base, JSON.stringify({ theme: 'x' }), JSON.stringify({ theme: 'y' }), false)!);
    expect(both.theme).toBe('y');
    const m = mergeFile('.obsidian/app.json', Buffer.from(base), Buffer.from(ours), Buffer.from(theirs), true);
    expect(m.clean).toBe(true);
  });
});
