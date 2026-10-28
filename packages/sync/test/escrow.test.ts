import { afterEach, describe, expect, it } from 'vitest';
import { AccountKeyStore } from '../src/escrow.js';
import { generateVaultKey, deriveKeys } from '../src/crypto.js';
import { passphraseProblem, unwrapVaultKey, wrapVaultKey, WrongPassphraseError } from '../src/keywrap.js';
import { TOOL_SLUG, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, LEGACY_KEYCHAIN_ACCOUNT, WRAPPED_KEY_ITEM, ESCROW_ITEM_KEY } from '../src/constants.js';
import { startFakeToolbay, type FakeToolbay } from './helpers.js';

const hex = (k: Uint8Array) => Buffer.from(k).toString('hex');
const FAST = { N: 2 ** 15, r: 8, p: 1 }; // the floor toolbay.ai accepts; keeps tests quick

let fake: FakeToolbay;
afterEach(async () => fake?.close());

describe('vault key wrapping', () => {
  it('uses the Bedrock slug and keychain names', () => {
    expect(TOOL_SLUG).toBe('bedrock');
    expect(KEYCHAIN_SERVICE).toBe('ai.toolbay.bedrock');
    expect(KEYCHAIN_ACCOUNT).not.toBe(LEGACY_KEYCHAIN_ACCOUNT);
  });

  it('wraps and unwraps with the passphrase; the wrapped form holds no usable key', async () => {
    const k = generateVaultKey();
    const w = await wrapVaultKey(k, 'correct horse battery staple');
    expect(w.kdf).toMatchObject({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1, dkLen: 32 });
    expect(Buffer.from(w.kdf.salt, 'base64').length).toBe(16);
    expect(Buffer.from(w.ct, 'base64').length).toBe(48);
    expect(w.keyCheck).toBe(deriveKeys(k).keyCheck);
    const json = JSON.stringify(w);
    expect(json).not.toContain(Buffer.from(k).toString('base64'));
    expect(json).not.toContain(hex(k));
    expect(hex(await unwrapVaultKey(w, 'correct horse battery staple'))).toBe(hex(k));
  });

  it('a wrong passphrase or tampered parameters fail', async () => {
    const k = generateVaultKey();
    const w = await wrapVaultKey(k, 'one two three four', FAST);
    await expect(unwrapVaultKey(w, 'one two three five')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(unwrapVaultKey({ ...w, kdf: { ...w.kdf, N: 2 ** 16 } }, 'one two three four')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(unwrapVaultKey({ ...w, keyCheck: '0'.repeat(32) }, 'one two three four')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('two wraps of the same key differ (random salt and nonce)', async () => {
    const k = generateVaultKey();
    const [a, b] = await Promise.all([wrapVaultKey(k, 'same passphrase here', FAST), wrapVaultKey(k, 'same passphrase here', FAST)]);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.ct).not.toBe(b.ct);
  });

  it('short passphrases are refused', () => {
    expect(passphraseProblem('short')).toMatch(/at least 10/);
    expect(passphraseProblem('   padded   ')).toMatch(/at least 10/);
    expect(passphraseProblem('long enough words')).toBeNull();
  });
});

describe('account key store', () => {
  it('first computer stores the wrapped key, another computer reads and opens it', async () => {
    fake = await startFakeToolbay();
    fake.tokens.set('t1', 'u1');
    const a = new AccountKeyStore(fake.url, 't1');
    expect(await a.getWrapped()).toBeNull();
    const k = generateVaultKey();
    expect(await a.putWrapped(await wrapVaultKey(k, 'my sync passphrase', FAST), 0)).toBeNull();
    const got = await new AccountKeyStore(fake.url, 't1').getWrapped();
    expect(got?.version).toBe(1);
    expect(hex(await unwrapVaultKey(got!.key, 'my sync passphrase'))).toBe(hex(k));
    // nothing but the wrapped item was written
    expect([...fake.store.get('u1/bedrock')!.keys()]).toEqual([WRAPPED_KEY_ITEM]);
  });

  it('two computers setting up at once: the second gets the first one back', async () => {
    fake = await startFakeToolbay();
    fake.tokens.set('t1', 'u1');
    const s = new AccountKeyStore(fake.url, 't1');
    const w1 = await wrapVaultKey(generateVaultKey(), 'first passphrase', FAST);
    const w2 = await wrapVaultKey(generateVaultKey(), 'second passphrase', FAST);
    expect(await s.putWrapped(w1, 0)).toBeNull();
    const theirs = await s.putWrapped(w2, 0);
    expect(theirs?.key.keyCheck).toBe(w1.keyCheck);
  });

  it('deletes the raw key 0.1.2 left in the account without reading it', async () => {
    fake = await startFakeToolbay();
    fake.tokens.set('t1', 'u1');
    const items = new Map<string, any>([[ESCROW_ITEM_KEY, { value: { v: 1, key: Buffer.alloc(32, 9).toString('base64'), createdAt: 1 }, version: 3, updatedAt: 1 }]]);
    fake.store.set('u1/bedrock', items);
    await new AccountKeyStore(fake.url, 't1').deleteRawKey();
    expect(items.get(ESCROW_ITEM_KEY)).toMatchObject({ deleted: true, value: null, version: 4 });
    await new AccountKeyStore(fake.url, 't1').deleteRawKey(); // nothing left: still fine
  });

  it('expired token gives an auth error', async () => {
    fake = await startFakeToolbay();
    await expect(new AccountKeyStore(fake.url, 'nope').getWrapped()).rejects.toMatchObject({ kind: 'auth' });
  });
});
