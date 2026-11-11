'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Pool } = require('../../../backend/node_modules/pg');
const s3 = require('../../../backend/node_modules/@aws-sdk/client-s3');
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
const { createProofSafeguards, reconstructProofJournal, JOURNAL_INTERPRETER_VERSION } = require('./r2-proof-safeguards');
const { inspectSignedCapability } = require('./r2-signed-expiry');
const {
  databaseUrl, sha, sanitizedError, writeFailureEvidence, request, waitForScanner, createInfrastructure,
  seedApplication, createQueue, providerClient, assertEmptyPrefix, responseBytes, FULL_PERMISSIONS, CLAM_CONTAINER
} = require('./group-c-r2');

const PROOF = 'C4G_DOC_MVP01_R2_REVOCATION_V1';
const TENANT_DB = 'doc_mvp01_r2_tenant';
const QUEUE_DB = 'doc_mvp01_r2_queue';
const BASELINE = Object.freeze({ sequence: 601,
  sha256: '0392AE3EEAEBF0A0149EC77ACDE1373FE822158FA29E124E6D17BA4B1661B9D2',
  budget: Object.freeze({ functionalRequests: 83, cleanupRequests: 28, applicationBytes: 58721562,
    objectIntentions: 11, completedObjects: 10, multipartIntentions: 3, unresolvedMultipart: 0 }) });
const PREVIOUS_LIMITS = Object.freeze({ functionalRequests: 89, cleanupRequests: 32, applicationBytes: 67108864,
  objectIntentions: 11, completedObjects: 10, multipartIntentions: 3, unresolvedMultipart: 2 });
const REVOCATION_LIMITS = Object.freeze({ functionalRequests: 101, cleanupRequests: 32, applicationBytes: 67108864,
  objectIntentions: 12, completedObjects: 11, multipartIntentions: 3, unresolvedMultipart: 2 });
const REVOCATION_BYTES = Buffer.from('%PDF-1.7\nrevocation and signed URL expiry proof\n%%EOF');
const REVOCATION_PLAN = Object.freeze({ functionalRequests: 18, cleanupRequests: 3,
  applicationBytes: REVOCATION_BYTES.length * 4, objectIntentions: 1, completedObjects: 1,
  multipartIntentions: 0, unresolvedMultipart: 0 });
const EXPIRY_MARGIN_MS = 3000;

const failure = code => Object.assign(new Error(code), { code });

function validateBaseline(records, bytes) {
  if (!Array.isArray(records) || records.at(-1)?.event !== 'JOURNAL_CLOSED') throw failure('R2_REVOCATION_JOURNAL_NOT_CLOSED');
  const reconstructed = reconstructProofJournal(records);
  assert.equal(reconstructed.sequence, BASELINE.sequence);
  assert.equal(sha(bytes).toUpperCase(), BASELINE.sha256);
  assert.deepEqual(reconstructed.budget, BASELINE.budget);
  assert.equal(reconstructed.interpreterVersion, JOURNAL_INTERPRETER_VERSION);
  return reconstructed;
}

function assertPlanFits(baseline = BASELINE.budget, limits = REVOCATION_LIMITS, plan = REVOCATION_PLAN) {
  for (const name of ['functionalRequests', 'cleanupRequests', 'applicationBytes', 'objectIntentions', 'completedObjects', 'multipartIntentions']) {
    assert(baseline[name] + plan[name] <= limits[name]);
  }
  assert(Math.max(baseline.unresolvedMultipart, plan.unresolvedMultipart) <= limits.unresolvedMultipart);
  assert.equal(limits.functionalRequests + limits.cleanupRequests, 133);
  return Object.freeze({ functionalRequests: baseline.functionalRequests + plan.functionalRequests,
    cleanupRequests: baseline.cleanupRequests + plan.cleanupRequests,
    totalRequests: baseline.functionalRequests + plan.functionalRequests + baseline.cleanupRequests + plan.cleanupRequests,
    applicationBytes: baseline.applicationBytes + plan.applicationBytes,
    objectIntentions: baseline.objectIntentions + plan.objectIntentions,
    completedObjects: baseline.completedObjects + plan.completedObjects,
    multipartIntentions: baseline.multipartIntentions + plan.multipartIntentions,
    unresolvedMultipart: Math.max(baseline.unresolvedMultipart, plan.unresolvedMultipart) });
}

