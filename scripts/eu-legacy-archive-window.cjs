'use strict';
// Prepare only: pause, back up habitual Central/tenant, restore to an owned
// cluster, verify parity, resume. No migration, candidate or source write.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const cfg = require('../backend/scripts/localPlatform/config');
const backup = require('../backend/scripts/localPlatform/backupOpportunityV2');
const pkg = require('../backend/src/security/opportunityEuLegacyPrearchiveMigrationPackage');
const { duringPause, release } = require('./opportunity-v2-window.cjs');
const { command, health, acquire, pools, resume, assertNoExternalSessions } = require('./eu-reconciliation-window.cjs');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(cfg.root, file).replaceAll('\\', '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fail(code) { throw Object.assign(Error(code), { code }); }
async function safeState(central, tenant) {
  const source = (await central.query("SELECT state,fence,eu_writer_mode FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];
  if (source?.state !== 'QUIESCED' || Number(source.fence) !== 7
    || source.eu_writer_mode !== 'CANONICAL_V2') fail('EU_LEGACY_WINDOW_SOURCE_CHANGED');
  const c = await backup.pendingWork(central, 'central');
  const t = await backup.pendingWork(tenant, 'tenant');
  if (!backup.isQuiescentWork(c, 'central') || !backup.isQuiescentWork(t, 'tenant')) fail('EU_LEGACY_WINDOW_PENDING_WORK');
  return { source, central: c, tenant: t };
}
async function stopAtIdle({ connections, observed, report, save }) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const clients = [];
    let stopped = false;
    try {
      clients.push(await acquire(connections.central));
      clients.push(await acquire(connections.tenant));
      report.workBefore = await safeState(clients[0], clients[1]);
      report.stop = command('Stop', ['-ExpectedId', String(observed.id), '-ExpectedCreated', observed.created]);
      report.pausedAt = new Date().toISOString();
      save(); stopped = true;
    } catch (error) {
      if (report.stop || !['55P03', '57014', 'EU_LEGACY_WINDOW_PENDING_WORK'].includes(error.code)) throw error;
    } finally { await release(clients); }
    if (stopped) return;
    await sleep(1500);
  }
  fail('EU_LEGACY_WINDOW_NO_IDLE_PERIOD');
}
function validateBackup(value, windowId) {
  assert.equal(value.status, 'PASS');
  assert.equal(value.windowId, windowId);
  assert.equal(value.packageDigest, pkg.packageDigest);
  assert.equal(value.profile, backup.LEGACY_PREARCHIVE_PROFILE);
  for (const key of ['cleanup', 'noSourceDrift', 'aclRestricted', 'globalsMatch']) assert.equal(value[key], true);
  for (const name of ['central', 'tenant']) {
    const b = value.baselines[name];
    backup.assertBaseline({ currentVersion: b.version, fingerprint: b.fingerprint, postgresMajor: 18 },
      name, backup.LEGACY_PREARCHIVE_PROFILE);
    for (const key of ['dataMatches', 'sourceStillMatches', 'preflight']) assert.equal(value.databases[name][key], true);
  }
  return value;
}
async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== '--prepare-window') fail('EU_LEGACY_WINDOW_MODE_REQUIRED');
  const config = cfg.readConfig();
  const state = JSON.parse(fs.readFileSync(path.join(cfg.root, '.tmp/local-platform/runtime.json')));
  require('../backend/scripts/localPlatform/prepareOpportunityInterests').target(config, state);
  require('../backend/scripts/localPlatform/runtime').runtimeEnvironment(config, state);
  if (!await health()) fail('EU_LEGACY_WINDOW_HEALTH_REQUIRED');
  const windowId = randomUUID();
  const folder = path.join(cfg.root, 'output', 'eu-legacy-archive-window-' + windowId);
  fs.mkdirSync(folder);
  const file = path.join(folder, 'preparation.json');
  const connections = pools(config, 'eu-legacy-archive-preparation-' + windowId);
  const observed = command('Inspect');
  const report = { kind: 'eu-legacy-archive-preparation-v1', windowId, status: 'IN_PROGRESS',
    startedAt: new Date().toISOString(), packageDigest: pkg.packageDigest,
    migrationsApplied: false, candidatesArchived: 0, sourceResumed: false,
    supervisorBefore: observed };
  const save = () => cfg.saveState(report, file);
  save();
  try {
    report.workBefore = await safeState(connections.central, connections.tenant);
    await duringPause({
      pause: () => stopAtIdle({ connections, observed, report, save }),
      perform: async () => {
        await Promise.all(Object.values(connections).map(pool => pool.end()));
        await assertNoExternalSessions(config);
        const pauseProof = await backup.provePausedWindow({ windowId,
          packageDigest: pkg.packageDigest, profile: backup.LEGACY_PREARCHIVE_PROFILE,
          stopReceipt: report.stop });
        const result = validateBackup(await backup.main(['--backup-and-restore'], { pauseProof }), windowId);
        const backupId = path.basename(result.backup).slice('opportunity-v2-backup-'.length);
        const backupPath = path.join(cfg.root, 'output', 'opportunity-v2-window', windowId,
          'backup-restore-' + backupId + '.json');
        const bytes = fs.readFileSync(backupPath);
        assert.deepEqual(JSON.parse(bytes), JSON.parse(JSON.stringify(result)));
        report.backup = { path: relative(backupPath), sha256: sha(bytes), backupId };
        save();
      },
      resume: () => report.stop ? resume({ report, save, prefix: 'eu-legacy-archive-' + windowId }) : Promise.resolve()
    });
    if (report.healthRestored !== true || !report.backup) fail('EU_LEGACY_WINDOW_RESTORE_INCOMPLETE');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failure = /^[A-Z0-9_]{3,100}$/.test(error.code || error.message || '')
      ? (error.code || error.message) : 'EU_LEGACY_WINDOW_PREPARATION_FAILED';
    throw error;
  } finally {
    await Promise.allSettled(Object.values(connections).map(pool => pool.ended ? Promise.resolve() : pool.end()));
    report.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, windowId,
      backup: report.backup || null, healthRestored: report.healthRestored === true,
      report: relative(file), failure: report.failure || null }));
  }
  return report;
}
if (require.main === module) main().catch(() => { process.exitCode = 1; });
module.exports = { safeState, stopAtIdle, validateBackup, main };
