// End-to-end encryption helpers. The storage service never sees plaintext, file names or the key.
//
// Vault key K: 32 random bytes, one per Toolbay account (see escrow.ts for how devices share it).
// Subkeys (HKDF-SHA256, salt "bedrock-vault-v1"):
//   K_meta  - encrypts file metadata (path, size, times, hash)
//   K_chunk - encrypts chunk contents
//   K_id    - HMAC key for chunk ids (dedup inside one vault, says nothing across vaults)
// Blob format: nonce(12) || ciphertext || tag(16), AES-256-GCM. Associated data binds a blob to
// its identity (chunk id for chunks, file id for metadata) so the server cannot swap blobs around.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_SALT = Buffer.from('bedrock-vault-v1');

export interface VaultKeys {
  meta: Buffer;
  chunk: Buffer;
  id: Buffer;
  /** Public fingerprint of K, stored on the server so a device with the wrong key is caught early. */
  keyCheck: string;
}

export function generateVaultKey(): Uint8Array {
  return new Uint8Array(randomBytes(KEY_BYTES));
}

export function deriveKeys(vaultKey: Uint8Array): VaultKeys {
  if (vaultKey.length !== KEY_BYTES) throw new Error(`vault key must be ${KEY_BYTES} bytes`);
  const k = Buffer.from(vaultKey);
  const sub = (info: string) => Buffer.from(hkdfSync('sha256', k, HKDF_SALT, Buffer.from(info), 32));
  const keys = { meta: sub('meta'), chunk: sub('chunk'), id: sub('chunk-id') };
  const keyCheck = createHmac('sha256', sub('key-check')).update('bedrock key check').digest('hex').slice(0, 32);
  return { ...keys, keyCheck };
}

export function encryptBlob(key: Buffer, plaintext: Uint8Array, aad: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]);
}

export function decryptBlob(key: Buffer, blob: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (b.length < NONCE_BYTES + TAG_BYTES) throw new DecryptError('encrypted blob is too short');
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, NONCE_BYTES));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(b.length - TAG_BYTES));
  try {
    return Buffer.concat([d.update(b.subarray(NONCE_BYTES, b.length - TAG_BYTES)), d.final()]);
  } catch {
    throw new DecryptError('could not decrypt (wrong vault key or damaged data)');
  }
}

export class DecryptError extends Error {
  code = 'DECRYPT';
}

/** Chunk id = HMAC-SHA256(K_id, plaintext chunk), hex. */
export function chunkId(keys: VaultKeys, plaintext: Uint8Array): string {
  return createHmac('sha256', keys.id).update(plaintext).digest('hex');
}

export function encryptChunk(keys: VaultKeys, id: string, plaintext: Uint8Array): Buffer {
  return encryptBlob(keys.chunk, plaintext, 'chunk:' + id);
}

/** Decrypts and verifies that the plaintext really has this id (detects swapped or corrupted chunks). */
export function decryptChunk(keys: VaultKeys, id: string, blob: Uint8Array): Buffer {
  const plain = decryptBlob(keys.chunk, blob, 'chunk:' + id);
  const actual = Buffer.from(chunkId(keys, plain), 'hex');
  if (!timingSafeEqual(actual, Buffer.from(id, 'hex'))) throw new DecryptError('chunk content does not match its id');
  return plain;
}

export interface FileMeta {
  path: string;
  kind: 'file' | 'folder';
  size: number;
  mtime: number;
  ctime: number;
  /** sha256 hex of the whole plaintext file ('' for folders and tombstones). */
  hash: string;
  /** Device that wrote this version (used in conflict copy names). */
  device?: string;
}

export function encryptMeta(keys: VaultKeys, fileId: string, meta: FileMeta): string {
  return encryptBlob(keys.meta, Buffer.from(JSON.stringify(meta)), 'meta:' + fileId).toString('base64');
}

export function decryptMeta(keys: VaultKeys, fileId: string, b64: string): FileMeta {
  return JSON.parse(decryptBlob(keys.meta, Buffer.from(b64, 'base64'), 'meta:' + fileId).toString('utf8'));
}

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}
