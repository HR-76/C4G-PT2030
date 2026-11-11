'use strict';
// Habitual EU legacy candidate archive, limited to one fully approved package.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const backup = require('../backend/scripts/localPlatform/backupOpportunityV2');
const pkg = require('../backend/src/security/opportunityEuLegacyPrearchiveMigrationPackage');
const { createEuLegacyArchiveBatchExecutor } = require('../backend/src/opportunities/v2/euLegacyArchiveBatchExecutor');
const { duringPause } = require('./opportunity-v2-window.cjs');
const { command, health, pools, resume, assertNoExternalSessions } = require('./eu-reconciliation-window.cjs');
const { stopAtIdle, validateBackup, safeState } = require('./eu-legacy-archive-window.cjs');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(cfg.root, file).replaceAll('\\', '/');
function fail(code) { throw Object.assign(Error(code), { code }); }
function input(argv) {
  if (argv.length !== 2 || argv[0] !== '--execute' || !path.isAbsolute(argv[1])) fail('EU_LEGACY_EXECUTION_MODE_REQUIRED');
  const file = argv[1], bytes = fs.readFileSync(file);
  if (bytes.length < 1 || bytes.length > 512 * 1024) fail('EU_LEGACY_EXECUTION_RECEIPTS_INVALID');
  const receipts = JSON.parse(bytes.toString('utf8'));
  if (receipts.packageId !== '1e849d47-89e1-4fad-b2cd-0208c0d348b8'
    || sha(bytes) !== '141d242c4804ea75a0ba3cae9cb83e2e122061e8f455ed8315930f254ac94b6e')
    fail('EU_LEGACY_EXECUTION_RECEIPTS_CHANGED');
  return { receipts, receiptSha256: sha(bytes) };
}
async function verifyBoundary({ central, tenant, restored, config, applicationName }) {
  const current = { central: sha(JSON.stringify(await backup.snapshot(central))),
    tenant: sha(JSON.stringify(await backup.snapshot(tenant))) };
  if (current.central !== restored.databases.central.contentSha256
    || current.tenant !== restored.databases.tenant.contentSha256) fail('EU_LEGACY_EXECUTION_BACKUP_DRIFT');
  for (const [file, expected] of Object.entries(restored.configuration)) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')
      || sha(fs.readFileSync(path.join(cfg.root, file))) !== expected.sha256)
      fail('EU_LEGACY_EXECUTION_CONFIG_DRIFT');
  }
  const sessions = (await central.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND application_name<>$2',
    [[config.centralDatabase, config.tenantDatabase], applicationName])).rows[0];
  if (sessions.n !== 0) fail('EU_LEGACY_EXECUTION_EXTERNAL_SESSIONS');
  await safeState(central, tenant);
  return { status: 'PASS', dataAndSequencesMatch: true, configurationMatches: true,
    externalSessions: 0, checkedAt: new Date().toISOString() };
}
async function main(argv = process.argv.slice(2)) {
  const selected = input(argv), config = cfg.readConfig();
  const state = JSON.parse(fs.readFileSync(path.join(cfg.root, '.tmp/local-platform/runtime.json')));
  require('../backend/scripts/localPlatform/prepareOpportunityInterests').target(config, state);
  require('../backend/scripts/localPlatform/runtime').runtimeEnvironment(config, state);
  if (!await health()) fail('EU_LEGACY_EXECUTION_HEALTH_REQUIRED');
  const windowId = randomUUID(), folder = path.join(cfg.root, 'output', 'eu-legacy-archive-execution-' + windowId);
  fs.mkdirSync(folder);
  const file = path.join(folder, 'execution.json');
  const observed = command('Inspect');
  const connections = pools(config, 'eu-legacy-archive-execution-' + windowId);
  const report = { kind: 'eu-legacy-archive-execution-v1', status: 'IN_PROGRESS',
    windowId, packageId: selected.receipts.packageId, receiptSha256: selected.receiptSha256,
    packageDigest: pkg.packageDigest, startedAt: new Date().toISOString(),
    sourceResumed: false, revisionsAccepted: 0, supervisorBefore: observed,
    migrationsMayHaveCommitted: false };
  const save = () => cfg.saveState(report, file); save();
  try {
    const before = createEuLegacyArchiveBatchExecutor({ pool: connections.central, workspaceRoot: cfg.root });
    report.preflight = await before.preflight(selected.receipts);
    report.workBefore = await safeState(connections.central, connections.tenant); save();
    await duringPause({
      pause: () => stopAtIdle({ connections, observed, report, save }),
      perform: async () => {
        await Promise.all(Object.values(connections).map(pool => pool.end()));
        await assertNoExternalSessions(config);
        const pauseProof = await backup.provePausedWindow({ windowId,
          packageDigest: pkg.packageDigest, profile: backup.LEGACY_PREARCHIVE_PROFILE,
          stopReceipt: report.stop });
        const restored = validateBackup(await backup.main(['--backup-and-restore'], { pauseProof }), windowId);
        const backupId = path.basename(restored.backup).slice('opportunity-v2-backup-'.length);
        const backupPath = path.join(cfg.root, 'output', 'opportunity-v2-window', windowId,
          'backup-restore-' + backupId + '.json');
        report.backup = { path: relative(backupPath), sha256: sha(fs.readFileSync(backupPath)) };
        save();
        const applicationName = 'eu-legacy-archive-boundary-' + windowId;
        const central = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 2,
          application_name: applicationName, options: '-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000' });
        const tenant = new Pool({ ...cfg.connection(config, config.tenantDatabase), max: 1,
          application_name: applicationName, options: '-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000' });
        try {
          report.boundary = await verifyBoundary({ central, tenant, restored, config, applicationName });
          const batch = createEuLegacyArchiveBatchExecutor({ pool: central, workspaceRoot: cfg.root });
          report.preflightAtBoundary = await batch.preflight(selected.receipts);
          save();
          report.migrationsMayHaveCommitted = true; save();
          report.installation = await require('../backend/scripts/runCentralMigrations')
            .applyRegisteredEuLegacyPrearchivePackage(central, pkg.PACKAGE_ID);
          report.migrationInstalledAt = new Date().toISOString(); save();
          const version = await require('../backend/src/security/centralMigrationPreflight').preflightCentral(central);
          if (version.currentVersion !== pkg.entry.version
            || version.fingerprint !== pkg.entry.schemaFingerprint) fail('EU_LEGACY_EXECUTION_045_MISMATCH');
          report.archive = await batch.execute(selected.receipts);
          if (report.archive.candidates !== 391) fail('EU_LEGACY_EXECUTION_RECONCILIATION_MISMATCH');
          save();
        } finally { await Promise.allSettled([central.end(), tenant.end()]); }
      },
      resume: () => report.stop ? resume({ report, save, prefix: 'eu-legacy-archive-execution-' + windowId }) : Promise.resolve()
    });
    if (!report.archive || report.healthRestored !== true) fail('EU_LEGACY_EXECUTION_INCOMPLETE');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.failure = /^[A-Z0-9_]{3,100}$/.test(error.code || error.message || '')
      ? (error.code || error.message) : 'EU_LEGACY_EXECUTION_FAILED';
    throw error;
  } finally {
    await Promise.allSettled(Object.values(connections).map(pool => pool.ended ? Promise.resolve() : pool.end()));
    report.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, windowId, packageId: report.packageId,
      migrationInstalled: Boolean(report.migrationInstalledAt), archive: report.archive || null,
      healthRestored: report.healthRestored === true, report: relative(file), failure: report.failure || null }));
  }
  return report;
}
if (require.main === module) main().catch(() => { process.exitCode = 1; });
module.exports = { input, verifyBoundary, main };
