// Passphrase wrapping of the vault key (since 0.1.3).
//
// The vault key K (32 random bytes, see crypto.ts) never leaves a computer in usable form. What
// goes to the Toolbay account is K encrypted with a key derived from the person's sync passphrase:
//
//   KEK = scrypt(passphrase NFKC, salt = 16 random bytes, N = 2^17, r = 8, p = 1, 32 bytes)
//   ct  = AES-256-GCM(KEK, nonce = 12 random bytes, K, aad = "bedrock-vault-key-wrap-v2|" + params)
//
// The stored object (WrappedKey) holds only the KDF parameters, salt, nonce, ciphertext+tag and
// the vault's public key fingerprint (keyCheck, the same value the sync service already stores).
// Without the passphrase it can't be opened, so Toolbay can't read synced notes. The cost is that a
// forgotten passphrase can't be recovered by anyone; the files on the person's computers are
// never affected by that.

import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import { deriveKeys, KEY_BYTES } from './crypto.js';

export interface WrappedKey {
  v: 2;
  alg: 'A256GCM';
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string; dkLen: 32 };
  nonce: string;
  ct: string;
  keyCheck: string;
  createdAt: number;
}

/** OWASP's scrypt baseline (N=2^17, r=8, p=1): about 128 MB and a fraction of a second per try. */
export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 } as const;
export const MIN_PASSPHRASE_LENGTH = 10;

export class WrongPassphraseError extends Error {
  code = 'WRONG_PASSPHRASE';
  constructor() {
    super("That passphrase isn't right. Check it and try again.");
  }
}

function scrypt(pass: string, salt: Buffer, kdf: { N: number; r: number; p: number }): Promise<Buffer> {
  const opts: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 32 * 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scryptCb(Buffer.from(pass.normalize('NFKC'), 'utf8'), salt, 32, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

function aad(w: Pick<WrappedKey, 'v' | 'alg' | 'kdf'>): Buffer {
  const { name, N, r, p, salt, dkLen } = w.kdf;
  return Buffer.from(`bedrock-vault-key-wrap-v2|${w.alg}|${name}|${N}|${r}|${p}|${dkLen}|${salt}`);
}

/** Plain-language problem with a new passphrase, or null when it is fine. */
export function passphraseProblem(pass: string): string | null {
  if (pass.normalize('NFKC').trim().length < MIN_PASSPHRASE_LENGTH)
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters. A few unrelated words is easy to remember and hard to guess.`;
  return null;
}

export async function wrapVaultKey(vaultKey: Uint8Array, passphrase: string, kdfCost: { N: number; r: number; p: number } = DEFAULT_KDF): Promise<WrappedKey> {
  if (vaultKey.length !== KEY_BYTES) throw new Error(`vault key must be ${KEY_BYTES} bytes`);
  const salt = randomBytes(16);
  const head = { v: 2 as const, alg: 'A256GCM' as const, kdf: { name: 'scrypt' as const, ...kdfCost, salt: salt.toString('base64'), dkLen: 32 as const } };
  const kek = await scrypt(passphrase, salt, kdfCost);
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kek, nonce);
  c.setAAD(aad(head));
  const ct = Buffer.concat([c.update(vaultKey), c.final(), c.getAuthTag()]);
  kek.fill(0);
  return { ...head, nonce: nonce.toString('base64'), ct: ct.toString('base64'), keyCheck: deriveKeys(vaultKey).keyCheck, createdAt: Date.now() };
}

export async function unwrapVaultKey(w: WrappedKey, passphrase: string): Promise<Uint8Array> {
  if (!isWrappedKey(w)) throw new Error('The protected vault key in your Toolbay account is damaged.');
  const kek = await scrypt(passphrase, Buffer.from(w.kdf.salt, 'base64'), w.kdf);
  const ct = Buffer.from(w.ct, 'base64');
  const d = createDecipheriv('aes-256-gcm', kek, Buffer.from(w.nonce, 'base64'));
  d.setAAD(aad(w));
  d.setAuthTag(ct.subarray(ct.length - 16));
  let key: Buffer;
  try {
    key = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  } catch {
    throw new WrongPassphraseError();
  } finally {
    kek.fill(0);
  }
  if (key.length !== KEY_BYTES || deriveKeys(key).keyCheck !== w.keyCheck) throw new WrongPassphraseError();
  return new Uint8Array(key);
}

export function isWrappedKey(v: unknown): v is WrappedKey {
  const w = v as WrappedKey | null;
  return (
    !!w &&
    w.v === 2 &&
    w.alg === 'A256GCM' &&
    w.kdf?.name === 'scrypt' &&
    Number.isInteger(w.kdf.N) &&
    w.kdf.N >= 2 ** 15 &&
    Number.isInteger(w.kdf.r) &&
    Number.isInteger(w.kdf.p) &&
    typeof w.kdf.salt === 'string' &&
    typeof w.nonce === 'string' &&
    typeof w.ct === 'string' &&
    Buffer.from(w.ct, 'base64').length === KEY_BYTES + 16 &&
    typeof w.keyCheck === 'string'
  );
}
