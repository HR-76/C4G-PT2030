'use strict';
// Administração C4G → Cópias de segurança. Contract: context/features/platform-backups-page.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const backups = require('../src/backups/r2Backups');
const { summarise, createBackupOverview, configuredBackupOverview } = require('../src/backups/overview');
const { createPlatformDirectory } = require('../src/platformDirectory/service');
const { createPlatformDirectoryRouter } = require('../src/routes/platformDirectoryRoutes');

const PREFIX = 'backups/staging/';
const now = new Date('2026-11-23T12:00:00Z');
const object = (database, stamp, suffix, size = 10, modifiedAt = '2026-11-22T05:30:41Z') => ({ key: `${PREFIX}${database}/${stamp}.${suffix}`, size, modifiedAt });
const copy = (database, stamp, size) => [object(database, stamp, 'dump.enc', size), object(database, stamp, 'json', 1558)];

test('verification markers are recognised keys and leave with their copy', () => {
  const key = backups.objectKey(PREFIX, 'c4g_central_staging', '20261122T023000Z', 'verification');
  assert.equal(key, `${PREFIX}c4g_central_staging/20261122T023000Z.verified.json`);
  assert.deepEqual(backups.parseKey(PREFIX, key), { database: 'c4g_central_staging', stamp: '20261122T023000Z', kind: 'verification' });
  assert.throws(() => backups.objectKey(PREFIX, 'c4g_central_staging', '20261122T023000Z', 'other'), { code: 'BACKUP_KEY_INVALID' });
  const old = '20260101T023000Z', keys = [...copy('c4g_x', old), object('c4g_x', old, 'verified.json'), ...copy('c4g_x', '20261123T023000Z')].map(item => item.key);
  const plan = backups.planRetention(keys, { now, prefix: PREFIX, daily: 1, weekly: 0 });
  assert.deepEqual(plan.delete.sort(), keys.filter(item => item.includes(old)).sort());
});

test('summary reports each copy, the restore test and whether every database is covered', () => {
  const report = summarise([
    ...copy('c4g_central_staging', '20261123T023259Z', 12804688), ...copy('c4g_tenant_staging', '20261123T023259Z', 7037536),
    ...copy('c4g_central_staging', '20261122T023101Z', 12000000), object('c4g_central_staging', '20261122T023101Z', 'verified.json'),
    { key: `${PREFIX}c4g_central_staging/readme.txt`, size: 1 }, { key: 'central/portugal2030/abc', size: 1 }
  ], { prefix: PREFIX, now, maxAgeHours: 36 });
  assert.equal(report.status, 'OK');
  assert.equal(report.lastGoodAt, '2026-11-23T02:32:59.000Z');
  assert.equal(report.lastRestoreTestAt, '2026-11-22T05:30:41.000Z');
  assert.deepEqual(report.items.map(item => [item.database, item.file, item.state, item.sizeBytes]), [
    ['c4g_central_staging', '20261123T023259Z.dump.enc', 'AVAILABLE', 12804688],
    ['c4g_tenant_staging', '20261123T023259Z.dump.enc', 'AVAILABLE', 7037536],
    ['c4g_central_staging', '20261122T023101Z.dump.enc', 'RESTORE_TESTED', 12000000]]);
  assert.deepEqual(report.databases.map(item => [item.database, item.ok, item.ageHours]), [['c4g_central_staging', true, 9], ['c4g_tenant_staging', true, 9]]);
  assert.deepEqual(report.retention, { daily: 14, weekly: 8 });
  assert(!JSON.stringify(report).includes(PREFIX), 'the prefix and full keys stay on the server');
});

test('summary tells stale, incomplete and missing copies apart', () => {
  const stale = summarise([...copy('c4g_central_staging', '20261123T023259Z'), ...copy('c4g_tenant_staging', '20261120T023000Z')], { prefix: PREFIX, now, maxAgeHours: 36 });
  assert.equal(stale.status, 'STALE');
  assert.deepEqual(stale.databases.map(item => item.ok), [true, false]);
  assert.equal(stale.lastGoodAt, '2026-11-20T02:30:00.000Z');
  const incomplete = summarise([object('c4g_central_staging', '20261123T023259Z', 'dump.enc'), object('c4g_central_staging', '20261123T023259Z', 'verified.json')], { prefix: PREFIX, now, maxAgeHours: 36 });
  assert.equal(incomplete.status, 'STALE');
  assert.deepEqual([incomplete.items[0].state, incomplete.items[0].restoreTestedAt, incomplete.lastGoodAt], ['INCOMPLETE', null, null]);
  const empty = summarise([], { prefix: PREFIX, now, maxAgeHours: 36 });
  assert.deepEqual([empty.status, empty.lastGoodAt, empty.items.length], ['EMPTY', null, 0]);
});

