// Entry point for the deployed service (Railway). Configuration comes from environment variables;
// see server/README.md.

import { createSyncServer } from './app.js';
import { S3Store, type BlobStore } from './storage/index.js';

const env = process.env;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

let store: BlobStore | undefined;
if (env.S3_BUCKET) {
  for (const k of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!env[k]) throw new Error(`${k} is required when S3_BUCKET is set`);
  }
  store = new S3Store({
    endpoint: env.S3_ENDPOINT!,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    region: env.S3_REGION || 'auto',
    prefix: env.S3_PREFIX || '',
  });
}

const dataDir = env.DATA_DIR || './data';
const retentionDays = num(env.RETENTION_DAYS, 90);
const srv = createSyncServer({
  dataDir,
  store,
  toolbayApi: env.TOOLBAY_API || 'https://toolbay.ai',
  devAuth: env.DEV_AUTH === '1',
  quotaBytes: num(env.QUOTA_BYTES, 10 * 1024 ** 3),
  maxFileBytes: num(env.MAX_FILE_BYTES, 1024 ** 3),
  retentionDays,
  gcGraceMs: num(env.GC_GRACE_HOURS, 24) * 3600_000,
  rateLimitPerSec: num(env.RATE_LIMIT_PER_SEC, 30),
  rateLimitBurst: num(env.RATE_LIMIT_BURST, 300),
  log,
});

if (env.DEV_AUTH === '1') log('WARNING: DEV_AUTH=1, tokens "dev:<userId>" are accepted. Never use this in production.');

await srv.listen(num(env.PORT, 8080), env.HOST || '0.0.0.0');
log(`bedrock-sync listening on :${srv.port}, data in ${dataDir}, blobs on ${srv.store.kind}, history ${retentionDays} days`);

const retentionEveryMs = num(env.RETENTION_INTERVAL_HOURS, 6) * 3600_000;
const runRetention = () => srv.runRetention().catch((e) => log(`retention failed: ${e?.stack ?? e}`));
setTimeout(runRetention, 60_000).unref();
setInterval(runRetention, retentionEveryMs).unref();

const shutdown = (sig: string) => {
  log(`${sig}: shutting down`);
  srv.close().then(() => process.exit(0), () => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
