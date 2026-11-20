'use strict';
// Encrypted database backups kept under one prefix ("folder") of the R2 documents bucket.
// Contract: context/features/staging-backups.md. Nothing here prints or returns credentials.
const { createHash } = require('node:crypto');

const DATABASE = /^c4g_[a-z0-9_]{1,50}$/;
const STAMP = /^\d{8}T\d{6}Z$/;
const PREFIX = /^backups\/[a-z0-9][a-z0-9-]{0,30}\/$/;
const KEY_TAIL = /^(c4g_[a-z0-9_]{1,50})\/(\d{8}T\d{6}Z)\.(dump\.enc|json)$/;
const MAX_BYTES = 500 * 1024 * 1024;
const DAY = 86400000;

function failure(code) { return Object.assign(new Error(code), { code }); }

function loadBackupConfiguration(env) {
  const text = name => typeof env[name] === 'string' ? env[name].trim() : '';
  let endpoint;
  try { endpoint = new URL(text('C4G_R2_ENDPOINT')); } catch { throw failure('BACKUP_R2_CONFIG_INVALID'); }
  const prefix = env.C4G_BACKUP_PREFIX === undefined ? 'backups/staging/' : env.C4G_BACKUP_PREFIX;
  if (endpoint.protocol !== 'https:' || !text('C4G_R2_DOCUMENTS_BUCKET') || !text('C4G_R2_ACCESS_KEY_ID') || !text('C4G_R2_SECRET_ACCESS_KEY')
    || typeof prefix !== 'string' || !PREFIX.test(prefix)) throw failure('BACKUP_R2_CONFIG_INVALID');
  return Object.freeze({ endpoint: endpoint.origin, bucket: text('C4G_R2_DOCUMENTS_BUCKET'), prefix,
    credentials: Object.freeze({ accessKeyId: text('C4G_R2_ACCESS_KEY_ID'), secretAccessKey: text('C4G_R2_SECRET_ACCESS_KEY') }) });
}

function objectKey(prefix, database, stamp, kind = 'dump') {
  if (!PREFIX.test(prefix) || !DATABASE.test(database) || !STAMP.test(stamp) || !['dump', 'manifest'].includes(kind)) throw failure('BACKUP_KEY_INVALID');
  return `${prefix}${database}/${stamp}.${kind === 'manifest' ? 'json' : 'dump.enc'}`;
}

function parseKey(prefix, key) {
  if (typeof key !== 'string' || !key.startsWith(prefix)) return null;
  const match = KEY_TAIL.exec(key.slice(prefix.length));
  return match ? { database: match[1], stamp: match[2], kind: match[3] === 'json' ? 'manifest' : 'dump' } : null;
}

function stampDate(stamp) {
  const n = (from, to) => Number(stamp.slice(from, to));
  return new Date(Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(9, 11), n(11, 13), n(13, 15)));
}

function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const start = Date.UTC(day.getUTCFullYear(), 0, 1);
  return `${day.getUTCFullYear()}-W${String(Math.ceil(((day - start) / DAY + 1) / 7)).padStart(2, '0')}`;
}

// Per database: the newest copy of each of the last `daily` days and of the last `weekly` ISO weeks.
// The newest copy is always kept. Objects the code does not recognise are never planned for deletion.
function planRetention(keys, { now, prefix, daily = 14, weekly = 8 }) {
  for (const limit of [daily, weekly]) if (!Number.isInteger(limit) || limit < 0 || limit > 365) throw failure('BACKUP_RETENTION_INVALID');
  if (daily < 1) throw failure('BACKUP_RETENTION_INVALID');
  const parsed = keys.map(key => ({ key, ...parseKey(prefix, key) })).filter(item => item.database);
  const keepDumps = new Set(), perDatabase = new Map();
  for (const item of parsed.filter(entry => entry.kind === 'dump')) {
    if (!perDatabase.has(item.database)) perDatabase.set(item.database, []);
    perDatabase.get(item.database).push(item);
  }
  for (const items of perDatabase.values()) {
    items.sort((a, b) => b.stamp.localeCompare(a.stamp));
    keepDumps.add(items[0].key);
    const days = new Map(), weeks = new Map();
    for (const item of items) {
      const date = stampDate(item.stamp);
      if (date > now) { keepDumps.add(item.key); continue; }
      const day = item.stamp.slice(0, 8), week = isoWeek(date);
      if (!days.has(day)) days.set(day, item.key);
      if (!weeks.has(week)) weeks.set(week, item.key);
    }
    [...days.values()].slice(0, daily).forEach(key => keepDumps.add(key));
    [...weeks.values()].slice(0, weekly).forEach(key => keepDumps.add(key));
  }
  const keep = [], remove = [];
  for (const item of parsed) {
    const dumpKey = item.kind === 'dump' ? item.key : `${prefix}${item.database}/${item.stamp}.dump.enc`;
    (keepDumps.has(dumpKey) ? keep : remove).push(item.key);
  }
  return { keep, delete: remove };
}

