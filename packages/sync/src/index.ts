export { SyncEngine, EMPTY_VAULT_MESSAGE, type SyncEngineOptions, type SyncStatus, type SyncState, type VersionInfo, type TrashItem } from './engine.js';
export { AccountKeyStore, type AccountWrappedKey, type Keychain } from './escrow.js';
export { wrapVaultKey, unwrapVaultKey, isWrappedKey, passphraseProblem, WrongPassphraseError, MIN_PASSPHRASE_LENGTH, DEFAULT_KDF, type WrappedKey } from './keywrap.js';
export { rotateVault, type RotateOptions, type RotateResult } from './rotate.js';
export {
  TOOL_SLUG,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
  LEGACY_KEYCHAIN_ACCOUNT,
  ESCROW_ITEM_KEY,
  WRAPPED_KEY_ITEM,
  CHUNK_SIZE,
  DEFAULT_SERVER_URL,
} from './constants.js';
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
