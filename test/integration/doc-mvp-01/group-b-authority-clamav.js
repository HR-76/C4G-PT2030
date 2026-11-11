'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { preflightTenant } = require('../../../backend/src/security/tenantMigrationPreflight');
const { createMembershipRepository } = require('../../../backend/src/security/membershipRepository');
const { createApplicationComposition } = require('../../../backend/src/applications/composition');
const { createApplicationDocumentAuthorizationAdapter } = require('../../../backend/src/applications/documentAuthorizationAdapter');
const { createApplicationDocumentTransport } = require('../../../backend/src/documents/applicationTransport');
const { createDocumentRepository } = require('../../../backend/src/documents/repository');
const { createDocumentWorker } = require('../../../backend/src/documents/worker');
const { createScanService } = require('../../../backend/src/documents/scanService');
const { createClamavScanner } = require('../../../backend/src/documents/clamavScanner');
const { createF11ObjectStorageDouble } = require('../../../backend/test/support/f11ObjectStorageDouble');
const { load: loadAsyncMigration } = require('../../../backend/src/async/migrationManifest');

const PROOF = 'C4G_DOC_MVP01_AUTHORITY_CLAMAV_V1';
const TENANT_DB = 'doc_mvp01_authority_scanner_tenant';
const QUEUE_DB = 'doc_mvp01_authority_scanner_queue';
const CLAM_CONTAINER = 'c4g-doc-mvp01-clamav-20261024';
const ROLES = Object.freeze(['c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime']);
const FULL_PERMISSIONS = Object.freeze(['application.read', 'application.edit', 'opportunity.read',
  'document.read', 'document.download.request', 'document.upload.initiate', 'document.upload.confirm', 'document.version.create']);