function approvedTarget() {
  const runId = String(process.env.DOC_MVP01_R2_RUN_ID || '').toLowerCase();
  if (runId !== 'df1f6c0b-c107-4509-af52-73b4eefb244b') throw failure('R2_REVOCATION_RUN_ID_INVALID');
  if (process.env.DOC_MVP01_R2_REVOCATION_PROOF !== PROOF) throw failure('R2_REVOCATION_AUTHORIZATION_REQUIRED');
  const loaded = loadApplicationDocumentConfiguration(process.env);
  const endpointHash = sha(Buffer.from(loaded.r2.endpoint, 'utf8'));
  const url = new URL(process.env.DOC_MVP01_R2_ADMIN_URL);
  const evidence = process.env.DOC_MVP01_R2_EVIDENCE;
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55431' || url.pathname !== '/postgres') {
    throw failure('R2_REVOCATION_POSTGRES_TARGET_INVALID');
  }
  if (!evidence || !path.isAbsolute(evidence)) throw failure('R2_REVOCATION_EVIDENCE_PATH_REQUIRED');
  if (process.env.DOC_MVP01_CLAMAV_CONTAINER !== CLAM_CONTAINER) throw failure('R2_REVOCATION_CLAMAV_TARGET_INVALID');
  if (endpointHash !== process.env.DOC_MVP01_R2_APPROVED_ENDPOINT_SHA256
    || loaded.r2.documentsBucket !== process.env.DOC_MVP01_R2_APPROVED_DOCUMENTS_BUCKET
    || loaded.r2.quarantineBucket !== process.env.DOC_MVP01_R2_APPROVED_QUARANTINE_BUCKET
    || process.env.DOC_MVP01_R2_APPROVED_PREFIX !== `${runId}/`) throw failure('R2_REVOCATION_DESTINATION_NOT_APPROVED');
  const budgets = [['FUNCTIONAL_REQUESTS', '101'], ['CLEANUP_REQUESTS', '32'], ['TOTAL_REQUESTS', '133'],
    ['APPLICATION_BYTES', '67108864'], ['OBJECT_INTENTIONS', '12'], ['COMPLETED_OBJECTS', '11'],
    ['MULTIPART_INTENTIONS', '3'], ['UNRESOLVED_MULTIPART', '2']];
  if (budgets.some(([name, expected]) => process.env[`DOC_MVP01_R2_REVOCATION_APPROVED_${name}`] !== expected)) {
    throw failure('R2_REVOCATION_BUDGETS_NOT_APPROVED');
  }
  if (process.env.DOC_MVP01_R2_VERIFY_EXPIRY !== 'true') throw failure('R2_REVOCATION_EXPIRY_NOT_APPROVED');
  const configuration = Object.freeze({ ...loaded.r2,
    capabilities: Object.freeze({ layerCValidated: true, multipartConditionalValidated: true }) });
  return Object.freeze({ url, evidence, runId, endpointHash, configuration, credentials: loaded.credentials,
    documentsBucket: loaded.r2.documentsBucket, quarantineBucket: loaded.r2.quarantineBucket });
}

