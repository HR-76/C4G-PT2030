'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { AsyncLocalStorage } = require('node:async_hooks');
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
const { createR2AdapterBoundary } = require('../../../backend/src/documents/r2Adapter');
const { loadApplicationDocumentConfiguration } = require('../../../backend/src/config/applicationDocuments');
const { LIMITS } = require('../../../backend/src/documents/constants');
const s3 = require('../../../backend/node_modules/@aws-sdk/client-s3');
const { NodeHttpHandler } = require('../../../backend/node_modules/@smithy/node-http-handler');
const { load: loadAsyncMigration } = require('../../../backend/src/async/migrationManifest');
const { createProofSafeguards, reconstructProofJournal } = require('./r2-proof-safeguards');

const PROOF = 'C4G_DOC_MVP01_R2_V1';
const TENANT_DB = 'doc_mvp01_r2_tenant';
const QUEUE_DB = 'doc_mvp01_r2_queue';
const CLAM_CONTAINER = 'c4g-doc-mvp01-clamav-20261024';
const REMOTE_PLAN = Object.freeze({ previousProposedRequestLimit: 96, authorizationRevisionRequired: false,
  functionalRequestLimit: 74, cleanupRequestReserve: 32, totalRequestLimit: 106,
  applicationPayloadByteLimit: 64 * 1024 * 1024, applicationPayloadDefinition: 'Known document payload bytes reserved before PutObject, UploadPart, ranged GetObject, and presigned GET attempts; excludes HTTP/TLS/provider metadata and error bodies.',
  cumulativeObjectIntentions: 10, maximumCompletedObjects: 9, cumulativeMultipartIntentions: 3,
  maximumUnresolvedMultipart: 2, signedUrlTtlSeconds: 300,
  operations: Object.freeze(['HeadBucket', 'ListObjectsV2(prefix)', 'ListMultipartUploads(prefix)', 'PutObject', 'HeadObject',
    'GetObject/range', 'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload', 'AbortMultipartUpload', 'DeleteObject', 'presigned GET']) });
const PREVIOUS_SAFEGUARD_LIMITS = Object.freeze({ functionalRequests: 64, cleanupRequests: 32,
  applicationBytes: 64 * 1024 * 1024, objectIntentions: 8, completedObjects: 7,
  multipartIntentions: 3, unresolvedMultipart: 2 });
const SAFEGUARD_LIMITS = Object.freeze({ functionalRequests: 74, cleanupRequests: 32,
  applicationBytes: 64 * 1024 * 1024, objectIntentions: 10, completedObjects: 9,
  multipartIntentions: 3, unresolvedMultipart: 2 });
const RESUME_BASELINE = Object.freeze({ functionalRequests: 13, cleanupRequests: 4,
  applicationBytes: 172, objectIntentions: 2, completedObjects: 2,
  multipartIntentions: 0, unresolvedMultipart: 0 });
const REMAINING_PLAN = Object.freeze({ functionalRequests: 61, cleanupRequests: 21,
  maximumApplicationBytes: 57 * 1024 * 1024, objectIntentions: 8, completedObjects: 7,
  multipartIntentions: 3, unresolvedMultipart: 2 });
const ROLES = Object.freeze(['c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime']);
const FULL_PERMISSIONS = Object.freeze(['application.read', 'application.edit', 'opportunity.read',
  'document.read', 'document.download.request', 'document.upload.initiate', 'document.upload.confirm', 'document.version.create']);
const gateFailure = code => Object.assign(new Error(code), { code });

