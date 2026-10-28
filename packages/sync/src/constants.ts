/** Toolbay tool slug: used for the settings-sync API (key escrow) and the keychain service name. */
export const TOOL_SLUG = 'bedrock';
/** OS keychain service where each computer keeps its opened vault key. */
export const KEYCHAIN_SERVICE = `ai.toolbay.${TOOL_SLUG}`;
/** Keychain entry of the current vault key (opened with the sync passphrase, 0.1.3+). */
export const KEYCHAIN_ACCOUNT = 'vault-key-2';
/**
 * Keychain entry where 0.1.2 and older cached the vault key that was also stored unprotected in the
 * Toolbay account. Kept only to re-encrypt old synced data under a new key, then deleted.
 */
export const LEGACY_KEYCHAIN_ACCOUNT = 'vault-key';
/** Item of the Toolbay tool settings sync store that held the raw key in 0.1.2 and older (deleted). */
export const ESCROW_ITEM_KEY = 'vault-key';
/** Item that holds the passphrase-wrapped vault key (keywrap.ts). */
export const WRAPPED_KEY_ITEM = 'vault-key-wrapped';
/** Fixed chunk size. Notes up to 4 MB are a single chunk. */
export const CHUNK_SIZE = 4 * 1024 * 1024;
export const WS_PROTOCOL = 'bedrock.v1';
export const DEFAULT_SERVER_URL = 'https://sync.toolbay.ai';
