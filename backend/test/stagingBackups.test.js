'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const backups = require('../src/backups/r2Backups');

const ENV = Object.freeze({ C4G_R2_ENDPOINT: 'https://abc123.eu.r2.cloudflarestorage.com', C4G_R2_DOCUMENTS_BUCKET: 'c4g-staging-documents',
  C4G_R2_ACCESS_KEY_ID: 'key-id', C4G_R2_SECRET_ACCESS_KEY: 'secret-value' });
const PREFIX = 'backups/staging/';
const key = (database, stamp, kind = 'dump') => `${PREFIX}${database}/${stamp}.${kind === 'manifest' ? 'json' : 'dump.enc'}`;

test('configuration uses the documents bucket and a backups prefix, and refuses anything else', () => {
  const config = backups.loadBackupConfiguration(ENV);
  assert.equal(config.bucket, 'c4g-staging-documents'); assert.equal(config.prefix, PREFIX); assert.equal(config.endpoint, 'https://abc123.eu.r2.cloudflarestorage.com');
  assert.equal(backups.loadBackupConfiguration({ ...ENV, C4G_BACKUP_PREFIX: 'backups/other/' }).prefix, 'backups/other/');
  for (const bad of [{ C4G_R2_ENDPOINT: 'http://abc.r2.cloudflarestorage.com' }, { C4G_R2_ENDPOINT: 'not a url' }, { C4G_R2_DOCUMENTS_BUCKET: '' },
    { C4G_R2_ACCESS_KEY_ID: '' }, { C4G_R2_SECRET_ACCESS_KEY: '  ' }, { C4G_BACKUP_PREFIX: 'central/' }, { C4G_BACKUP_PREFIX: 'backups/' }, { C4G_BACKUP_PREFIX: 'backups/a/../b/' }, { C4G_BACKUP_PREFIX: '/backups/a/' }]) {
    assert.throws(() => backups.loadBackupConfiguration({ ...ENV, ...bad }), { code: 'BACKUP_R2_CONFIG_INVALID' }, JSON.stringify(bad));
  }
});

test('object keys are built and parsed strictly', () => {
  assert.equal(backups.objectKey(PREFIX, 'c4g_central_staging', '20261113T023000Z'), key('c4g_central_staging', '20261113T023000Z'));
  assert.equal(backups.objectKey(PREFIX, 'c4g_central_staging', '20261113T023000Z', 'manifest'), key('c4g_central_staging', '20261113T023000Z', 'manifest'));
  for (const [database, stamp] of [['Central', '20261113T023000Z'], ['c4g_x/../y', '20261113T023000Z'], ['c4g_x', '2026-11-13'], ['c4g_x', '20261113T023000'], ['', '20261113T023000Z']]) {
    assert.throws(() => backups.objectKey(PREFIX, database, stamp), { code: 'BACKUP_KEY_INVALID' });
  }
  assert.deepEqual(backups.parseKey(PREFIX, key('c4g_tenant_staging', '20261101T000000Z', 'manifest')), { database: 'c4g_tenant_staging', stamp: '20261101T000000Z', kind: 'manifest' });
  for (const other of [`${PREFIX}c4g_x/readme.txt`, 'backups/other/c4g_x/20261101T000000Z.dump.enc', `${PREFIX}20261101T000000Z.dump.enc`, 'central/portugal2030/abc']) assert.equal(backups.parseKey(PREFIX, other), null);
});