function target({ describeOnly = false } = {}) {
  const runId = String(process.env.DOC_MVP01_R2_RUN_ID || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId)) throw gateFailure('R2_PROOF_RUN_ID_REQUIRED');
  const loaded = loadApplicationDocumentConfiguration(process.env);
  const endpointHash = sha(Buffer.from(loaded.r2.endpoint, 'utf8'));
  if (describeOnly) return Object.freeze({ endpointHash, documentsBucket: loaded.r2.documentsBucket,
    quarantineBucket: loaded.r2.quarantineBucket, prefix: `${runId}/`, plan: REMOTE_PLAN });
  if (process.env.DOC_MVP01_R2_PROOF !== PROOF) throw gateFailure('R2_PROOF_AUTHORIZATION_REQUIRED');
  const url = new URL(process.env.DOC_MVP01_R2_ADMIN_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55431' || url.pathname !== '/postgres') throw gateFailure('R2_PROOF_POSTGRES_TARGET_INVALID');
  const evidence = process.env.DOC_MVP01_R2_EVIDENCE;
  if (!evidence || !path.isAbsolute(evidence)) throw gateFailure('R2_PROOF_EVIDENCE_PATH_REQUIRED');
  if (process.env.DOC_MVP01_CLAMAV_CONTAINER !== CLAM_CONTAINER) throw gateFailure('R2_PROOF_CLAMAV_TARGET_INVALID');
  if (endpointHash !== process.env.DOC_MVP01_R2_APPROVED_ENDPOINT_SHA256) throw gateFailure('R2_PROOF_ENDPOINT_NOT_APPROVED');
  if (loaded.r2.documentsBucket !== process.env.DOC_MVP01_R2_APPROVED_DOCUMENTS_BUCKET
    || loaded.r2.quarantineBucket !== process.env.DOC_MVP01_R2_APPROVED_QUARANTINE_BUCKET) throw gateFailure('R2_PROOF_BUCKETS_NOT_APPROVED');
  if (process.env.DOC_MVP01_R2_APPROVED_PREFIX !== `${runId}/`) throw gateFailure('R2_PROOF_PREFIX_NOT_APPROVED');
  const budgetApproval = [['DOC_MVP01_R2_APPROVED_FUNCTIONAL_REQUESTS', '74'], ['DOC_MVP01_R2_APPROVED_CLEANUP_REQUESTS', '32'],
    ['DOC_MVP01_R2_APPROVED_TOTAL_REQUESTS', '106'], ['DOC_MVP01_R2_APPROVED_APPLICATION_BYTES', String(64 * 1024 * 1024)],
    ['DOC_MVP01_R2_APPROVED_OBJECT_INTENTIONS', '10'], ['DOC_MVP01_R2_APPROVED_COMPLETED_OBJECTS', '9'],
    ['DOC_MVP01_R2_APPROVED_MULTIPART_INTENTIONS', '3'], ['DOC_MVP01_R2_APPROVED_UNRESOLVED_MULTIPART', '2']];
  if (budgetApproval.some(([name, expected]) => process.env[name] !== expected)) throw gateFailure('R2_PROOF_BUDGETS_NOT_APPROVED');
  if (process.env.DOC_MVP01_R2_VERIFY_EXPIRY !== 'true') throw gateFailure('R2_PROOF_EXPIRY_NOT_APPROVED');
  // These validation flags are outputs of this proof. The gate opts into the
  // candidate paths locally without changing normal runtime readiness.
  const configuration = Object.freeze({ ...loaded.r2, capabilities: Object.freeze({ layerCValidated: true, multipartConditionalValidated: true }) });
  return Object.freeze({ url, evidence, runId, configuration, credentials: loaded.credentials,
    endpointHash, documentsBucket: loaded.r2.documentsBucket, quarantineBucket: loaded.r2.quarantineBucket });
}
function databaseUrl(source, database) { const result = new URL(source.toString()); result.pathname = `/${database}`; return result.toString(); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sanitizedText(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s)'"<>]+/gi, '[URL_REDACTED]')
    .replace(/\b(authorization|access[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '[USER_PATH]');
}
function sanitizedError(error, phase, budget) {
  const chain = [];
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth += 1) {
    chain.push(Object.freeze({ name: sanitizedText(current.name || 'Error'), code: sanitizedText(current.code || ''),
      message: sanitizedText(current.message || current.name || 'ERROR'), stack: sanitizedText(current.stack || ''),
      httpStatusCode: Number.isInteger(current?.$metadata?.httpStatusCode) ? current.$metadata.httpStatusCode : null,
      requestId: sanitizedText(current?.$metadata?.requestId || ''),
      extendedRequestId: sanitizedText(current?.$metadata?.extendedRequestId || ''),
      cfId: sanitizedText(current?.$metadata?.cfId || '') }));
  }
  return Object.freeze({ at: new Date().toISOString(), phase, error: chain[0] || null,
    cause: Object.freeze(chain.slice(1)), budget: Object.freeze({ ...budget }) });
}
function writeFailureEvidence(evidence, value) {
  const filePath = path.join(evidence, `r2-failure-${Date.now()}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return filePath;
}
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
function providerClient(targetValue, safeguards, { requestHandler = new NodeHttpHandler() } = {}) {
  const transportContext = new AsyncLocalStorage();
  const rawHandle = requestHandler.handle.bind(requestHandler);
  requestHandler.handle = async (request, options) => {
    const context = transportContext.getStore() || Object.freeze({ phase: 'functional', operation: 'HTTP' });
    safeguards.recordTransport('TRANSPORT_STARTED', context);
    try {
      const result = await rawHandle(request, options), response = result?.response || {}, headers = response.headers || {};
      safeguards.recordTransport('TRANSPORT_RESPONSE_RECEIVED', { ...context, httpStatusCode: response.statusCode,
        requestId: headers['x-amz-request-id'], extendedRequestId: headers['x-amz-id-2'], cfId: headers['cf-ray'] });
      return result;
    } catch (error) {
      safeguards.recordTransport('TRANSPORT_FAILED', { ...context, errorCode: error?.code || error?.name,
        httpStatusCode: error?.$metadata?.httpStatusCode, requestId: error?.$metadata?.requestId,
        extendedRequestId: error?.$metadata?.extendedRequestId, cfId: error?.$metadata?.cfId });
      throw error;
    }
  };
  const client = new s3.S3Client({ endpoint: targetValue.configuration.endpoint, region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: targetValue.credentials.accessKeyId, secretAccessKey: targetValue.credentials.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 1, requestHandler });
  return safeguards.instrumentClient(client, { transportContext });
}
async function inventoryPrefix(client, targetValue) {
  const Prefix = `${targetValue.runId}/`, objects = [], uploads = [];
  for (const Bucket of [targetValue.documentsBucket, targetValue.quarantineBucket]) {
    const listed = await client.send(new s3.ListObjectsV2Command({ Bucket, Prefix, MaxKeys: 1000 }));
    if (listed.IsTruncated) throw new Error('R2 proof prefix object inventory was truncated.');
    for (const item of listed.Contents || []) objects.push(Object.freeze({ Bucket, Key: item.Key }));
    const multipart = await client.send(new s3.ListMultipartUploadsCommand({ Bucket, Prefix, MaxUploads: 1000 }));
    if (multipart.IsTruncated) throw new Error('R2 proof prefix multipart inventory was truncated.');
    for (const item of multipart.Uploads || []) uploads.push(Object.freeze({ Bucket, Key: item.Key, UploadId: item.UploadId }));
  }
  return Object.freeze({ objects: Object.freeze(objects), uploads: Object.freeze(uploads) });
}
async function assertEmptyPrefix(client, targetValue) {
  const inventory = await inventoryPrefix(client, targetValue);
  if (inventory.objects.length || inventory.uploads.length) throw new Error('Approved R2 proof prefix is not empty.');
}
async function responseBytes(response, maximum) {
  if (!response.ok) throw new Error(`Signed download failed with HTTP ${response.status}.`);
  const chunks = []; let size = 0;
  for await (const raw of response.body) {
    const chunk = Buffer.from(raw); size += chunk.length;
    if (size > maximum) { await response.body.cancel?.(); throw new Error('Signed download exceeded its reserved byte count.'); }
    chunks.push(chunk);
  }
  if (!size) throw new Error('Signed download returned an invalid byte count.');
  return Buffer.concat(chunks, size);
}
async function run() {
  const approved = target(), { url, evidence } = approved; fs.mkdirSync(evidence, { recursive: true });
  const journalPath = path.join(evidence, 'r2-proof-journal.jsonl');
  const resume = process.env.DOC_MVP01_R2_RESUME === 'true';
  if (resume !== fs.existsSync(journalPath)) throw gateFailure(resume ? 'R2_PROOF_RESUME_JOURNAL_REQUIRED' : 'R2_PROOF_RESUME_NOT_AUTHORIZED');
  if (resume) {
    const records = fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (!records.length || records[0].proofTag !== approved.runId) throw gateFailure('R2_PROOF_JOURNAL_IDENTITY_MISMATCH');
    if (records.at(-1).event !== 'JOURNAL_CLOSED') throw gateFailure('R2_PROOF_RESUME_JOURNAL_NOT_CLOSED');
    const reconstructed = reconstructProofJournal(records);
    if (reconstructed.sequence !== 95) throw gateFailure('R2_PROOF_RESUME_SEQUENCE_MISMATCH');
    assert.deepEqual(reconstructed.budget, RESUME_BASELINE);
  }
  const safeguards = createProofSafeguards({ journalPath,
    proofTag: approved.runId, limits: SAFEGUARD_LIMITS,
    allowedBuckets: [approved.documentsBucket, approved.quarantineBucket], prefix: `${approved.runId}/`,
    allowedFetchOrigin: new URL(approved.configuration.endpoint).origin, resume });
  if (resume) assert.deepEqual(safeguards.snapshot(), RESUME_BASELINE);
  else safeguards.writeRecoveryInstructions(path.join(evidence, 'r2-proof-recovery.json'));
  safeguards.recordBudgetAuthorization(PREVIOUS_SAFEGUARD_LIMITS, 'HUMAN_APPROVED_2026-10-24_GROUP_C');
  const resumedBudget = safeguards.snapshot();
  assert(resumedBudget.functionalRequests + REMAINING_PLAN.functionalRequests <= SAFEGUARD_LIMITS.functionalRequests);
  assert(resumedBudget.cleanupRequests + REMAINING_PLAN.cleanupRequests <= SAFEGUARD_LIMITS.cleanupRequests);
  assert(resumedBudget.functionalRequests + REMAINING_PLAN.functionalRequests
    + resumedBudget.cleanupRequests + REMAINING_PLAN.cleanupRequests <= REMOTE_PLAN.totalRequestLimit);
  assert(resumedBudget.applicationBytes + REMAINING_PLAN.maximumApplicationBytes <= SAFEGUARD_LIMITS.applicationBytes);
  assert(resumedBudget.objectIntentions + REMAINING_PLAN.objectIntentions <= SAFEGUARD_LIMITS.objectIntentions);
  assert(resumedBudget.completedObjects + REMAINING_PLAN.completedObjects <= SAFEGUARD_LIMITS.completedObjects);
  assert(resumedBudget.multipartIntentions + REMAINING_PLAN.multipartIntentions <= SAFEGUARD_LIMITS.multipartIntentions);
  assert(resumedBudget.unresolvedMultipart + REMAINING_PLAN.unresolvedMultipart <= SAFEGUARD_LIMITS.unresolvedMultipart);
  const admin = new Pool({ connectionString: url.toString(), max: 3 }); let tenant, central, queue, fixture;
  const cleanupClient = providerClient(approved, safeguards); let storage = null, cleanup = null, proofStarted = false;
  let phase = 'INITIAL_INVENTORY';
  const observations = { protectedLookups: 0, audit: [], queueJobs: [], denialCodes: [], applicationFailures: [], scannerCalls: [], scanner: {}, authority: {}, r2: {} };
  try {
    await assertEmptyPrefix(cleanupClient, approved); proofStarted = true;
    phase = 'LOCAL_INFRASTRUCTURE';
    tenant = await createInfrastructure(admin);
    const identity = Object.freeze({ tenantId: approved.runId, databaseGenerationId: crypto.randomUUID() });
    phase = 'TENANT_MIGRATIONS';
    const migration = await createTenantMigrationRunner({ pool: tenant, entries: manifest, observationPublisher: { async publish() {} },
      timeoutMs: 60000, scheduler: { setTimeout, clearTimeout } }).migrate(request('authority-clamav-to031', identity));
    assert.equal(migration.evidence.currentVersion, '031_application_document_transport');
    const evidence031 = await preflightTenant(tenant, identity, manifest, { timeoutMs: 60000 });
    phase = 'CENTRAL_AUTHORITY_AND_QUEUE';
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
    const repository = createDocumentRepository(tenant);
    storage = createR2AdapterBoundary(approved.configuration, { organizationId: org, credentials: approved.credentials,
      client: providerClient(approved, safeguards) });
    phase = 'R2_AND_SCANNER_READINESS';
    assert.deepEqual(await storage.health(), { ready: true, adapter: 'r2-s3-v1' });
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
    phase = 'AUTHORIZATION_BOUNDARIES';
    assert.equal(await expectUnavailable(denied.request), 0);
    assert.equal(await expectUnavailable(asymmetric.request), 0);
    assert.equal(await expectUnavailable(revoked.request), 0);
    assert.equal(await expectUnavailable(foreign.request), 0);
    assert.equal(await expectUnavailable(allowed.request, crypto.randomUUID()), 1);
    assert.equal(await expectUnavailable({ ...allowed.request, headers: { 'x-c4g-organization': otherOrg } }), 0);
    assert(observations.denialCodes.every(code => code === 'DOCUMENT_NOT_AVAILABLE'));
    const remoteObjectIds = new Set();
    async function upload(bytes, options = {}) {
      const input = intentInput(bytes, options.fileClass, options.declaredMime, options.filename);
      const intent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId, input });
      const pending = await repository.findVersion({ organizationId: org, versionId: intent.versionId });
      assert(pending?.object_id);
      safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: `${org}/${pending.object_id}`,
        sha256: input.checksum, size: input.expectedSize });
      await transport.upload({ request: allowed.request, applicationId: seeded.applicationId, versionId: intent.versionId,
        token: intent.capability, source: Readable.from([bytes]) });
      const row = await repository.findVersion({ organizationId: org, versionId: intent.versionId });
      assert(row?.object_id); remoteObjectIds.add(row.object_id);
      return Object.freeze({ ...intent, objectId: row.object_id });
    }
    async function processOne({ expectedFailure = false } = {}) {
      const rows = await queue.boss.fetch(queue.queueName, { batchSize: 1 }); assert.equal(rows.length, 1); const job = rows[0];
      try { const result = await worker.handlers['document.scan']({ payload: job.data, fencingToken: `pgboss:${job.id}` });
        if (expectedFailure) assert.fail('Expected scanner failure.'); await queue.boss.complete(queue.queueName, job.id, result); return result; }
      catch (error) { await queue.boss.fail(queue.queueName, job.id, { code: 'LOCAL_SCANNER_UNAVAILABLE' }); if (!expectedFailure) throw error; assert.match(error.message, /MALWARE_SCANNER_UNAVAILABLE/); return null; }
    }
    phase = 'SIMPLE_UPLOAD_SCAN_AND_DOWNLOAD';
    const cleanBytes = Buffer.from('%PDF-1.7\nclean local scanner proof\n%%EOF');
    const clean = await upload(cleanBytes); await processOne();
    let cleanRow = await repository.findVersion({ organizationId: org, versionId: clean.versionId }); assert.equal(cleanRow.state, 'AVAILABLE'); assert.equal(cleanRow.scan_state, 'CLEAN');
    const linked = await applicationService.execute('documentLink', { expectedRevision: 1, idempotencyKey: crypto.randomUUID(), documentId: clean.documentId, versionId: clean.versionId }, seeded.applicationId, allowed.request);
    assert.equal(linked.versionId, clean.versionId);
    const authorizedDownload = await applicationService.execute('documentDownload', { versionId: clean.versionId }, seeded.applicationId, allowed.request);
    const download = await transport.download({ organizationId: authorizedDownload.organizationId, versionId: clean.versionId });
    assert.equal(download.capability.kind, 'R2_SIGNED_DOWNLOAD');
    assert.equal(Date.parse(download.capability.expiresAt) - Date.now() <= LIMITS.downloadCapabilityMs, true);
    const providerResponse = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: cleanBytes.length });
    assert.deepEqual(await responseBytes(providerResponse, cleanBytes.length), cleanBytes);
    assert.match(providerResponse.headers.get('content-disposition') || '', /^attachment/i);
    assert.match(providerResponse.headers.get('cache-control') || '', /no-store/i);

    phase = 'CONDITIONAL_CREATE';
    const conflictingBytes = Buffer.from('%PDF-1.7\nconditional overwrite must fail\n%%EOF');
    const conflictingStorage = createR2AdapterBoundary(approved.configuration, { organizationId: org, credentials: approved.credentials,
      client: providerClient(approved, safeguards) });
    try {
      const handle = await conflictingStorage.beginWrite({ objectId: clean.objectId, storageClass: 'QUARANTINE', conditionalCreate: true,
        expectedSize: conflictingBytes.length, expectedSha256: sha(conflictingBytes), declaredMime: 'application/pdf' });
      await conflictingStorage.write(handle, Readable.from([conflictingBytes]));
      await assert.rejects(() => conflictingStorage.commit(handle, { size: conflictingBytes.length, sha256: sha(conflictingBytes), mime: 'application/pdf' }),
        error => error?.code === 'STORAGE_CONDITIONAL_CREATE_FAILED');
      await conflictingStorage.abort(handle);
    } finally { await conflictingStorage.shutdown(); }

    phase = 'MULTIPART';
    const multipartBytes = Buffer.alloc(LIMITS.multipartThreshold, 0x20);
    Buffer.from('%PDF-1.7\n').copy(multipartBytes, 0); Buffer.from('\n%%EOF').copy(multipartBytes, multipartBytes.length - 6);
    const multipart = await upload(multipartBytes); await processOne();
    const multipartRow = await repository.findVersion({ organizationId: org, versionId: multipart.versionId });
    assert.equal(multipartRow.state, 'AVAILABLE'); assert.equal(multipartRow.scan_state, 'CLEAN');
    const multipartState = await tenant.query('SELECT state FROM document_storage.multipart_upload WHERE organization_id=$1 AND version_id=$2', [org, multipart.versionId]);
    assert.equal(multipartState.rows[0]?.state, 'COMPLETED');
    const multipartConflictBytes = Buffer.alloc(multipartBytes.length, 0x32);
    Buffer.from('%PDF-1.7\n').copy(multipartConflictBytes, 0);
    const multipartConflict = await storage.beginMultipart({ objectId: multipart.objectId, storageClass: 'QUARANTINE', conditionalCreate: true,
      expectedSize: multipartConflictBytes.length, expectedSha256: sha(multipartConflictBytes), declaredMime: 'application/pdf' });
    try {
      for (let start = 0, part = 1; start < multipartConflictBytes.length; start += LIMITS.partBytes, part += 1) {
        await storage.writePart(multipartConflict, part, Readable.from([multipartConflictBytes.subarray(start, start + LIMITS.partBytes)]));
      }
      await assert.rejects(() => storage.commit(multipartConflict, { size: multipartConflictBytes.length,
        sha256: sha(multipartConflictBytes), mime: 'application/pdf' }), error => error?.code === 'STORAGE_CONDITIONAL_CREATE_FAILED');
    } finally { await storage.abort(multipartConflict).catch(() => {}); }
    assert.equal((await storage.head({ objectId: multipart.objectId })).sha256, sha(multipartBytes));

    phase = 'RECOVERY';
    const recoveredBytes = Buffer.from('%PDF-1.7\nremote effect before tenant persistence\n%%EOF');
    const recoveredIntent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId, input: intentInput(recoveredBytes) });
    let recoveredRow = await repository.findVersion({ organizationId: org, versionId: recoveredIntent.versionId });
    safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: `${org}/${recoveredRow.object_id}`,
      sha256: sha(recoveredBytes), size: recoveredBytes.length });
    await repository.transition({ organizationId: org, versionId: recoveredIntent.versionId, fromState: 'PENDING', toState: 'UPLOADING',
      scanState: 'NOT_REQUESTED', lockVersion: 0 });
    const recoveryHandle = await storage.beginWrite({ objectId: recoveredRow.object_id, storageClass: 'QUARANTINE', conditionalCreate: true,
      expectedSize: recoveredBytes.length, expectedSha256: sha(recoveredBytes), declaredMime: 'application/pdf' });
    await storage.write(recoveryHandle, Readable.from([recoveredBytes]));
    await storage.commit(recoveryHandle, { size: recoveredBytes.length, sha256: sha(recoveredBytes), mime: 'application/pdf' });
    remoteObjectIds.add(recoveredRow.object_id);
    const agedRecovery = await tenant.query(`UPDATE document_storage.document_version
      SET updated_at=transaction_timestamp()-interval '6 minutes'
      WHERE organization_id=$1 AND version_id=$2 AND state='UPLOADING' RETURNING version_id`, [org, recoveredIntent.versionId]);
    assert.equal(agedRecovery.rowCount, 1);
    const recovered = await worker.handlers['document.reconcile']({ payload: { organizationId: org, limit: 25 }, fencingToken: `recovery:${crypto.randomUUID()}` });
    assert(recovered.recovered.includes(recoveredIntent.versionId));
    recoveredRow = await repository.findVersion({ organizationId: org, versionId: recoveredIntent.versionId });
    assert.equal(recoveredRow.state, 'AVAILABLE'); assert.equal(recoveredRow.scan_state, 'CLEAN');

    const orphanBytes = Buffer.alloc(LIMITS.multipartThreshold + 1, 0x31);
    Buffer.from('%PDF-1.7\n').copy(orphanBytes, 0);
    const orphanIntent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId, input: intentInput(orphanBytes) });
    const orphanRow = await repository.findVersion({ organizationId: org, versionId: orphanIntent.versionId });
    await repository.transition({ organizationId: org, versionId: orphanIntent.versionId, fromState: 'PENDING', toState: 'UPLOADING',
      scanState: 'NOT_REQUESTED', lockVersion: 0 });
    const orphanKey = `${org}/${orphanRow.object_id}`;
    safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: orphanKey,
      sha256: sha(orphanBytes), size: orphanBytes.length });
    const opened = await cleanupClient.send(new s3.CreateMultipartUploadCommand({ Bucket: approved.quarantineBucket, Key: orphanKey,
      ContentType: 'application/pdf', CacheControl: 'no-store', Metadata: { sha256: sha(orphanBytes) } }));
    assert(opened.UploadId);
    const firstPart = orphanBytes.subarray(0, LIMITS.partBytes);
    const uploadedPart = await cleanupClient.send(new s3.UploadPartCommand({ Bucket: approved.quarantineBucket, Key: orphanKey,
      UploadId: opened.UploadId, PartNumber: 1, Body: firstPart, ContentLength: firstPart.length,
      ContentMD5: crypto.createHash('md5').update(firstPart).digest('base64') }));
    assert(uploadedPart.ETag);
    await repository.registerMultipart({ organizationId: org, versionId: orphanIntent.versionId, objectId: orphanRow.object_id,
      providerUploadId: opened.UploadId, expiresAt: new Date(Date.now() + 5000).toISOString() });
    await repository.recordMultipartPart({ organizationId: org, versionId: orphanIntent.versionId, partNumber: 1,
      size: firstPart.length, sha256: sha(firstPart) });
    await new Promise(resolve => setTimeout(resolve, 5500));
    const orphanRecovery = await worker.handlers['document.reconcile']({ payload: { organizationId: org, limit: 25 }, fencingToken: `orphan:${crypto.randomUUID()}` });
    assert(orphanRecovery.aborted.includes(orphanIntent.versionId));
    const orphanState = await tenant.query('SELECT state FROM document_storage.multipart_upload WHERE organization_id=$1 AND version_id=$2', [org, orphanIntent.versionId]);
    assert.equal(orphanState.rows[0]?.state, 'ABORTED');
    assert.equal((await inventoryPrefix(cleanupClient, approved)).uploads.some(value => value.Key === orphanKey), false);
    phase = 'SCANNER_AND_QUARANTINE';
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
    phase = 'SCANNER_TIMEOUT_AND_RECOVERY';
    const timeoutIntent = await upload(Buffer.from('%PDF-1.7\ntimeout proof\n%%EOF'));
    docker('pause', CLAM_CONTAINER); let paused = true;
    try { await processOne({ expectedFailure: true }); assert.equal((await repository.findVersion({ organizationId: org, versionId: timeoutIntent.versionId })).state, 'SCANNING'); }
    finally { if (paused) { docker('unpause', CLAM_CONTAINER); paused = false; } }
    await waitForScanner(scanner); await queue.boss.send(queue.queueName, { organizationId: org, versionId: timeoutIntent.versionId, correlationId: crypto.randomUUID() }, { retryLimit: 0 }); await processOne();
    assert.equal((await repository.findVersion({ organizationId: org, versionId: timeoutIntent.versionId })).state, 'AVAILABLE');
    phase = 'SCANNER_UNAVAILABLE_AND_RECOVERY';
    const unavailableIntent = await upload(Buffer.from('%PDF-1.7\nunavailable proof\n%%EOF'));
    docker('stop', '--time', '5', CLAM_CONTAINER); let stopped = true;
    try { assert.equal((await scanner.health()).ready, false); await processOne({ expectedFailure: true }); assert.equal((await repository.findVersion({ organizationId: org, versionId: unavailableIntent.versionId })).state, 'SCANNING'); }
    finally { if (stopped) { docker('start', CLAM_CONTAINER); stopped = false; } }
    await waitForScanner(scanner); await queue.boss.send(queue.queueName, { organizationId: org, versionId: unavailableIntent.versionId, correlationId: crypto.randomUUID() }, { retryLimit: 0 }); await processOne();
    assert.equal((await repository.findVersion({ organizationId: org, versionId: unavailableIntent.versionId })).state, 'AVAILABLE');
    phase = 'REVOCATION_AND_EXPIRY';
    await membershipRepository.changeStatus({ membershipId: allowed.membershipId, status: 'REMOVED', reason: 'R2_REVOCATION_PROOF' });
    await assert.rejects(() => applicationService.execute('documentDownload', { versionId: clean.versionId }, seeded.applicationId, allowed.request), unavailable);
    const stillValid = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: cleanBytes.length });
    assert.deepEqual(await responseBytes(stillValid, cleanBytes.length), cleanBytes);
    const expiryWait = Date.parse(download.capability.expiresAt) - Date.now() + 2000;
    if (expiryWait > 0) await new Promise(resolve => setTimeout(resolve, expiryWait));
    const expired = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: 0 });
    assert.equal(expired.ok, false); await expired.body?.cancel();
    observations.scanner = Object.freeze({ clean: true, eicar: 'INFECTED', timeoutStayedScanning: true, unavailableStayedScanning: true,
      recoveredAfterRestore: true, ooxmlClamavResult: 'CLEAN', ooxmlState: 'QUARANTINED', structuralInspection: false });
    observations.r2 = Object.freeze({ endpointSha256: approved.endpointHash, documentsBucket: approved.documentsBucket,
      quarantineBucket: approved.quarantineBucket, prefix: `${org}/`, health: true, simpleUpload: true, conditionalOverwriteDenied: true,
      multipartCompleted: true, persistedMultipartAbortRecovered: true, remoteEffectRecovered: true, providerSha256Metadata: true,
      etagTreatedAsOpaque: true, signedDownload: true, providerAttachmentHeader: true, providerNoStoreHeader: true,
      revocationBlockedNewIssue: true, previouslyIssuedUrlWorkedUntilExpiry: true, expiredUrlDenied: true,
      objectCount: remoteObjectIds.size, estimatedTransferredBytes: cleanBytes.length * 3 + multipartBytes.length * 2
        + multipartConflictBytes.length + recoveredBytes.length * 2 });
    observations.authority = Object.freeze({ centralMigrations: (await central.pool.query('SELECT count(*)::int AS count FROM public.c4g_schema_migration')).rows[0].count,
      realCoordinatorObservations: central.observations.length, grantsExplicit: true, noProfileAutoGrant: true, protectedLookupOrder: true,
      absentGrantDenied: true, asymmetricGrantDenied: true, revokedMembershipDenied: true, foreignResourceDenied: true,
      missingResourceDenied: true, organizationSwapDenied: true, sessionIdentity: 'SYNTHETIC', membershipGrantsAuthority: 'REAL_CENTRAL' });
    phase = 'REMOTE_CLEANUP';
    await storage.shutdown(); storage = null;
    cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3); proofStarted = false;
    assert.equal(cleanup.status, 'COMPLETE');
    const clamavVersion = docker('exec', CLAM_CONTAINER, 'clamdscan', '--version');
    const signatureInfo = docker('exec', CLAM_CONTAINER, 'sh', '-c', "sigtool --info /var/lib/clamav/daily.cld 2>/dev/null | grep -E 'Version:|Build time:|Signatures:'");
    phase = 'RESULTS';
    const result = Object.freeze({ result: 'PASS', tenantVersion: evidence031.currentVersion, migrationFingerprint: evidence031.schemaFingerprint,
      postgres: { version: (await tenant.query('SHOW server_version')).rows[0].server_version, real: true }, queue: { adapter: 'pg-boss', real: true, jobs: observations.queueJobs.length },
      authority: observations.authority, scanner: observations.scanner, clamav: { version: clamavVersion, signatureInfo }, storage: 'REAL_R2',
      r2: observations.r2, identity: 'SYNTHETIC_SESSION', ooxmlStructuralInspection: 'NOT_IMPLEMENTED', browser: 'NOT_EXECUTED',
      cleanup, enforcedBudgets: safeguards.snapshot(), auditEvents: observations.audit, denialCodes: observations.denialCodes });
    fs.writeFileSync(path.join(evidence, 'r2-results.json'), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    error.applicationFailures = observations.applicationFailures;
    error.scannerCalls = observations.scannerCalls;
    const diagnostic = sanitizedError(error, phase, safeguards.snapshot());
    error.proofDiagnostic = diagnostic;
    error.proofDiagnosticPath = writeFailureEvidence(evidence, diagnostic);
    throw error;
  } finally {
    try { if (docker('inspect', '-f', '{{.State.Paused}}', CLAM_CONTAINER) === 'true') docker('unpause', CLAM_CONTAINER); } catch {}
    try { if (docker('inspect', '-f', '{{.State.Status}}', CLAM_CONTAINER) !== 'running') docker('start', CLAM_CONTAINER); } catch {}
    if (storage) await storage.shutdown().catch(() => {});
    if (proofStarted) cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3).catch(error => ({ status: 'UNCERTAIN', errorCode: error.code || error.name }));
    cleanupClient.destroy();
    if (fixture) await fixture.manager.closeAll().catch(() => {});
    if (queue) await queue.close().catch(() => {});
    if (central) await central.close().catch(error => process.stderr.write(`CENTRAL_CLEANUP:${error.code || error.message}\n`));
    if (tenant) await tenant.end().catch(() => {});
    for (const database of [QUEUE_DB, TENANT_DB]) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => {});
    try { await admin.end(); } finally { safeguards.close(); }
  }
}
if (require.main === module) {
  if (process.argv.includes('--describe-target')) {
    try { process.stdout.write(`${JSON.stringify(target({ describeOnly: true }), null, 2)}\n`); }
    catch (error) { process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null, message: error.message })}\n`); process.exitCode = 1; }
  } else {
    run().catch(error => {
      const diagnostic = error.proofDiagnostic || sanitizedError(error, 'TARGET_AND_LOCAL_PREFLIGHT', RESUME_BASELINE);
      let diagnosticPath = error.proofDiagnosticPath || null;
      const evidence = process.env.DOC_MVP01_R2_EVIDENCE;
      if (!diagnosticPath && evidence && path.isAbsolute(evidence)) {
        try { diagnosticPath = writeFailureEvidence(evidence, diagnostic); } catch { diagnosticPath = null; }
      }
      process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null,
        message: error.code || error.name || 'R2_PROOF_FAILED', diagnostic, diagnosticPath,
        applicationFailures: error.applicationFailures || null, scannerCalls: error.scannerCalls || null })}\n`);
      process.exitCode = 1;
    });
  }
}
module.exports = { providerClient, target, databaseUrl, sha, sanitizedError, writeFailureEvidence, storedZip, request,
  unavailable, normalized, docker, waitForScanner, createInfrastructure, seedApplication, createQueue, inventoryPrefix,
  assertEmptyPrefix, responseBytes, SAFEGUARD_LIMITS, FULL_PERMISSIONS, CLAM_CONTAINER };
