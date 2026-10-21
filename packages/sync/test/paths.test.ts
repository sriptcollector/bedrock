import { describe, expect, it } from 'vitest';
import { conflictPath, pathKey, safePath, isUnder } from '../src/paths.js';
import { isIgnored } from '../src/ignore.js';

describe('paths', () => {
  it('collision key ignores case and unicode normalization', () => {
    expect(pathKey('Notes/Readme.md')).toBe(pathKey('notes/README.md'));
    expect(pathKey('Café.md')).toBe(pathKey('Café.md'));
    expect(pathKey('a.md')).not.toBe(pathKey('b.md'));
  });
  it('makes remote paths safe on every OS', () => {
    expect(safePath('../../etc/passwd')).toBe('etc/passwd');
    expect(safePath('/abs/x.md')).toBe('abs/x.md');
    expect(safePath('What? Now: "yes".md')).toBe('What_ Now_ _yes_.md');
    expect(safePath('folder./name .md')).toBe('folder_/name .md');
    expect(safePath('trail /x')).toBe('trail_/x');
    expect(safePath('CON.md')).toBe('_CON.md');
    expect(safePath('a\\b.md')).toBe('a/b.md');
    expect(safePath('normal/path.md')).toBe('normal/path.md');
  });
  it('builds conflict names and avoids taken ones', () => {
    const t = new Date(2026, 9, 21, 9, 5).getTime();
    expect(conflictPath('Daily/Note.md', 'Laptop', t, () => false)).toBe('Daily/Note (conflict Laptop 2026-10-21 0905).md');
    const taken = new Set(['Note (conflict Laptop 2026-10-21 0905).md']);
    expect(conflictPath('Note.md', 'Laptop', t, (p) => taken.has(p))).toBe('Note (conflict Laptop 2026-10-21 0905 2).md');
    expect(conflictPath('Makefile', 'PC/1', t, () => false)).toBe('Makefile (conflict PC_1 2026-10-21 0905)');
  });
  it('isUnder', () => {
    expect(isUnder('A/b/c.md', 'a/B')).toBe(true);
    expect(isUnder('A/bc.md', 'A/b')).toBe(false);
  });
});

describe('ignore list', () => {
  it.each([
    '.obsidian/workspace.json',
    '.obsidian/workspace-mobile.json',
    '.trash/old.md',
    '.trash',
    'x/.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '.git/config',
    'notes/~$doc.docx',
    'notes/file.tmp',
    'notes/.note.md.swp',
    'notes/note.md~',
    '.bedrock-tmp-abc',
    'a/.bedrock-move-123',
    'download.crdownload',
    '.obsidian/cache',
  ])('ignores %s', (p) => expect(isIgnored(p)).toBe(true));
  it.each(['note.md', '.obsidian/app.json', '.obsidian/workspaces.json', '.obsidian/plugins/x/main.js', 'Trash talk.md', 'a/.hidden.md', 'img.png'])(
    'syncs %s',
    (p) => expect(isIgnored(p)).toBe(false),
  );
  it('honours extra prefixes and patterns', () => {
    expect(isIgnored('.bedrock-state/x.json', { prefixes: ['.bedrock-state'] })).toBe(true);
    expect(isIgnored('private/a.md', { patterns: [/^private\//] })).toBe(true);
  });
});
