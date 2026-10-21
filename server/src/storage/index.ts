// Blob storage for encrypted chunks. Keys look like `<vaultId>/<chunkId>`.

export interface BlobStore {
  readonly kind: 'disk' | 's3';
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** Size in bytes, or null if the blob does not exist. */
  head(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  /** Direct-to-bucket URLs (S3/R2 only) so large chunks skip the API server. */
  presignPut?(key: string, size: number, expiresSec: number): Promise<string>;
  presignGet?(key: string, expiresSec: number): Promise<string>;
}

export { DiskStore } from './disk.js';
export { S3Store, type S3Options } from './s3.js';
