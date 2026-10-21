import { afterEach, describe, expect, it } from 'vitest';
import { obtainVaultKey, type Keychain } from '../src/escrow.js';
import { TOOL_SLUG, KEYCHAIN_SERVICE } from '../src/constants.js';
import { startFakeToolbay, type FakeToolbay } from './helpers.js';

const memKeychain = (initial: string | null = null): Keychain & { value: string | null; sets: number } => {
  const k = {
    value: initial,
    sets: 0,
    async get() {
      return k.value;
    },
    async set(v: string) {
      k.value = v;
      k.sets++;
    },
  };
  return k;
};
const hex = (k: Uint8Array) => Buffer.from(k).toString('hex');

let fake: FakeToolbay;
afterEach(async () => fake?.close());

describe('key escrow', () => {
  it('uses the Bedrock slug and keychain service', () => {
    expect(TOOL_SLUG).toBe('bedrock');
    expect(KEYCHAIN_SERVICE).toBe('ai.toolbay.bedrock');
  });

  it('first device creates the key, second device fetches the same key', async () => {
    fake = await startFakeToolbay();
    fake.tokens.set('t1', 'u1');
    const kc1 = memKeychain();
    const k1 = await obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: kc1 });
    expect(k1.length).toBe(32);
    expect(fake.store.get('u1/bedrock')?.get('vault-key')?.version).toBe(1);
    const kc2 = memKeychain();
    const k2 = await obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: kc2 });
    expect(hex(k2)).toBe(hex(k1));
    expect(kc2.value).toBe(Buffer.from(k1).toString('base64'));
  });

  it('two new devices racing: both end up with the same key', async () => {
    fake = await startFakeToolbay();
    fake.tokens.set('t1', 'u1');
    fake.putDelayMs = 50; // both GETs see "no key" before either PUT lands
    const [a, b, c] = await Promise.all([
      obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: memKeychain() }),
      obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: memKeychain() }),
      obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: memKeychain() }),
    ]);
    expect(hex(b)).toBe(hex(a));
    expect(hex(c)).toBe(hex(a));
    expect(fake.store.get('u1/bedrock')?.get('vault-key')?.version).toBe(1);
  });

  it('offline: falls back to the keychain; a stale keychain key is corrected when online', async () => {
    fake = await startFakeToolbay();
    fake.tokens.set('t1', 'u1');
    const real = await obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: memKeychain() });
    const stale = memKeychain(Buffer.alloc(32, 7).toString('base64'));
    expect(hex(await obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: stale }))).toBe(hex(real));
    expect(stale.value).toBe(Buffer.from(real).toString('base64'));
    await fake.close();
    const offline = await obtainVaultKey({ toolbayApi: fake.url, token: 't1', keychain: stale });
    expect(hex(offline)).toBe(hex(real));
  });

  it('expired token gives an auth error, not a new key', async () => {
    fake = await startFakeToolbay();
    await expect(obtainVaultKey({ toolbayApi: fake.url, token: 'nope', keychain: memKeychain() })).rejects.toMatchObject({ kind: 'auth' });
  });
});