test('overview lists the folder once per minute and never caches a failure', async () => {
  let clock = now.getTime(), calls = 0, fail = true;
  const store = { prefix: PREFIX, async objects() { calls += 1; if (fail) throw Object.assign(new Error('BACKUP_R2_FAILED'), { code: 'BACKUP_R2_FAILED' }); return copy('c4g_central_staging', '20261123T023259Z'); } };
  const overview = createBackupOverview({ store, now: () => new Date(clock) });
  await assert.rejects(overview.read(), { code: 'BACKUP_R2_FAILED' });
  fail = false;
  const [first, second] = await Promise.all([overview.read(), overview.read()]);
  assert.equal(first.status, 'OK'); assert.equal(second, first); assert.equal(calls, 2);
  clock += 30000; await overview.read(); assert.equal(calls, 2);
  clock += 31000; await overview.read(); assert.equal(calls, 3);
});

test('the runtime switch is opt-in and refuses unknown values', () => {
  assert.equal(configuredBackupOverview({ env: {} }), null);
  assert.equal(configuredBackupOverview({ env: { PLATFORM_BACKUPS_RUNTIME: 'disabled' } }), null);
  assert.throws(() => configuredBackupOverview({ env: { PLATFORM_BACKUPS_RUNTIME: 'on' } }), /Platform backups runtime/);
  assert.throws(() => configuredBackupOverview({ env: { PLATFORM_BACKUPS_RUNTIME: 'r2' } }), { code: 'BACKUP_R2_CONFIG_INVALID' });
  const overview = configuredBackupOverview({ env: { PLATFORM_BACKUPS_RUNTIME: 'r2', C4G_R2_ENDPOINT: 'https://abc123.eu.r2.cloudflarestorage.com',
    C4G_R2_DOCUMENTS_BUCKET: 'c4g-staging-documents', C4G_R2_ACCESS_KEY_ID: 'key-id', C4G_R2_SECRET_ACCESS_KEY: 'secret-value' } });
  assert.equal(typeof overview.read, 'function');
});

test('only a confirmed C4G administrator reaches the backups, outside the Central transaction', async () => {
  const user = '11111111-1111-4111-8111-111111111111', request = { authContext: { sessionId: 'session' }, sessionID: 'session', user: { id: user } };
  let admin = true, released = 0, reads = 0;
  const client = { async query(sql) { return sql.includes('SELECT u.id FROM') ? { rowCount: admin ? 1 : 0 } : { rows: [] }; }, release() { released += 1; } };
  const overview = { async read() { reads += 1; assert.equal(released, 1, 'the Central connection is released first'); return { status: 'OK' }; } };
  const service = createPlatformDirectory({ pool: { connect: async () => client }, backups: overview });
  assert.deepEqual(await service.backups({}, request), { status: 'OK' });
  await assert.rejects(service.backups({ page: '1' }, request), { code: 'INVALID_INPUT' });
  admin = false;
  await assert.rejects(service.backups({}, request), { code: 'C4G_ADMIN_REQUIRED' });
  await assert.rejects(service.backups({}, { ...request, sessionID: 'other' }), { code: 'C4G_ADMIN_REQUIRED' });
  assert.equal(reads, 1);
  admin = true;
  await assert.rejects(createPlatformDirectory({ pool: { connect: async () => client } }).backups({}, request), { code: 'BACKUPS_NOT_CONFIGURED' });
});

test('the route names an unconfigured environment and hides storage failures', async () => {
  const routes = [], express = { Router() { const r = { use() { return r; }, get(path, fn) { routes.push([path, fn]); return r; }, post() { return r; }, put() { return r; } }; return r; } };
  const answer = async error => {
    routes.length = 0;
    createPlatformDirectoryRouter({ express, authenticate() {}, service: { backups: async () => { throw error; } } });
    let status, body; const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await routes.find(([path]) => path === '/backups')[1]({ query: {}, body: {} }, res);
    return [status, body.error.code, JSON.stringify(body)];
  };
  assert.deepEqual((await answer(Object.assign(new Error('x'), { code: 'BACKUPS_NOT_CONFIGURED' }))).slice(0, 2), [503, 'BACKUPS_NOT_CONFIGURED']);
  const [status, code, text] = await answer(Object.assign(new Error('private bucket detail'), { code: 'BACKUP_R2_FAILED' }));
  assert.deepEqual([status, code], [503, 'SERVICE_UNAVAILABLE']); assert(!text.includes('private'));
  assert.equal((await answer(Object.assign(new Error('x'), { code: 'C4G_ADMIN_REQUIRED' })))[0], 403);
});