const stampFor = (daysAgo, hour = 2, now = Date.UTC(2026, 10, 13, 12)) => {
  const d = new Date(now - daysAgo * 86400000); d.setUTCHours(hour, 30, 0, 0);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

test('retention keeps 14 daily and 8 weekly copies, never the only recent one, and ignores unknown objects', () => {
  const now = new Date(Date.UTC(2026, 10, 13, 12));
  const dumps = Array.from({ length: 120 }, (_, index) => key('c4g_central_staging', stampFor(index)));
  const manifests = dumps.map(k => k.replace('.dump.enc', '.json'));
  const unknown = [`${PREFIX}c4g_central_staging/notes.txt`, 'central/portugal2030/abc', 'backups/other/c4g_x/20200101T000000Z.dump.enc'];
  const plan = backups.planRetention([...dumps, ...manifests, ...unknown], { now, prefix: PREFIX });
  const keptDumps = plan.keep.filter(k => k.endsWith('.dump.enc'));
  assert.ok(keptDumps.includes(dumps[0]), 'newest is kept');
  for (let index = 0; index < 14; index += 1) assert.ok(plan.keep.includes(dumps[index]), `daily ${index}`);
  assert.ok(keptDumps.length >= 14 && keptDumps.length <= 14 + 8 + 1, `kept ${keptDumps.length}`);
  assert.ok(plan.delete.includes(dumps[119])); assert.ok(!plan.delete.includes(dumps[0]));
  for (const k of dumps) assert.equal(plan.keep.includes(k.replace('.dump.enc', '.json')), plan.keep.includes(k), 'manifest follows its dump');
  for (const k of unknown) { assert.ok(!plan.keep.includes(k) && !plan.delete.includes(k), `ignored ${k}`); }
  assert.deepEqual([...new Set([...plan.keep, ...plan.delete])].sort(), [...dumps, ...manifests].sort());
});

test('retention is per database and refuses invalid limits', () => {
  const now = new Date(Date.UTC(2026, 10, 13, 12));
  const mixed = ['c4g_central_staging', 'c4g_tenant_staging'].flatMap(database => Array.from({ length: 30 }, (_, i) => key(database, stampFor(i))));
  const plan = backups.planRetention(mixed, { now, prefix: PREFIX });
  for (const database of ['c4g_central_staging', 'c4g_tenant_staging']) assert.ok(plan.keep.includes(key(database, stampFor(0))));
  assert.equal(backups.planRetention([key('c4g_central_staging', stampFor(0))], { now, prefix: PREFIX }).delete.length, 0);
  for (const limits of [{ daily: 0 }, { daily: 1.5 }, { weekly: -1 }, { daily: 400 }]) assert.throws(() => backups.planRetention(mixed, { now, prefix: PREFIX, ...limits }), { code: 'BACKUP_RETENTION_INVALID' });
});

function fakeClient({ pageSize = 1000, failPut = false, headLength = null } = {}) {
  const objects = new Map(), calls = [];
  return { objects, calls, async send(command) {
    const name = command.constructor.name, input = command.input; calls.push([name, input]);
    if (name === 'PutObjectCommand') { if (failPut) throw Object.assign(new Error('boom'), { name: 'AccessDenied' }); objects.set(input.Key, { body: Buffer.from(input.Body), metadata: input.Metadata }); return {}; }
    if (name === 'HeadObjectCommand') { const o = objects.get(input.Key); if (!o) throw Object.assign(new Error('nf'), { $metadata: { httpStatusCode: 404 } }); return { ContentLength: headLength ?? o.body.length, Metadata: o.metadata }; }
    if (name === 'GetObjectCommand') { const o = objects.get(input.Key); if (!o) throw Object.assign(new Error('nf'), { $metadata: { httpStatusCode: 404 } }); return { Body: { transformToByteArray: async () => new Uint8Array(o.body) } }; }
    if (name === 'ListObjectsV2Command') { const keys = [...objects.keys()].filter(k => k.startsWith(input.Prefix)).sort(), start = input.ContinuationToken ? Number(input.ContinuationToken) : 0, page = keys.slice(start, start + pageSize);
      return { Contents: page.map(Key => ({ Key, Size: objects.get(Key).body.length })), IsTruncated: start + pageSize < keys.length, NextContinuationToken: String(start + pageSize) }; }
    if (name === 'DeleteObjectsCommand') { for (const { Key } of input.Delete.Objects) objects.delete(Key); return { Deleted: input.Delete.Objects }; }
    throw Error(`unexpected ${name}`);
  } };
}
const store = options => { const client = fakeClient(options); return { client, store: backups.createBackupStore(backups.loadBackupConfiguration(ENV), { client }) }; };

test('put verifies the stored size and sha-256 and refuses keys outside the prefix', async () => {
  const { client, store: s } = store();
  const body = Buffer.from('encrypted-dump'), k = key('c4g_central_staging', '20261113T023000Z');
  const result = await s.put({ key: k, body });
  assert.equal(result.size, body.length); assert.equal(result.sha256, createHash('sha256').update(body).digest('hex'));
  assert.equal(client.objects.get(k).metadata.sha256, result.sha256);
  await assert.rejects(s.put({ key: 'central/portugal2030/x', body }), { code: 'BACKUP_KEY_OUTSIDE_PREFIX' });
  await assert.rejects(s.get('documents/x'), { code: 'BACKUP_KEY_OUTSIDE_PREFIX' });
  await assert.rejects(s.remove(['central/x']), { code: 'BACKUP_KEY_OUTSIDE_PREFIX' });
  const wrong = store({ headLength: 3 });
  await assert.rejects(wrong.store.put({ key: k, body }), { code: 'BACKUP_UPLOAD_UNVERIFIED' });
  await assert.rejects(store({ failPut: true }).store.put({ key: k, body }), { code: 'BACKUP_R2_FAILED' });
  await assert.rejects(s.put({ key: k, body: Buffer.alloc(0) }), { code: 'BACKUP_EMPTY' });
});

test('list pages through every object, latest finds the newest dump, get returns the bytes', async () => {
  const { store: s } = store({ pageSize: 2 });
  for (const stamp of ['20261110T023000Z', '20261112T023000Z', '20261111T023000Z']) { await s.put({ key: key('c4g_central_staging', stamp), body: Buffer.from(`d-${stamp}`) }); await s.put({ key: key('c4g_central_staging', stamp, 'manifest'), body: Buffer.from('{}') }); }
  await s.put({ key: key('c4g_tenant_staging', '20261101T023000Z'), body: Buffer.from('t') });
  assert.equal((await s.list('c4g_central_staging')).length, 6);
  const latest = await s.latest('c4g_central_staging');
  assert.equal(latest.stamp, '20261112T023000Z'); assert.equal(latest.dumpKey, key('c4g_central_staging', '20261112T023000Z')); assert.equal(latest.manifestKey, key('c4g_central_staging', '20261112T023000Z', 'manifest'));
  assert.equal((await s.get(latest.dumpKey)).toString(), 'd-20261112T023000Z');
  assert.equal(await s.latest('c4g_unknown_db'), null);
});

test('remove deletes in batches of at most 1000', async () => {
  const { client, store: s } = store();
  const keys = Array.from({ length: 2300 }, (_, i) => key('c4g_central_staging', `2026${String(1 + (i % 12)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}${String(i % 60).padStart(2, '0')}00Z`));
  await s.remove([...new Set(keys)]);
  const deletes = client.calls.filter(([n]) => n === 'DeleteObjectsCommand');
  assert.ok(deletes.every(([, input]) => input.Delete.Objects.length <= 1000));
});

test('status reports the age of the latest copy and flags missing or stale databases', async () => {
  const { store: s } = store();
  await s.put({ key: key('c4g_central_staging', '20261113T023000Z'), body: Buffer.from('a') });
  await s.put({ key: key('c4g_tenant_staging', '20261110T023000Z'), body: Buffer.from('b') });
  const now = new Date(Date.UTC(2026, 10, 13, 12, 30));
  const report = await backups.statusReport(s, ['c4g_central_staging', 'c4g_tenant_staging', 'c4g_absent_db'], { now, maxAgeHours: 36 });
  assert.deepEqual(report.map(r => [r.database, r.ok]), [['c4g_central_staging', true], ['c4g_tenant_staging', false], ['c4g_absent_db', false]]);
  assert.equal(report[0].ageHours, 10); assert.equal(report[2].stamp, null);
});

test('prune is a dry run unless applied and never deletes the newest copy', async () => {
  const { client, store: s } = store();
  const now = new Date(Date.UTC(2026, 10, 13, 12));
  for (let i = 0; i < 40; i += 1) { await s.put({ key: key('c4g_central_staging', stampFor(i)), body: Buffer.from(`x${i}`) }); await s.put({ key: key('c4g_central_staging', stampFor(i), 'manifest'), body: Buffer.from('{}') }); }
  const before = client.objects.size;
  const dry = await backups.prune(s, ['c4g_central_staging'], { now, apply: false });
  assert.ok(dry.delete.length > 0); assert.equal(client.objects.size, before); assert.equal(dry.applied, false);
  const applied = await backups.prune(s, ['c4g_central_staging'], { now, apply: true });
  assert.equal(client.objects.size, before - applied.delete.length); assert.ok(client.objects.has(key('c4g_central_staging', stampFor(0))));
});

test('errors never expose credentials', async () => {
  const { store: s } = store({ failPut: true });
  try { await s.put({ key: key('c4g_central_staging', '20261113T023000Z'), body: Buffer.from('x') }); assert.fail('should throw'); }
  catch (error) { assert.ok(!JSON.stringify([error.message, error.code, error.stack]).includes('secret-value')); }
});

test('the command line puts, fetches the latest copy, reports status and prunes, with the right exit codes', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { run } = require('../scripts/staging/r2Backup');
  const { store: s } = store();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-backup-test-'));
  try {
    const file = path.join(dir, 'a.enc'), manifest = path.join(dir, 'a.json');
    fs.writeFileSync(file, 'cipher-bytes'); fs.writeFileSync(manifest, '{"auditEvents":3}');
    const now = new Date(Date.UTC(2026, 10, 13, 12));
    const put = await run(['put', file, '--database', 'c4g_central_staging', '--stamp', '20261113T023000Z'], ENV, { store: s, now });
    assert.equal(put.exitCode, 0); assert.equal(put.result.size, 12);
    await run(['put', manifest, '--database', 'c4g_central_staging', '--stamp', '20261113T023000Z', '--kind', 'manifest'], ENV, { store: s, now });
    const out = path.join(dir, 'out.enc'), outManifest = path.join(dir, 'out.json');
    const latest = await run(['latest', '--database', 'c4g_central_staging', '--out', out, '--manifest-out', outManifest], ENV, { store: s, now });
    assert.equal(latest.exitCode, 0); assert.equal(fs.readFileSync(out, 'utf8'), 'cipher-bytes'); assert.equal(fs.readFileSync(outManifest, 'utf8'), '{"auditEvents":3}');
    assert.equal((await run(['latest', '--database', 'c4g_absent_db', '--out', out], ENV, { store: s, now })).exitCode, 1);
    assert.equal((await run(['status', '--database', 'c4g_central_staging'], ENV, { store: s, now })).exitCode, 0);
    assert.equal((await run(['status', '--database', 'c4g_central_staging', '--database', 'c4g_absent_db'], ENV, { store: s, now })).exitCode, 1);
    assert.equal((await run(['status'], ENV, { store: s, now })).exitCode, 1, 'no database is not a pass');
    const dry = await run(['prune', '--database', 'c4g_central_staging'], ENV, { store: s, now });
    assert.deepEqual([dry.exitCode, dry.result.applied, dry.result.deleted], [0, false, 0]);
    for (const bad of [['unknown'], ['put'], ['put', file, '--database'], ['put', file, '--database', 'c4g_x', '--stamp', 'bad'], ['status', '--nope', 'x']]) await assert.rejects(run(bad, ENV, { store: s, now }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
