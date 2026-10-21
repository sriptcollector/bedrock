// Vault-relative paths: always '/'-separated, NFC-normalized in metadata.
// Path identity for collisions is case-insensitive on every platform (see pathKey), so a vault looks
// the same on Windows, macOS and Linux and two remote files can never clobber each other.

import { sep } from 'node:path';

export function toPosix(rel: string): string {
  return sep === '\\' ? rel.split('\\').join('/') : rel;
}

export function nfc(p: string): string {
  return p.normalize('NFC');
}

/** Collision key: NFC + lower case. Two paths with the same key cannot coexist in a synced vault. */
export function pathKey(p: string): string {
  return p.normalize('NFC').toLowerCase();
}

export function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export function isUnder(p: string, dir: string): boolean {
  return dir === '' || pathKey(p).startsWith(pathKey(dir) + '/');
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Makes a remote path safe to create on any OS: no '..', no absolute paths, no characters Windows
 * forbids, no trailing dots/spaces, no reserved device names. Applied on every platform so all
 * devices agree on the final name.
 */
export function safePath(p: string): string {
  const parts = nfc(p)
    .split(/[\\/]+/)
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map((seg) => {
      let s = seg.replace(/[<>:"|?*\u0000-\u001f]/g, '_');
      s = s.replace(/[. ]+$/, (m) => '_'.repeat(m.length));
      if (RESERVED.test(s)) s = '_' + s;
      return s;
    });
  return parts.join('/') || '_';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * `<dir>/<name> (conflict <device> <YYYY-MM-DD HHmm>)<.ext>`, with " 2", " 3"... added if taken.
 * `taken` gets the candidate path.
 */
export function conflictPath(p: string, device: string, ms: number, taken: (path: string) => boolean, word = 'conflict'): string {
  const dir = dirOf(p);
  const name = baseName(p);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const label = (device || 'another device').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 40).trim();
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${word} ${label} ${stamp(ms)}${n > 1 ? ' ' + n : ''})${ext}`;
    const full = dir ? `${dir}/${candidate}` : candidate;
    if (!taken(full)) return full;
  }
}
