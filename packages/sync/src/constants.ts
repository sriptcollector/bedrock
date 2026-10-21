/** Toolbay tool slug: used for the settings-sync API (key escrow) and the keychain service name. */
export const TOOL_SLUG = 'bedrock';
/** OS keychain entry where each device caches the vault key. */
export const KEYCHAIN_SERVICE = `ai.toolbay.${TOOL_SLUG}`;
export const KEYCHAIN_ACCOUNT = 'vault-key';
/** Key name inside the Toolbay tool settings sync store. */
export const ESCROW_ITEM_KEY = 'vault-key';
/** Fixed chunk size. Notes up to 4 MB are a single chunk. */
export const CHUNK_SIZE = 4 * 1024 * 1024;
export const WS_PROTOCOL = 'bedrock.v1';
export const DEFAULT_SERVER_URL = 'https://sync.toolbay.ai';