async function expiryDenial(response) {
  const maximum = 8192, chunks = []; let size = 0;
  for await (const raw of response.body || []) {
    const chunk = Buffer.from(raw); size += chunk.length;
    if (size > maximum) { response.body?.destroy?.(); throw failure('R2_EXPIRY_ERROR_BODY_TOO_LARGE'); }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const code = /<Code>([^<]{1,128})<\/Code>/i.exec(text)?.[1] || null;
  const message = /<Message>([^<]{1,512})<\/Message>/i.exec(text)?.[1] || '';
  const explicitlyExpired = response.status === 403 && (['ExpiredRequest', 'ExpiredToken'].includes(code)
    || (code === 'AccessDenied' && /expired/i.test(message)));
  if (!explicitlyExpired) throw Object.assign(failure('R2_SIGNED_EXPIRY_NOT_PROVEN'), { httpStatusCode: response.status,
    providerCode: code || 'UNKNOWN' });
  return Object.freeze({ status: response.status, providerCode: code,
    requestId: response.headers.get('x-amz-request-id') || null,
    extendedRequestId: response.headers.get('x-amz-id-2') || null,
    cfId: response.headers.get('cf-ray') || null, explicitlyExpired: true });
}

async function requireRevokedAuthority(action) {
  try {
    await action();
  } catch (error) {
    if (error?.code === 'AUTHORITY_REQUIRED') return Object.freeze({ code: error.code });
    throw Object.assign(failure('R2_REVOCATION_UNEXPECTED_AUTHORITY_ERROR'), { cause: error });
  }
  throw failure('R2_REVOCATION_NEW_ISSUE_NOT_DENIED');
}

async function run() {
  const approved = approvedTarget(), journalPath = path.join(approved.evidence, 'r2-proof-journal.jsonl');
  const journalBytes = fs.readFileSync(journalPath), records = journalBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const baseline = validateBaseline(records, journalBytes), projected = assertPlanFits();
  const safeguards = createProofSafeguards({ journalPath, proofTag: approved.runId, limits: REVOCATION_LIMITS,
    allowedBuckets: [approved.documentsBucket, approved.quarantineBucket], prefix: `${approved.runId}/`,
    allowedFetchOrigin: new URL(approved.configuration.endpoint).origin, resume: true });
  safeguards.recordBudgetAuthorization(PREVIOUS_LIMITS, 'R2_REVOCATION_EXPIRY_2026_10_24');
  safeguards.recordJournalInterpretation({ sourceSequence: baseline.sequence, sourceSha256: BASELINE.sha256 });
  assert.deepEqual(safeguards.snapshot(), BASELINE.budget);
  const admin = new Pool({ connectionString: approved.url.toString(), max: 3 });
  let tenant, central, queue, fixture, storage, remoteClient, cleanup, proofStarted = false;
  let phase = 'INITIAL_INVENTORY';
  const cleanupClient = providerClient(approved, safeguards);
  const observations = { queueJobs: [], audit: [] };
  const audit = Object.freeze({ async accept(code) { observations.audit.push(code); }, async emit(code) { observations.audit.push(code); } });
  const reconciliation = Object.freeze({ async record(value) { observations.audit.push(value.code); } });
  try {
    await assertEmptyPrefix(cleanupClient, approved); proofStarted = true;
    phase = 'LOCAL_INFRASTRUCTURE'; tenant = await createInfrastructure(admin);
    const identity = Object.freeze({ tenantId: approved.runId, databaseGenerationId: crypto.randomUUID() });
    phase = 'TENANT_MIGRATIONS';
    await createTenantMigrationRunner({ pool: tenant, entries: manifest, observationPublisher: { async publish() {} }, timeoutMs: 60000,
      scheduler: { setTimeout, clearTimeout } }).migrate(request('r2-revocation-to031', identity));
    const evidence031 = await preflightTenant(tenant, identity, manifest, { timeoutMs: 60000 });
    assert.equal(evidence031.currentVersion, '031_application_document_transport');
    phase = 'CENTRAL_AUTHORITY_AND_QUEUE';
    central = await require('../f13/central-authority-fixture').centralAuthorityFixture(approved.url.toString(), { validateHistoricalRoundTrip: false });
    queue = await createQueue(approved.url);
    fixture = await require('../f13/runtime-fixture').runtimeFixture({ pool: tenant, evidence: evidence031, sessions: { memberships: new Map() } });
    const membershipRepository = createMembershipRepository(central.pool, central.coordinator);
    fixture.dependencies.membershipRepository = membershipRepository;
    const organizationId = identity.tenantId;
    const allowed = await central.user(organizationId, crypto.randomUUID(), crypto.randomUUID());
    const scope = { type: 'ORGANIZATION', id: organizationId, organizationId };
    await central.data.change({ organizationId, membershipId: allowed.membershipId, expectedVersion: 1,
      grants: FULL_PERMISSIONS.map(permission => ({ permission, scope })), assuranceRequirements: central.requirement });
    const seeded = await seedApplication(tenant, organizationId, allowed.membershipId, allowed.id);
    const applicationService = createApplicationComposition({ sessionStore: central.store, sessionRegistry: central.registry,
      authorityCoordinator: central.coordinator, centralPool: central.pool, authorizationCatalogs: central.catalogs,
      assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: central.requirement,
      tenantRuntimeDependencies: fixture.dependencies, tokenKeys: { local: crypto.randomBytes(32).toString('hex') }, tokenKeyId: 'local' });
    const accessPort = createApplicationDocumentAuthorizationAdapter({ applicationService });
    const repository = createDocumentRepository(tenant);
    remoteClient = providerClient(approved, safeguards);
    storage = createR2AdapterBoundary(approved.configuration, { organizationId, credentials: approved.credentials, client: remoteClient });
    const scanner = createClamavScanner({ organizationId, storage, host: '127.0.0.1', port: 53310, timeoutMs: 5000 });
    const worker = createDocumentWorker({ portsForOrganization: requested => { assert.equal(requested, organizationId); return {
      repository, storage, scanService: createScanService({ scanner, repository, storage, audit }), audit, reconciliation }; } });
    phase = 'READINESS'; assert.deepEqual(await storage.health(), { ready: true, adapter: 'r2-s3-v1' });
    await waitForScanner(scanner); assert.deepEqual(await scanner.health(), { ready: true, adapter: 'clamav-instream-v1' });
    const jobs = Object.freeze({ async enqueueScan(value) { const id = await queue.boss.send(queue.queueName, value, { retryLimit: 0 }); observations.queueJobs.push(id); } });
    const transport = createApplicationDocumentTransport({ accessPort, repositoryFactory: requested => { assert.equal(requested, organizationId); return repository; },
      storageFactory: requested => { assert.equal(requested, organizationId); return storage; }, auditFactory: () => audit,
      reconciliationFactory: () => reconciliation, jobs, clock: () => new Date(), id: crypto.randomUUID });

    phase = 'UPLOAD_CONFIRM_SCAN';
    const checksum = sha(REVOCATION_BYTES);
    const intent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId,
      input: { expectedSize: REVOCATION_BYTES.length, declaredMime: 'application/pdf', filename: 'revocation-expiry-proof.pdf',
        fileClass: 'PDF', checksum, idempotencyKey: crypto.randomUUID(), versionNumber: 1 } });
    let row = await repository.findVersion({ organizationId, versionId: intent.versionId }); assert(row?.object_id);
    safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: `${organizationId}/${row.object_id}`,
      sha256: checksum, size: REVOCATION_BYTES.length });
    await transport.upload({ request: allowed.request, applicationId: seeded.applicationId, versionId: intent.versionId,
      token: intent.capability, source: Readable.from([REVOCATION_BYTES]) });
    const jobsReady = await queue.boss.fetch(queue.queueName, { batchSize: 1 }); assert.equal(jobsReady.length, 1);
    const job = jobsReady[0], scan = await worker.handlers['document.scan']({ payload: job.data, fencingToken: `pgboss:${job.id}` });
    await queue.boss.complete(queue.queueName, job.id, scan);
    row = await repository.findVersion({ organizationId, versionId: intent.versionId });
    assert.equal(row.state, 'AVAILABLE'); assert.equal(row.scan_state, 'CLEAN');
    await applicationService.execute('documentLink', { expectedRevision: 1, idempotencyKey: crypto.randomUUID(),
      documentId: intent.documentId, versionId: intent.versionId }, seeded.applicationId, allowed.request);

    phase = 'ISSUE_AND_REVOKE';
    const authorized = await applicationService.execute('documentDownload', { versionId: intent.versionId }, seeded.applicationId, allowed.request);
    const issuanceStartedAt = new Date().toISOString();
    const download = await transport.download({ organizationId: authorized.organizationId, versionId: intent.versionId });
    const issuedAt = new Date().toISOString();
    const timing = inspectSignedCapability({ capability: download.capability, issuanceStartedAt, issuedAt,
      maximumTtlSeconds: LIMITS.downloadCapabilityMs / 1000 });
    const beforeRevocationAt = new Date().toISOString();
    const before = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: REVOCATION_BYTES.length });
    assert.deepEqual(await responseBytes(before, REVOCATION_BYTES.length), REVOCATION_BYTES);
    await membershipRepository.changeStatus({ membershipId: allowed.membershipId, status: 'REMOVED', reason: 'R2_SIGNED_EXPIRY_PROOF' });
    const revokedAuthority = await requireRevokedAuthority(() => applicationService.execute('documentDownload',
      { versionId: intent.versionId }, seeded.applicationId, allowed.request));
    const afterRevocationAt = new Date().toISOString();
    const stillValid = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: REVOCATION_BYTES.length });
    assert.deepEqual(await responseBytes(stillValid, REVOCATION_BYTES.length), REVOCATION_BYTES);
    const expiryBoundary = Math.max(Date.parse(timing.expiresAt), Date.parse(timing.signedExpiresAt));
    const waitStartedAt = new Date().toISOString(), waitMs = expiryBoundary - Date.now() + EXPIRY_MARGIN_MS;
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    const afterExpiryAt = new Date().toISOString();
    const expired = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: 0 });
    const denial = await expiryDenial(expired);
    const authenticatedHead = await storage.head({ objectId: row.object_id, storageClass: row.storage_class });
    assert.equal(authenticatedHead.size, REVOCATION_BYTES.length); assert.equal(authenticatedHead.sha256, checksum);
    const revocation = Object.freeze({ ...timing, beforeRevocationAt, afterRevocationAt, waitStartedAt, afterExpiryAt,
      expiryMarginMs: EXPIRY_MARGIN_MS, newIssueDenied: true, newIssueDenialCode: revokedAuthority.code,
      previousUrlValidAfterRevocation: true,
      expiredRequest: denial, authenticatedObjectStillPresent: true });
    const preservedEvidence = Object.freeze({ result: 'PROOF_COMPLETE_BEFORE_CLEANUP', proof: PROOF, revocation,
      object: Object.freeze({ size: REVOCATION_BYTES.length, sha256: checksum, authenticatedHeadConfirmed: true }),
      budgetBeforeCleanup: safeguards.snapshot(), signedUrlPersisted: false });
    const preservedEvidencePath = path.join(approved.evidence, 'r2-revocation-proof-before-cleanup.json');
    fs.writeFileSync(preservedEvidencePath, `${JSON.stringify(preservedEvidence, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });

    phase = 'REMOTE_CLEANUP'; await storage.shutdown(); storage = null; remoteClient = null;
    cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3); assert.equal(cleanup.status, 'COMPLETE');
    phase = 'FINAL_INVENTORY'; await assertEmptyPrefix(cleanupClient, approved); proofStarted = false;
    const result = Object.freeze({ result: 'PASS', proof: PROOF, projected, revocation, cleanup,
      proofBeforeCleanup: path.basename(preservedEvidencePath),
      enforcedBudgets: safeguards.snapshot(), services: Object.freeze({ storage: 'REAL_R2', scanner: 'REAL_CLAMAV',
        authority: 'REAL_CENTRAL_WITH_SYNTHETIC_SESSION', queue: 'REAL_PG_BOSS' }),
      excluded: Object.freeze(['RECOVERY_REPEAT', 'MULTIPART_REPEAT', 'SCANNER_FAILURE_REPEAT', 'OOXML', 'IDP', 'BROWSER']) });
    fs.writeFileSync(path.join(approved.evidence, 'r2-revocation-results.json'), `${JSON.stringify(result, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    error.proofDiagnostic = sanitizedError(error, phase, safeguards.snapshot());
    error.proofDiagnosticPath = writeFailureEvidence(approved.evidence, error.proofDiagnostic);
    throw error;
  } finally {
    if (storage) await storage.shutdown().catch(() => {});
    if (proofStarted) cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3).catch(error => ({ status: 'UNCERTAIN', errorCode: error.code || error.name }));
    cleanupClient.destroy();
    if (fixture) await fixture.manager.closeAll().catch(() => {});
    if (queue) await queue.close().catch(() => {});
    if (central) await central.close().catch(() => {});
    if (tenant) await tenant.end().catch(() => {});
    for (const database of [QUEUE_DB, TENANT_DB]) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => {});
    try { await admin.end(); } finally { safeguards.close(); }
  }
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null,
    message: error.code || error.name || 'R2_REVOCATION_PROOF_FAILED', diagnostic: error.proofDiagnostic || null,
    diagnosticPath: error.proofDiagnosticPath || null })}\n`);
  process.exitCode = 1;
});

module.exports = { BASELINE, EXPIRY_MARGIN_MS, PROOF, REVOCATION_BYTES, REVOCATION_LIMITS, REVOCATION_PLAN,
  approvedTarget, assertPlanFits, expiryDenial, requireRevokedAuthority, run, validateBaseline };
