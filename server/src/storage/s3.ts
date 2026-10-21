import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BlobStore } from './index.js';

export interface S3Options {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** Optional key prefix inside the bucket, e.g. "vaults/". */
  prefix?: string;
}

/** S3-compatible backend (Cloudflare R2 in production). */
export class S3Store implements BlobStore {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      region: opts.region || 'auto',
      endpoint: opts.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  private k(key: string): string {
    return (this.opts.prefix ?? '') + key;
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key), Body: data, ContentLength: data.length }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async head(key: string): Promise<number | null> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key) }));
      return r.ContentLength ?? 0;
    } catch (e: any) {
      if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key) }));
  }

  presignPut(key: string, size: number, expiresSec: number): Promise<string> {
    // ContentLength is signed, so the bucket rejects a body of any other size.
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key), ContentLength: size }), {
      expiresIn: expiresSec,
    });
  }

  presignGet(key: string, expiresSec: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.k(key) }), { expiresIn: expiresSec });
  }
}