function createBackupStore(config, options = {}) {
  const sdk = options.sdk || require('@aws-sdk/client-s3');
  const client = options.client || new sdk.S3Client({ endpoint: config.endpoint, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: config.credentials.accessKeyId, secretAccessKey: config.credentials.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 3 });
  const inside = key => { if (typeof key !== 'string' || !key.startsWith(config.prefix) || key.includes('..')) throw failure('BACKUP_KEY_OUTSIDE_PREFIX'); return key; };
  async function send(Command, input) {
    try { return await client.send(new Command(input), { abortSignal: AbortSignal.timeout(120000) }); }
    catch (error) {
      if (error?.$metadata?.httpStatusCode === 404) throw failure('BACKUP_OBJECT_NOT_FOUND');
      throw failure('BACKUP_R2_FAILED');
    }
  }
  async function listAll(prefix) {
    const keys = []; let token;
    do {
      const page = await send(sdk.ListObjectsV2Command, { Bucket: config.bucket, Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) });
      for (const item of page.Contents || []) keys.push(item.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
  return Object.freeze({
    async put({ key, body }) {
      inside(key);
      if (!Buffer.isBuffer(body) || body.length === 0) throw failure('BACKUP_EMPTY');
      if (body.length > MAX_BYTES) throw failure('BACKUP_TOO_LARGE');
      const sha256 = createHash('sha256').update(body).digest('hex');
      await send(sdk.PutObjectCommand, { Bucket: config.bucket, Key: key, Body: body, ContentType: 'application/octet-stream', Metadata: { sha256 } });
      const head = await send(sdk.HeadObjectCommand, { Bucket: config.bucket, Key: key });
      if (head.ContentLength !== body.length || head.Metadata?.sha256 !== sha256) throw failure('BACKUP_UPLOAD_UNVERIFIED');
      return { key, size: body.length, sha256 };
    },
    async get(key) {
      const result = await send(sdk.GetObjectCommand, { Bucket: config.bucket, Key: inside(key) });
      return Buffer.from(await result.Body.transformToByteArray());
    },
    async list(database) {
      if (!DATABASE.test(database)) throw failure('BACKUP_KEY_INVALID');
      return listAll(`${config.prefix}${database}/`);
    },
    async latest(database) {
      const dumps = (await this.list(database)).map(key => ({ key, ...parseKey(config.prefix, key) })).filter(item => item.kind === 'dump').sort((a, b) => b.stamp.localeCompare(a.stamp));
      if (!dumps.length) return null;
      return { database, stamp: dumps[0].stamp, dumpKey: dumps[0].key, manifestKey: objectKey(config.prefix, database, dumps[0].stamp, 'manifest') };
    },
    async remove(keys) {
      keys.forEach(inside);
      for (let index = 0; index < keys.length; index += 1000) {
        await send(sdk.DeleteObjectsCommand, { Bucket: config.bucket, Delete: { Objects: keys.slice(index, index + 1000).map(Key => ({ Key })), Quiet: true } });
      }
    },
    prefix: config.prefix
  });
}

async function statusReport(store, databases, { now = new Date(), maxAgeHours = 36 } = {}) {
  const report = [];
  for (const database of databases) {
    const latest = await store.latest(database);
    if (!latest) { report.push({ database, ok: false, stamp: null, ageHours: null }); continue; }
    const ageHours = Math.floor((now - stampDate(latest.stamp)) / 3600000);
    report.push({ database, ok: ageHours <= maxAgeHours, stamp: latest.stamp, ageHours });
  }
  return report;
}

async function prune(store, databases, { now = new Date(), apply = false, daily, weekly } = {}) {
  const keys = (await Promise.all(databases.map(database => store.list(database)))).flat();
  const plan = planRetention(keys, { now, prefix: store.prefix, ...(daily === undefined ? {} : { daily }), ...(weekly === undefined ? {} : { weekly }) });
  if (apply && plan.delete.length) await store.remove(plan.delete);
  return { applied: apply === true, keep: plan.keep.length, delete: plan.delete };
}

module.exports = Object.freeze({ loadBackupConfiguration, objectKey, parseKey, planRetention, createBackupStore, statusReport, prune, stampDate, MAX_BYTES });