function target() {
  if (process.env.DOC_MVP01_AUTHORITY_CLAMAV_PROOF !== PROOF) throw new Error('Exclusive authority/ClamAV proof is required.');
  const url = new URL(process.env.DOC_MVP01_AUTHORITY_CLAMAV_ADMIN_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55431' || url.pathname !== '/postgres') throw new Error('Unexpected PostgreSQL target.');
  const evidence = process.env.DOC_MVP01_AUTHORITY_CLAMAV_EVIDENCE;
  if (!evidence || !path.isAbsolute(evidence)) throw new Error('External evidence path is required.');
  if (process.env.DOC_MVP01_CLAMAV_CONTAINER !== CLAM_CONTAINER) throw new Error('Unexpected ClamAV container.');
  return Object.freeze({ url, evidence });
}
function databaseUrl(source, database) { const result = new URL(source.toString()); result.pathname = `/${database}`; return result.toString(); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function storedZip(name, content) {
  const filename = Buffer.from(name, 'utf8'), checksum = crc32(content);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + content.length, 16);
  return Buffer.concat([local, filename, content, central, filename, end]);
}
function request(label, identity) { return Object.freeze({ tenantId: identity.tenantId, databaseGenerationId: identity.databaseGenerationId,
  expectedRevision: 1, correlationId: `${label}-${crypto.randomUUID()}`, idempotencyKey: `${label}-${crypto.randomUUID()}` }); }
function unavailable(error) { return error?.code === 'DOCUMENT_NOT_AVAILABLE'; }
function normalized(row) { return Object.freeze({ organizationId: row.organization_id, versionId: row.version_id,
  documentId: row.document_id, objectId: row.object_id, lockVersion: Number(row.lock_version),
  observedSize: Number(row.observed_size), expectedSize: Number(row.expected_size), sha256: row.sha256,
  expectedSha256: row.expected_sha256, expectedFileClass: row.expected_file_class, deepInspectionComplete: false,
  state: row.state, scanState: row.scan_state }); }
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function waitForScanner(scanner) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await scanner.health()).ready) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('ClamAV did not become ready.');
}
async function createInfrastructure(admin) {
  for (const role of ROLES) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
  for (const database of [TENANT_DB, QUEUE_DB]) {
    await admin.query(`CREATE DATABASE ${database} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
    await admin.query(`ALTER DATABASE ${database} SET timezone TO 'UTC'`);
  }
  await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${TENANT_DB} TO c4g_tenant_owner`);
  await admin.query(`GRANT CONNECT ON DATABASE ${TENANT_DB} TO c4g_tenant_migrator,c4g_tenant_runtime`);
  const tenant = new Pool({ connectionString: databaseUrl(admin.options.connectionString, TENANT_DB), max: 12 });
  await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await tenant.query(`REVOKE CONNECT,TEMP ON DATABASE ${TENANT_DB} FROM PUBLIC`);
  await tenant.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${TENANT_DB} SET search_path TO pg_catalog,c4g_app`);
  return tenant;
}
async function seedApplication(pool, organizationId, membershipId, subjectId) {
  const opportunityId = crypto.randomUUID(), revisionId = crypto.randomUUID(), applicationId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO opportunity_catalog.opportunity(organization_id,opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version)
      VALUES($1,$2,$3,1,1,'ACTIVE','VALIDATED_MANUAL','Synthetic document opportunity','Synthetic funder',0,'LOW',$4,'opportunity-normalization-v1','opportunity-quality-v1')`, [organizationId, opportunityId, revisionId, 'd'.repeat(64)]);
    await client.query(`INSERT INTO opportunity_catalog.revision(organization_id,revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest)
      VALUES($1,$2,$3,1,1,'{}','{}','{}',$4)`, [organizationId, revisionId, opportunityId, 'd'.repeat(64)]);
    await client.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,status,created_by,total_budget,organization_budget)
      VALUES($1,$2,$3,'Synthetic document application',$4,'2027-12-31','IDENTIFIED',$5,'1000','500')`, [organizationId, applicationId, opportunityId, membershipId, subjectId]);
    await client.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,actor_subject_id,total_budget)
      VALUES($1,$2,1,'CREATE',NULL,'IDENTIFIED','Synthetic document application',$3,'2027-12-31',$4,'1000')`, [organizationId, applicationId, membershipId, subjectId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return Object.freeze({ opportunityId, revisionId, applicationId });
}
async function createQueue(source) {
  const connectionString = databaseUrl(source, QUEUE_DB), pool = new Pool({ connectionString, max: 3 });
  await pool.query(loadAsyncMigration('central', 'up').sql);
  const { PgBoss } = await import(pathToFileURL(require.resolve('../../../backend/node_modules/pg-boss')).href);
  const boss = new PgBoss({ connectionString, schema: 'pgboss', createSchema: false, migrate: false, supervise: false, schedule: false });
  await boss.start({ supervise: false, schedule: false });
  const queueName = 'c4g.document.scan'; if (!(await boss.getQueue(queueName))) await boss.createQueue(queueName);
  return Object.freeze({ pool, boss, queueName, async close() { await boss.stop({ graceful: true, timeout: 30000 }); await pool.end(); } });
}
async function run() {
  const { url, evidence } = target(); fs.mkdirSync(evidence, { recursive: true });
  const admin = new Pool({ connectionString: url.toString(), max: 3 }); let tenant, central, queue, fixture;
  const observations = { protectedLookups: 0, audit: [], queueJobs: [], denialCodes: [], applicationFailures: [], scannerCalls: [], scanner: {}, authority: {} };
  try {
    tenant = await createInfrastructure(admin);
    const identity = Object.freeze({ tenantId: crypto.randomUUID(), databaseGenerationId: crypto.randomUUID() });
    const migration = await createTenantMigrationRunner({ pool: tenant, entries: manifest, observationPublisher: { async publish() {} },
      timeoutMs: 60000, scheduler: { setTimeout, clearTimeout } }).migrate(request('authority-clamav-to031', identity));
    assert.equal(migration.evidence.currentVersion, '031_application_document_transport');
    const evidence031 = await preflightTenant(tenant, identity, manifest, { timeoutMs: 60000 });
    central = await require('../f13/central-authority-fixture').centralAuthorityFixture(url.toString(), { validateHistoricalRoundTrip: false });
    queue = await createQueue(url);
    const observedPool = Object.freeze({
      query: (...args) => tenant.query(...args),
      async connect() { const client = await tenant.connect(); return {
        on: (...args) => client.on(...args), removeListener: (...args) => client.removeListener(...args), release: error => client.release(error),
        async query(sql, values) { if (typeof sql === 'string' && sql.includes('FROM opportunity_catalog.application WHERE organization_id=$1 AND application_id=$2')) observations.protectedLookups += 1; return client.query(sql, values); }
      }; }
    });
    fixture = await require('../f13/runtime-fixture').runtimeFixture({ pool: observedPool, evidence: evidence031, sessions: { memberships: new Map() } });
    const membershipRepository = createMembershipRepository(central.pool, central.coordinator);
    fixture.dependencies.membershipRepository = membershipRepository;
    const org = identity.tenantId, otherOrg = crypto.randomUUID();
    async function actor(organizationId, permissions, { revoke = false } = {}) {
      const value = await central.user(organizationId, crypto.randomUUID(), crypto.randomUUID());
      const scope = { type: 'ORGANIZATION', id: organizationId, organizationId };
      await central.data.change({ organizationId, membershipId: value.membershipId, expectedVersion: 1,
        grants: permissions.map(permission => ({ permission, scope })), assuranceRequirements: central.requirement });
      if (revoke) await membershipRepository.changeStatus({ membershipId: value.membershipId, status: 'REMOVED', reason: 'LOCAL_PROOF' });
      return value;
    }
    const allowed = await actor(org, FULL_PERMISSIONS), denied = await actor(org, []), asymmetric = await actor(org, ['application.edit']);
    const revoked = await actor(org, FULL_PERMISSIONS, { revoke: true }), foreign = await actor(otherOrg, FULL_PERMISSIONS);
    const seeded = await seedApplication(tenant, org, allowed.membershipId, allowed.id);
    const applicationService = createApplicationComposition({ sessionStore: central.store, sessionRegistry: central.registry,
      authorityCoordinator: central.coordinator, centralPool: central.pool, authorizationCatalogs: central.catalogs,
      assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: central.requirement,
      tenantRuntimeDependencies: fixture.dependencies, tokenKeys: { local: crypto.randomBytes(32).toString('hex') }, tokenKeyId: 'local',
      onFailure(error) { observations.applicationFailures.push({ code: error?.code || null, internalCode: error?.internalCode || null, message: error?.message || null }); } });
    const accessPort = createApplicationDocumentAuthorizationAdapter({ applicationService });
    const repository = createDocumentRepository(tenant), baseStorage = createF11ObjectStorageDouble();
    const storage = Object.freeze({ ...baseStorage, async head(input) { const row = await baseStorage.head(input); return row && Object.freeze({ ...row, etag: row.sha256 }); } });
    const scanner = createClamavScanner({ organizationId: org, storage, host: '127.0.0.1', port: 53310, timeoutMs: 5000 });
    await waitForScanner(scanner); assert.deepEqual(await scanner.health(), { ready: true, adapter: 'clamav-instream-v1' });
    const audit = Object.freeze({ async accept(code) { observations.audit.push(code); }, async emit(code) { observations.audit.push(code); } });
    const reconciliation = Object.freeze({ async record(value) { observations.audit.push(value.code); } });
    const workerScanner = Object.freeze({ health: () => scanner.health(), async scan(input) { const result = await scanner.scan(input);
      observations.scannerCalls.push({ organizationMatches: input.organizationId === org, objectIdValid: /^[0-9a-f-]{36}$/i.test(input.objectId || ''),
        expectedSize: input.expectedSize, expectedSha256Length: input.expectedSha256?.length || 0, status: result.status }); return result; } });
    const worker = createDocumentWorker({ portsForOrganization: requested => { assert.equal(requested, org); return {
      repository, storage, scanService: createScanService({ scanner: workerScanner, repository, storage, audit }), audit, reconciliation }; } });
    const jobs = Object.freeze({ async enqueueScan(value) { const id = await queue.boss.send(queue.queueName, value, { retryLimit: 0 }); observations.queueJobs.push(id); } });
    const transport = createApplicationDocumentTransport({ accessPort, repositoryFactory: requested => { assert.equal(requested, org); return repository; },
      storageFactory: requested => { assert.equal(requested, org); return storage; }, auditFactory: () => audit,
      reconciliationFactory: () => reconciliation, jobs, clock: () => new Date(), id: crypto.randomUUID });
    const intentInput = (bytes, fileClass = 'PDF', declaredMime = 'application/pdf', filename = 'synthetic.pdf') => ({ expectedSize: bytes.length,
      declaredMime, filename, fileClass, checksum: sha(bytes), idempotencyKey: crypto.randomUUID(), versionNumber: 1 });
    async function expectUnavailable(requestValue, applicationId = seeded.applicationId) {
      const before = observations.protectedLookups;
      await assert.rejects(() => transport.createIntent({ request: requestValue, applicationId,
        input: intentInput(Buffer.from('%PDF-1.7\ndenied\n%%EOF')) }), error => { observations.denialCodes.push(error.code); return unavailable(error); });
      return observations.protectedLookups - before;
    }
    assert.equal(await expectUnavailable(denied.request), 0);
    assert.equal(await expectUnavailable(asymmetric.request), 0);
    assert.equal(await expectUnavailable(revoked.request), 0);
    assert.equal(await expectUnavailable(foreign.request), 0);
    assert.equal(await expectUnavailable(allowed.request, crypto.randomUUID()), 1);
    assert.equal(await expectUnavailable({ ...allowed.request, headers: { 'x-c4g-organization': otherOrg } }), 0);
    assert(observations.denialCodes.every(code => code === 'DOCUMENT_NOT_AVAILABLE'));
    async function upload(bytes, options = {}) {
      const input = intentInput(bytes, options.fileClass, options.declaredMime, options.filename);
      const intent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId, input });
      await transport.upload({ request: allowed.request, applicationId: seeded.applicationId, versionId: intent.versionId,
        token: intent.capability, source: Readable.from([bytes]) });
      return intent;
    }
    async function processOne({ expectedFailure = false } = {}) {
      const rows = await queue.boss.fetch(queue.queueName, { batchSize: 1 }); assert.equal(rows.length, 1); const job = rows[0];
      try { const result = await worker.handlers['document.scan']({ payload: job.data, fencingToken: `pgboss:${job.id}` });
        if (expectedFailure) assert.fail('Expected scanner failure.'); await queue.boss.complete(queue.queueName, job.id, result); return result; }
      catch (error) { await queue.boss.fail(queue.queueName, job.id, { code: 'LOCAL_SCANNER_UNAVAILABLE' }); if (!expectedFailure) throw error; assert.match(error.message, /MALWARE_SCANNER_UNAVAILABLE/); return null; }
    }
    const cleanBytes = Buffer.from('%PDF-1.7\nclean local scanner proof\n%%EOF');
    const clean = await upload(cleanBytes); await processOne();
    let cleanRow = await repository.findVersion({ organizationId: org, versionId: clean.versionId }); assert.equal(cleanRow.state, 'AVAILABLE'); assert.equal(cleanRow.scan_state, 'CLEAN');
    const linked = await applicationService.execute('documentLink', { expectedRevision: 1, idempotencyKey: crypto.randomUUID(), documentId: clean.documentId, versionId: clean.versionId }, seeded.applicationId, allowed.request);
    assert.equal(linked.versionId, clean.versionId);
    const authorizedDownload = await applicationService.execute('documentDownload', { versionId: clean.versionId }, seeded.applicationId, allowed.request);
    const download = await transport.download({ organizationId: authorizedDownload.organizationId, versionId: clean.versionId }); assert.equal(download.capability.kind, 'ABSTRACT_DOWNLOAD_CAPABILITY');
    const eicar = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
    const infected = await upload(storedZip('eicar.com', eicar), { fileClass: 'OOXML',
      declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'eicar.docx' });
    await processOne(); const infectedRow = await repository.findVersion({ organizationId: org, versionId: infected.versionId });
    assert.equal(infectedRow.state, 'QUARANTINED'); assert.equal(infectedRow.scan_state, 'INFECTED');
    await assert.rejects(() => applicationService.execute('documentLink', { expectedRevision: 2, idempotencyKey: crypto.randomUUID(), documentId: infected.documentId, versionId: infected.versionId }, seeded.applicationId, allowed.request));
    await assert.rejects(() => transport.download({ organizationId: org, versionId: infected.versionId }), unavailable);
    const ooxmlBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('synthetic ooxml without structural inspection')]);
    const ooxml = await upload(ooxmlBytes, { fileClass: 'OOXML', declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'synthetic.docx' });
    await processOne(); const ooxmlRow = await repository.findVersion({ organizationId: org, versionId: ooxml.versionId });
    assert.equal(ooxmlRow.state, 'QUARANTINED'); assert.equal(ooxmlRow.scan_state, 'CLEAN');
    await assert.rejects(() => transport.download({ organizationId: org, versionId: ooxml.versionId }), unavailable);
    const timeoutIntent = await upload(Buffer.from('%PDF-1.7\ntimeout proof\n%%EOF'));
    docker('pause', CLAM_CONTAINER); let paused = true;
    try { await processOne({ expectedFailure: true }); assert.equal((await repository.findVersion({ organizationId: org, versionId: timeoutIntent.versionId })).state, 'SCANNING'); }
    finally { if (paused) { docker('unpause', CLAM_CONTAINER); paused = false; } }
    await waitForScanner(scanner); await queue.boss.send(queue.queueName, { organizationId: org, versionId: timeoutIntent.versionId, correlationId: crypto.randomUUID() }, { retryLimit: 0 }); await processOne();
    assert.equal((await repository.findVersion({ organizationId: org, versionId: timeoutIntent.versionId })).state, 'AVAILABLE');
    const unavailableIntent = await upload(Buffer.from('%PDF-1.7\nunavailable proof\n%%EOF'));
    docker('stop', '--time', '5', CLAM_CONTAINER); let stopped = true;
    try { assert.equal((await scanner.health()).ready, false); await processOne({ expectedFailure: true }); assert.equal((await repository.findVersion({ organizationId: org, versionId: unavailableIntent.versionId })).state, 'SCANNING'); }
    finally { if (stopped) { docker('start', CLAM_CONTAINER); stopped = false; } }
    await waitForScanner(scanner); await queue.boss.send(queue.queueName, { organizationId: org, versionId: unavailableIntent.versionId, correlationId: crypto.randomUUID() }, { retryLimit: 0 }); await processOne();
    assert.equal((await repository.findVersion({ organizationId: org, versionId: unavailableIntent.versionId })).state, 'AVAILABLE');
    observations.scanner = Object.freeze({ clean: true, eicar: 'INFECTED', timeoutStayedScanning: true, unavailableStayedScanning: true,
      recoveredAfterRestore: true, ooxmlClamavResult: 'CLEAN', ooxmlState: 'QUARANTINED', structuralInspection: false });
    observations.authority = Object.freeze({ centralMigrations: (await central.pool.query('SELECT count(*)::int AS count FROM public.c4g_schema_migration')).rows[0].count,
      realCoordinatorObservations: central.observations.length, grantsExplicit: true, noProfileAutoGrant: true, protectedLookupOrder: true,
      absentGrantDenied: true, asymmetricGrantDenied: true, revokedMembershipDenied: true, foreignResourceDenied: true,
      missingResourceDenied: true, organizationSwapDenied: true, sessionIdentity: 'SYNTHETIC', membershipGrantsAuthority: 'REAL_CENTRAL' });
    const clamavVersion = docker('exec', CLAM_CONTAINER, 'clamdscan', '--version');
    const signatureInfo = docker('exec', CLAM_CONTAINER, 'sh', '-c', "sigtool --info /var/lib/clamav/daily.cld 2>/dev/null | grep -E 'Version:|Build time:|Signatures:'");
    const result = Object.freeze({ result: 'PASS', tenantVersion: evidence031.currentVersion, migrationFingerprint: evidence031.schemaFingerprint,
      postgres: { version: (await tenant.query('SHOW server_version')).rows[0].server_version, real: true }, queue: { adapter: 'pg-boss', real: true, jobs: observations.queueJobs.length },
      authority: observations.authority, scanner: observations.scanner, clamav: { version: clamavVersion, signatureInfo }, storage: 'LOCAL_DOUBLE',
      r2: 'NOT_CONTACTED', browser: 'NOT_EXECUTED', auditEvents: observations.audit, denialCodes: observations.denialCodes });
    fs.writeFileSync(path.join(evidence, 'authority-clamav-results.json'), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    error.applicationFailures = observations.applicationFailures;
    error.scannerCalls = observations.scannerCalls;
    throw error;
  } finally {
    try { if (docker('inspect', '-f', '{{.State.Paused}}', CLAM_CONTAINER) === 'true') docker('unpause', CLAM_CONTAINER); } catch {}
    try { if (docker('inspect', '-f', '{{.State.Status}}', CLAM_CONTAINER) !== 'running') docker('start', CLAM_CONTAINER); } catch {}
    if (fixture) await fixture.manager.closeAll().catch(() => {});
    if (queue) await queue.close().catch(() => {});
    if (central) await central.close().catch(error => process.stderr.write(`CENTRAL_CLEANUP:${error.code || error.message}\n`));
    if (tenant) await tenant.end().catch(() => {});
    for (const database of [QUEUE_DB, TENANT_DB]) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}
run().catch(error => { process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null, message: error.message, applicationFailures: error.applicationFailures || null, scannerCalls: error.scannerCalls || null, stack: error.stack?.split('\n').slice(0, 12) })}\n`); process.exitCode = 1; });
