export { SyncEngine, type SyncEngineOptions, type SyncStatus, type SyncState, type VersionInfo, type TrashItem } from './engine.js';
export { obtainVaultKey, KeyEscrow, type Keychain, type ObtainKeyOptions } from './escrow.js';
export { TOOL_SLUG, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, ESCROW_ITEM_KEY, CHUNK_SIZE, DEFAULT_SERVER_URL } from './constants.js';
export {
  generateVaultKey,
  deriveKeys,
  encryptChunk,
  decryptChunk,
  encryptMeta,
  decryptMeta,
  chunkId,
  type VaultKeys,
  type FileMeta,
} from './crypto.js';
export { SyncApi, SyncError } from './api.js';
export { mergeText, merge3 } from './diff3.js';
export { mergeFile, mergeJsonText } from './merge.js';
export { isIgnored, type IgnoreOptions } from './ignore.js';
export { pathKey, safePath, conflictPath } from './paths.js';
