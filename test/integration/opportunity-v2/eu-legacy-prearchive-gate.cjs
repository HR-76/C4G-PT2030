'use strict';
// Synthetic, disposable PostgreSQL 18 only. No habitual connection is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Pool } = require('../../../backend/node_modules/pg');
const root = path.resolve(__dirname, '../../..');
const pgBin = 'C:/Program Files/PostgreSQL/18/bin';
const hash = value => createHash('sha256').update(value).digest('hex');
function runPg(binary, args, password) {
  const result = spawnSync(path.join(pgBin, binary), args, { encoding: 'utf8', windowsHide: true,
    timeout: 120000, env: { ...process.env, PGPASSWORD: password } });
  if (result.status !== 0) throw Error(binary + '_FAILED:' + result.status + ':' + (result.stderr || '').slice(0, 500));
}
async function main(args = process.argv.slice(2)) {
  assert.deepEqual(args, ['--isolated'], 'EXPLICIT_ISOLATED_INVOCATION_REQUIRED');
  const id = randomUUID().replaceAll('-', ''), name = 'c4g-prearchive-' + id;
  const folder = path.join(root, 'output', 'eu-legacy-prearchive-gate-' + id);
  fs.mkdirSync(folder, { recursive: true });
  const report = { kind: 'EU_LEGACY_PREARCHIVE_GATE', isolated: true, habitualAccess: false,
    status: 'RUNNING', checks: [], startedAt: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  const check = async (label, fn) => { report.phase = label; save(); await fn(); report.checks.push(label); process.stdout.write('PASS ' + label + '\n'); };
  const password = randomBytes(32).toString('hex'), env = { ...process.env, POSTGRES_PASSWORD: password };
  const docker = values => execFileSync('docker', values, { encoding: 'utf8', windowsHide: true,
    timeout: 30000, env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let container, admin, central, tenant, restored;
  const owned = () => { assert.match(container, /^[a-f0-9]{64}$/);
    assert.equal(docker(['inspect', '--format', '{{index .Config.Labels "c4g.prearchive-gate"}}', container]), id);
    assert.equal(docker(['inspect', '--format', '{{.Name}}', container]), '/' + name); };
  try {
    await check('OWNED_POSTGRES18', async () => {
      const image = docker(['image', 'inspect', 'postgres:18-alpine', '--format', '{{.Id}}']);
      assert.match(image, /^sha256:[a-f0-9]{64}$/);
      container = docker(['run', '--detach', '--name', name, '--label', 'c4g.prearchive-gate=' + id,
        '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=c4g_f12_admin', '--env', 'POSTGRES_DB=postgres',
        '--tmpfs', '/var/lib/postgresql:rw', '-p', '127.0.0.1::5432', image]);
      owned();
      const binding = docker(['port', container, '5432/tcp']);
      assert.match(binding, /^127\.0\.0\.1:\d+$/);
      const connection = { host: '127.0.0.1', port: Number(binding.split(':')[1]), user: 'c4g_f12_admin',
        password, max: 4, connectionTimeoutMillis: 3000, query_timeout: 30000,
        options: '-c timezone=UTC -c statement_timeout=25000 -c lock_timeout=10000' };
      report.postgresPort = connection.port;
      admin = new Pool({ ...connection, database: 'postgres' });
      let ready = false; for (let n = 0; n < 80; n++) { try { await admin.query('SELECT 1'); ready = true; break; }
        catch { await new Promise(resolve => setTimeout(resolve, 250)); } } assert(ready);
      for (const role of ['c4g_central_owner', 'c4g_central_runtime', 'c4g_tenant_owner', 'c4g_tenant_migrator',
        'c4g_tenant_runtime', 'c4g_import_worker_runtime'])
        await admin.query(`CREATE ROLE ${role} NOLOGIN ${role.startsWith('c4g_central_') ? 'INHERIT' : 'NOINHERIT'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
      for (const db of ['registered_central', 'registered_tenant', 'restored_central']) {
        await admin.query(`CREATE DATABASE ${db} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
        await admin.query(`REVOKE CONNECT,TEMP ON DATABASE ${db} FROM PUBLIC`);
      }
      await admin.query('GRANT CONNECT,CREATE ON DATABASE registered_tenant TO c4g_tenant_owner');
      await admin.query('GRANT CONNECT ON DATABASE registered_tenant TO c4g_tenant_migrator,c4g_tenant_runtime');
      central = new Pool({ ...connection, database: 'registered_central' });
      tenant = new Pool({ ...connection, database: 'registered_tenant' });
      restored = new Pool({ ...connection, database: 'restored_central' });
      await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await admin.query('ALTER ROLE c4g_tenant_runtime IN DATABASE registered_tenant SET search_path TO pg_catalog,c4g_app');
    });
    await check('SYNTHETIC_BASELINE_044', async () => {
      const fixture = await require('./executor-11145-fixture.cjs').bootstrap(central, tenant);
      report.legacyId = fixture.legacy.externalIdentifier;
      const cm = require('../../../backend/src/security/centralMigrationManifest');
      const migration = require('../../../backend/scripts/runCentralMigrations');
      await migration.applyCentralMigrationsWithManifest(central, cm.reconciliationManifest, cm.migrationSql,
        { ledgerEntries: cm.knownManifest });
      assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,
        '044_opportunity_eu_expired_reconciliation');
    });
    const backup = path.join(folder, 'central044.dump');
    await check('BACKUP_AND_RESTORE_044', async () => {
      const port = String(report.postgresPort), common = ['-h', '127.0.0.1', '-p', port, '-U', 'c4g_f12_admin'];
      runPg('pg_dump.exe', [...common, '-Fc', '-f', backup, 'registered_central'], password);
      report.backupSha256 = hash(fs.readFileSync(backup));
      runPg('pg_restore.exe', [...common, '--exit-on-error', '-d', 'restored_central', backup], password);
      const original = (await central.query('SELECT count(*)::int AS n FROM opportunity_catalog.opportunity')).rows[0].n;
      const copy = (await restored.query('SELECT count(*)::int AS n FROM opportunity_catalog.opportunity')).rows[0].n;
      assert.equal(copy, original);
      assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(restored)).currentVersion,
        '044_opportunity_eu_expired_reconciliation');
      report.restoredOpportunityCount = copy;
    });
    await check('INSTALL_045_RESTORED_ONLY', async () => {
      const sql = fs.readFileSync(path.join(root, 'backend/database/central/candidates/opportunity_eu_legacy_prearchive.up.sql'), 'utf8').replace(/\r\n/g, '\n');
      report.upChecksum = hash(sql);
      const pkg = require('../../../backend/src/security/opportunityEuLegacyPrearchiveMigrationPackage');
      assert.deepEqual(await require('../../../backend/scripts/runCentralMigrations')
        .applyRegisteredEuLegacyPrearchivePackage(restored, pkg.PACKAGE_ID), [pkg.entry.version]);
      assert.equal((await require('../../../backend/src/security/centralMigrationPreflight')
        .preflightCentral(restored)).currentVersion, pkg.entry.version);
      const schema = require('../../../backend/src/security/centralSchemaManifest');
      const authority = require('../../../backend/src/security/authoritySecurityManifest');
      const catalog = require('../../../backend/src/security/catalogSecurityManifest');
      const writer = require('../../../backend/src/security/euWriterSecurityManifest');
      const reconciliation = require('../../../backend/src/security/euRunReconciliationSecurityManifest');
      report.fingerprints = {
        schema: schema.schemaFingerprint(await schema.centralSchemaSnapshot(restored)),
        authority: authority.digest(await authority.authoritySecuritySnapshot(restored)),
        catalog: catalog.digest(await catalog.catalogSecuritySnapshot(restored)),
        writer: writer.digest(await writer.euWriterSecuritySnapshot(restored)),
        reconciliation: reconciliation.digest(await reconciliation.euRunReconciliationSecuritySnapshot(restored)),
        prearchive: await (async () => { const security = require('../../../backend/src/security/euLegacyPrearchiveSecurityManifest');
          return security.digest(await security.snapshot(restored)); })()
      };
    });
    await check('DIRECT_INSERT_REJECTED_WITHOUT_RECEIPT', async () => {
      const identity = (await restored.query('SELECT external_identifier FROM opportunity_catalog.funding_identity LIMIT 1')).rows[0];
      assert(identity);
      const runId = randomUUID();
      const actorId = (await restored.query('SELECT id FROM public.global_user LIMIT 1')).rows[0].id;
      await restored.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code,observed_at,finished_at,error_code) VALUES($1,$2,$3,'ERROR','EU_FUNDING_TENDERS',clock_timestamp(),clock_timestamp(),'ISOLATED_NO_RECEIPT')", [runId, randomUUID(), actorId]);
      const query = `INSERT INTO opportunity_catalog.funding_candidate_v2(run_id,external_identifier,source_selection,observed_at,snapshot_schema_version,mapping_version,content_digest,payload_digest,canonical_snapshot,source_evidence,evidence_fingerprint,evidence_sha256)
        VALUES($1,$2,'EU_FUNDING_TENDERS',clock_timestamp(),2,'isolated-v1',$3,$4,
        '{"schemaVersion":2,"contractVersion":"opportunity-v2.0","provenance":{"mappingVersion":"isolated-v1"}}'::jsonb,
        $5::json,$6,$7)`;
      const content = 'a'.repeat(64), payload = 'b'.repeat(64), evidence = 'c'.repeat(64);
      await assert.rejects(restored.query(query, [runId, identity.external_identifier, content, payload,
        JSON.stringify({ externalIdentifier: identity.external_identifier, fingerprint: evidence }), evidence, 'd'.repeat(64)]),
      /FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED/);
      report.directInsertRejected = true;
    });
    await check('OIDC_EVENT_EXACT_CANDIDATE_AND_SINGLE_USE', async () => {
      const { createUuidV7 } = require('../../../backend/src/audit/uuidV7');
      const { approvalEvent } = require('../../../backend/src/opportunities/v2/euLegacyPreapproval');
      const { createAppendService } = require('../../../backend/src/audit/appendService');
      const { PostgresAppendRepository } = require('../../../backend/src/audit/postgresAppendRepository');
      const config = require('../../../backend/src/fundingTenders/euWriter').euWriterConfiguration();
      const actorId = (await restored.query('SELECT id FROM public.global_user LIMIT 1')).rows[0].id;
      const identity = (await restored.query(`SELECT f.external_identifier,o.opportunity_id,o.current_revision_id,o.row_version
        FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id) LIMIT 1`)).rows[0];
      const source = 'opportunity_catalog.eu_source_control_v2';
      await restored.query(`UPDATE ${source} SET state='SUSPEND_REQUESTED',fence=2,changed_by=$1 WHERE family='EU_FUNDING_TENDERS'`, [actorId]);
      await restored.query(`UPDATE ${source} SET state='QUIESCED',fence=3,changed_by=$1 WHERE family='EU_FUNDING_TENDERS'`, [actorId]);
      await restored.query(`UPDATE ${source} SET fence=4,changed_by=$1,eu_writer_mode='CANONICAL_V2',eu_writer_policy=$2,eu_writer_mapping_digest=$3 WHERE family='EU_FUNDING_TENDERS'`,
        [actorId, config.policyVersion, config.mappingDigest]);
      const raw = JSON.parse(fs.readFileSync(path.join(root, 'context/references/opportunity-v2/evidence/eu-11145.json'), 'utf8'));
      const observedAt = new Date().toISOString();
      const sourceEvidence = require('../../../backend/src/fundingTenders/sourceEvidence').buildEvidence(
        identity.external_identifier, raw.results);
      const snapshot = require('../../../backend/src/fundingTenders/adapterV2').adaptEuOpportunityV2(
        sourceEvidence, { observedAt });
      const content = require('../../../backend/src/opportunities/v2/digests').contentDigestV2(snapshot);
      const evidence = sourceEvidence.fingerprint, payload = 'b'.repeat(64);
      const itemDigest = 'e'.repeat(64), bindingDigest = 'f'.repeat(64);
      const createdAt = new Date(Date.now() - 1000).toISOString(), expiresAt = new Date(Date.now() + 1200000).toISOString();
      const requestId = createUuidV7(), packageId = randomUUID();
      const loaded = { item: { externalIdentifier: identity.external_identifier, itemDigest,
        contentDigest: content, evidenceFingerprint: evidence, action: 'CHANGE_REQUIRES_APPROVAL',
        expected: { opportunityId: identity.opportunity_id, revisionId: identity.current_revision_id,
          rowVersion: identity.row_version } }, bindingDigest,
        binding: { sourceFence: 4, expected: { opportunityId: identity.opportunity_id,
          revisionId: identity.current_revision_id, rowVersion: identity.row_version } },
        artifact: { outcome: 'FOUND', externalIdentifier: identity.external_identifier,
          observedAt, received: sourceEvidence.variants.length, evidence: sourceEvidence,
          snapshot, sourceFields: {}, contentDigest: content, mappingDigest: 'isolated-observed' },
        plan: { packageId, createdAt, expiresAt } };
      const client = await restored.connect(); let event;
      try {
        await client.query('BEGIN'); await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
        const platform = { query(sql, values) { return client.query(sql.replace('audit.prepare_append_v1',
          'audit.prepare_platform_append_v1').replace('audit.append_event_v1', 'audit.append_platform_event_v1'), values); } };
        event = await createAppendService({ appendPort: new PostgresAppendRepository() }).append(
          approvalEvent(loaded, { requestId }, actorId), platform);
        assert.equal(event.status, 'APPENDED');
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      const auth = `SELECT opportunity_catalog.authorize_eu_legacy_prearchive_v1(
        $1::uuid,$2::text,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,
        $9::uuid,$10::uuid,$11::integer,$12::integer,$13::timestamptz,$14::timestamptz,$15::text,$16::text) AS status`;
      const params = [event.eventId, event.eventHash, actorId, event.eventId, identity.external_identifier, payload,
        bindingDigest, itemDigest, identity.opportunity_id, identity.current_revision_id,
        identity.row_version, 4, createdAt, expiresAt, content, evidence];
      const receipt = { scope: 'PREARCHIVE_ONLY', packageId, externalIdentifier: identity.external_identifier,
        itemDigest, bindingDigest, requestId, actorId, eventId: event.eventId,
        eventHash: event.eventHash, expiresAt, replayed: false };
      const candidateArchive = require('../../../backend/src/fundingTenders/candidateRepositoryV2')
        .createCandidateArchiveV2({ packageLoader: () => loaded });
      const migrationRun = require('../../../backend/src/opportunities/v2/euLegacyArchiveBatch')
        .migrationRun(loaded, receipt, config);
      const createExecutor = require('../../../backend/src/opportunities/v2/euLegacyArchiveExecutor')
        .createEuLegacyArchiveExecutor;
      const current = async db => {
        const state = (await db.query(`SELECT state,fence FROM ${source}
          WHERE family='EU_FUNDING_TENDERS' FOR SHARE`)).rows[0];
        const head = (await db.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version
          FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id)
          WHERE f.external_identifier=$1 FOR SHARE OF o`, [identity.external_identifier])).rows[0];
        assert.equal(state.state, 'QUIESCED'); assert.equal(state.fence, 4);
        assert.equal(head.opportunity_id, identity.opportunity_id);
        assert.equal(head.current_revision_id, identity.current_revision_id);
        assert.equal(head.row_version, identity.row_version);
        assert.equal(head.current_schema_version, 1);
      };
      const executor = createExecutor({ pool: restored, archive: candidateArchive,
        load: () => loaded, current });
      const archive = await restored.connect(); let stored;
      try {
        for (const changed of [
          [event.eventId, '0'.repeat(64), ...params.slice(2)],
          params.map((part, index) => index === 2 ? randomUUID() : part),
          params.map((part, index) => index === 14 ? '0'.repeat(64) : part),
          params.map((part, index) => index === 15 ? '0'.repeat(64) : part),
          params.map((part, index) => index === 11 ? 5 : part)
        ]) {
          await archive.query('BEGIN'); await archive.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
          await assert.rejects(archive.query(auth, changed),
            /FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED|FUNDING_V2_PREARCHIVE_STATE_CHANGED/);
          await archive.query('ROLLBACK');
        }
        const rollbackExecutor = createExecutor({ pool: restored, load: () => loaded, current,
          archive: { stageLegacyMigration: candidateArchive.stageLegacyMigration,
            async verify() { throw Error('ISOLATED_ROLLBACK_INJECTION'); } } });
        await assert.rejects(rollbackExecutor.executeOne(receipt),
          { code: 'EU_LEGACY_ARCHIVE_UNAVAILABLE' });
        assert.equal((await archive.query('SELECT count(*)::int n FROM opportunity_catalog.funding_run WHERE run_id=$1',
          [event.eventId])).rows[0].n, 0);
        assert.equal((await archive.query('SELECT count(*)::int n FROM opportunity_catalog.eu_legacy_prearchive_use_v1 WHERE event_id=$1',
          [event.eventId])).rows[0].n, 0);
        stored = await executor.executeOne(receipt);
        assert.equal(stored.status, 'ARCHIVED');
        assert.equal(stored.contentDigest, content);
        assert.equal((await executor.executeOne(receipt)).status, 'ALREADY_ARCHIVED');
        assert.equal((await candidateArchive.verify(archive, { run: migrationRun,
          externalIdentifier: identity.external_identifier })).contentDigest, content);
      } catch (error) { await archive.query('ROLLBACK').catch(() => {}); throw error; } finally { archive.release(); }
      const verifier = await restored.connect();
      try {
        await verifier.query('BEGIN'); await verifier.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
        assert.equal((await candidateArchive.stageLegacyMigration(verifier, { loaded, receipt })).stored, false);
        await assert.rejects(verifier.query('SELECT count(*) FROM audit.event'), /permission denied|row-level security/);
        await verifier.query('ROLLBACK');
      } catch (error) { await verifier.query('ROLLBACK').catch(() => {}); throw error; } finally { verifier.release(); }
      assert.equal((await restored.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_candidate_v2 WHERE run_id=$1', [event.eventId])).rows[0].n, 1);
      const { loadVerifiedActivationArchive } = require('../../../backend/src/opportunities/v2/activationArchive');
      const { createAcceptedOpportunityV2Repository } = require('../../../backend/src/opportunities/v2/acceptedRepository');
      const locator = { kind: 'FUNDING', runId: event.eventId, externalIdentifier: identity.external_identifier };
      const acceptance = await restored.connect();
      try {
        await acceptance.query('BEGIN'); await acceptance.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
        await assert.rejects(loadVerifiedActivationArchive(acceptance, locator),
          { code: 'OPPORTUNITY_V2_SOURCE_RUN_NOT_COMPLETE' });
        await acceptance.query('ROLLBACK');
        await acceptance.query('BEGIN'); await acceptance.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
        const bounded = await loadVerifiedActivationArchive(acceptance, locator,
          { allowLegacyPrearchive: true });
        assert.equal(bounded.payloadDigest, stored.payloadDigest);
        const writer = createAcceptedOpportunityV2Repository({ pool: restored,
          authorize: async () => true, verifyApproval: async () => true, audit: async () => {} });
        const expected = { opportunityId: identity.opportunity_id, revisionId: identity.current_revision_id,
          rowVersion: Number(identity.row_version) };
        const raw = { requestId: 'isolated-legacy-acceptance-0001', candidateId: bounded.candidateId,
          snapshot: bounded.snapshot, mappingDigest: bounded.mappingDigest, expected };
        report.acceptancePhase = 'PREVIEW';
        const preview = await writer.previewInTransaction(acceptance, raw, {});
        assert.equal(preview.items[0].action, 'CHANGE_REQUIRES_APPROVAL');
        report.acceptancePhase = 'WRITE';
        const result = await writer.acceptInTransaction(acceptance,
          { ...raw, approvalDigest: preview.previewDigest }, {});
        assert.equal(result.action, 'REVISION_CREATED');
        assert.equal(result.opportunityId, identity.opportunity_id);
        assert.equal(result.sourceVersion, 2);
        await acceptance.query('ROLLBACK');
        assert.equal((await restored.query('SELECT current_schema_version FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',
          [identity.opportunity_id])).rows[0].current_schema_version, 1);
      } catch (error) { await acceptance.query('ROLLBACK').catch(() => {}); throw error; }
      finally { acceptance.release(); }
      assert.equal((await restored.query(`SELECT state FROM ${source} WHERE family='EU_FUNDING_TENDERS'`)).rows[0].state, 'QUIESCED');
      report.syntheticApprovedCandidate = true;
    });
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failure = { code: error.code || 'GATE_FAILED', message: String(error.message || '').slice(0, 800),
      phase: report.phase, detail: error.position || null };
    process.stdout.write('FAIL ' + report.phase + ' ' + report.failure.code + '\n');
  } finally {
    await Promise.allSettled([restored, tenant, central, admin].filter(Boolean).map(pool => pool.end()));
    try { if (container) { owned(); docker(['rm', '-f', container]);
      assert.equal(docker(['ps', '-aq', '--filter', 'label=c4g.prearchive-gate=' + id]), ''); }
      report.cleanup = true; } catch { report.cleanup = false; report.status = 'FAIL'; }
    report.finishedAt = new Date().toISOString(); save();
    process.stdout.write(JSON.stringify({ status: report.status, cleanup: report.cleanup,
      report: path.relative(root, path.join(folder, 'report.json')).replaceAll('\\', '/') }) + '\n');
  }
  if (report.status !== 'PASS') throw Error('PREARCHIVE_GATE_FAILED_SEE_REPORT');
  return report;
}
if (require.main === module) main().catch(() => { process.exitCode = 1; });
module.exports = { main };
