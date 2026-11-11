'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
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
const { LIMITS } = require('../../../backend/src/documents/constants');
const { createProofSafeguards, reconstructProofJournal, JOURNAL_INTERPRETER_VERSION } = require('./r2-proof-safeguards');
const { inspectSignedCapability } = require('./r2-signed-expiry');
const {
  target, databaseUrl, sha, sanitizedError, writeFailureEvidence, storedZip, request, unavailable, docker,
  waitForScanner, createInfrastructure, seedApplication, createQueue, providerClient, inventoryPrefix,
  assertEmptyPrefix, responseBytes, SAFEGUARD_LIMITS, FULL_PERMISSIONS, CLAM_CONTAINER
} = require('./group-c-r2');

const TENANT_DB = 'doc_mvp01_r2_tenant';
const QUEUE_DB = 'doc_mvp01_r2_queue';
const CONTINUATION_PROOF = 'C4G_DOC_MVP01_R2_CONTINUATION_V1';
const EXPECTED_JOURNAL = Object.freeze({ sequence: 290,
  sha256: '2E244B799DE7C74A5B4115510F6F8B77D28D38C7F2B82BC3E1A52DD938FD1A08',
  budget: Object.freeze({ functionalRequests: 41, cleanupRequests: 13, applicationBytes: 50332040,
    objectIntentions: 5, completedObjects: 5, multipartIntentions: 2, unresolvedMultipart: 0 }) });
const RECOVERY_BYTES = Buffer.from('%PDF-1.7\nremote effect before tenant persistence continuation\n%%EOF');
const EICAR = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
const EICAR_BYTES = storedZip('eicar.com', EICAR);
const TIMEOUT_BYTES = Buffer.from('%PDF-1.7\nscanner timeout continuation proof\n%%EOF');
const UNAVAILABLE_BYTES = Buffer.from('%PDF-1.7\nscanner unavailable continuation proof\n%%EOF');
const MULTIPART_PART_BYTES = LIMITS.partBytes;
const CONTINUATION_PLAN = Object.freeze({
  initialAndFinalInventory: Object.freeze({ functionalRequests: 8, cleanupRequests: 0, applicationBytes: 0 }),
  readiness: Object.freeze({ functionalRequests: 2, cleanupRequests: 0, applicationBytes: 0 }),
  remoteEffectRecoveryAndRevocation: Object.freeze({ functionalRequests: 7, cleanupRequests: 3,
    applicationBytes: RECOVERY_BYTES.length * 3, objectIntentions: 1, completedObjects: 1 }),
  persistedMultipartRestart: Object.freeze({ functionalRequests: 4, cleanupRequests: 2,
    applicationBytes: MULTIPART_PART_BYTES, objectIntentions: 1, completedObjects: 0, multipartIntentions: 1, unresolvedMultipart: 1 }),
  eicarBlocked: Object.freeze({ functionalRequests: 3, cleanupRequests: 3,
    applicationBytes: EICAR_BYTES.length * 2, objectIntentions: 1, completedObjects: 1 }),
  scannerTimeoutRecovery: Object.freeze({ functionalRequests: 4, cleanupRequests: 3,
    applicationBytes: TIMEOUT_BYTES.length * 2, objectIntentions: 1, completedObjects: 1 }),
  scannerUnavailableRecovery: Object.freeze({ functionalRequests: 4, cleanupRequests: 3,
    applicationBytes: UNAVAILABLE_BYTES.length * 2, objectIntentions: 1, completedObjects: 1 })
});
const PLAN_TOTAL = Object.freeze(Object.values(CONTINUATION_PLAN).reduce((sum, item) => {
  for (const key of ['functionalRequests', 'cleanupRequests', 'applicationBytes', 'objectIntentions', 'completedObjects',
    'multipartIntentions', 'unresolvedMultipart']) sum[key] += item[key] || 0;
  return sum;
}, { functionalRequests: 0, cleanupRequests: 0, applicationBytes: 0, objectIntentions: 0,
  completedObjects: 0, multipartIntentions: 0, unresolvedMultipart: 0 }));

function validateContinuationBaseline(records, journalBytes) {
  if (!Array.isArray(records) || records.at(-1)?.event !== 'JOURNAL_CLOSED') throw new Error('R2_CONTINUATION_JOURNAL_NOT_CLOSED');
  const reconstructed = reconstructProofJournal(records);
  assert.equal(reconstructed.sequence, EXPECTED_JOURNAL.sequence);
  assert.equal(sha(journalBytes).toUpperCase(), EXPECTED_JOURNAL.sha256);
  assert.deepEqual(reconstructed.budget, EXPECTED_JOURNAL.budget);
  assert.equal(reconstructed.interpreterVersion, JOURNAL_INTERPRETER_VERSION);
  return reconstructed;
}

function assertPlanFits(baseline = EXPECTED_JOURNAL.budget, limits = SAFEGUARD_LIMITS, plan = PLAN_TOTAL) {
  assert(baseline.functionalRequests + plan.functionalRequests <= limits.functionalRequests);
  assert(baseline.cleanupRequests + plan.cleanupRequests <= limits.cleanupRequests);
  assert(baseline.applicationBytes + plan.applicationBytes <= limits.applicationBytes);
  assert(baseline.objectIntentions + plan.objectIntentions <= limits.objectIntentions);
  assert(baseline.completedObjects + plan.completedObjects <= limits.completedObjects);
  assert(baseline.multipartIntentions + plan.multipartIntentions <= limits.multipartIntentions);
  assert(Math.max(baseline.unresolvedMultipart, plan.unresolvedMultipart) <= limits.unresolvedMultipart);
  return Object.freeze({ functionalRequestsRemaining: limits.functionalRequests - baseline.functionalRequests - plan.functionalRequests,
    cleanupRequestsRemaining: limits.cleanupRequests - baseline.cleanupRequests - plan.cleanupRequests,
    applicationBytesRemaining: limits.applicationBytes - baseline.applicationBytes - plan.applicationBytes,
    objectIntentionsRemaining: limits.objectIntentions - baseline.objectIntentions - plan.objectIntentions,
    completedObjectsRemaining: limits.completedObjects - baseline.completedObjects - plan.completedObjects,
    multipartIntentionsRemaining: limits.multipartIntentions - baseline.multipartIntentions - plan.multipartIntentions });
}

async function run() {
  if (process.env.DOC_MVP01_R2_CONTINUATION_PROOF !== CONTINUATION_PROOF) throw new Error('R2_CONTINUATION_AUTHORIZATION_REQUIRED');
  const approved = target(), journalPath = path.join(approved.evidence, 'r2-proof-journal.jsonl');
  const journalBytes = fs.readFileSync(journalPath), records = journalBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  validateContinuationBaseline(records, journalBytes); const planMargin = assertPlanFits();
  let safeguards = createProofSafeguards({ journalPath, proofTag: approved.runId, limits: SAFEGUARD_LIMITS,
    allowedBuckets: [approved.documentsBucket, approved.quarantineBucket], prefix: `${approved.runId}/`,
    allowedFetchOrigin: new URL(approved.configuration.endpoint).origin, resume: true });
  safeguards.recordJournalInterpretation({ sourceSequence: EXPECTED_JOURNAL.sequence, sourceSha256: EXPECTED_JOURNAL.sha256 });
  assert.deepEqual(safeguards.snapshot(), EXPECTED_JOURNAL.budget);
  const admin = new Pool({ connectionString: approved.url.toString(), max: 3 });
  let tenant, central, queue, fixture, storage, scanner, worker, remoteClient, cleanup, proofStarted = false;
  let phase = 'INITIAL_INVENTORY';
  const observations = { queueJobs: [], audit: [], scanner: {}, recovery: {}, multipart: {}, revocation: {} };
  let cleanupClient = providerClient(approved, safeguards);
  const audit = Object.freeze({ async accept(code) { observations.audit.push(code); }, async emit(code) { observations.audit.push(code); } });
  const reconciliation = Object.freeze({ async record(value) { observations.audit.push(value.code); } });
  try {
    await assertEmptyPrefix(cleanupClient, approved); proofStarted = true;
    phase = 'LOCAL_INFRASTRUCTURE';
    tenant = await createInfrastructure(admin);
    const identity = Object.freeze({ tenantId: approved.runId, databaseGenerationId: crypto.randomUUID() });
    phase = 'TENANT_MIGRATIONS';
    await createTenantMigrationRunner({ pool: tenant, entries: manifest, observationPublisher: { async publish() {} }, timeoutMs: 60000,
      scheduler: { setTimeout, clearTimeout } }).migrate(request('r2-continuation-to031', identity));
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
    const buildRemoteRuntime = () => {
      remoteClient = providerClient(approved, safeguards);
      storage = createR2AdapterBoundary(approved.configuration, { organizationId, credentials: approved.credentials, client: remoteClient });
      scanner = createClamavScanner({ organizationId, storage, host: '127.0.0.1', port: 53310, timeoutMs: 5000 });
      worker = createDocumentWorker({ portsForOrganization: requested => { assert.equal(requested, organizationId); return {
        repository, storage, scanService: createScanService({ scanner, repository, storage, audit }), audit, reconciliation }; } });
    };
    buildRemoteRuntime();
    phase = 'READINESS';
    assert.deepEqual(await storage.health(), { ready: true, adapter: 'r2-s3-v1' });
    await waitForScanner(scanner); assert.deepEqual(await scanner.health(), { ready: true, adapter: 'clamav-instream-v1' });
    const jobs = Object.freeze({ async enqueueScan(value) { const id = await queue.boss.send(queue.queueName, value, { retryLimit: 0 }); observations.queueJobs.push(id); } });
    const transport = createApplicationDocumentTransport({ accessPort, repositoryFactory: requested => { assert.equal(requested, organizationId); return repository; },
      storageFactory: requested => { assert.equal(requested, organizationId); return storage; }, auditFactory: () => audit,
      reconciliationFactory: () => reconciliation, jobs, clock: () => new Date(), id: crypto.randomUUID });
    const intentInput = (bytes, fileClass = 'PDF', declaredMime = 'application/pdf', filename = 'synthetic.pdf') => ({
      expectedSize: bytes.length, declaredMime, filename, fileClass, checksum: sha(bytes), idempotencyKey: crypto.randomUUID(), versionNumber: 1 });
    async function upload(bytes, options = {}) {
      const input = intentInput(bytes, options.fileClass, options.declaredMime, options.filename);
      const intent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId, input });
      const pending = await repository.findVersion({ organizationId, versionId: intent.versionId }); assert(pending?.object_id);
      safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: `${organizationId}/${pending.object_id}`,
        sha256: input.checksum, size: input.expectedSize });
      await transport.upload({ request: allowed.request, applicationId: seeded.applicationId, versionId: intent.versionId,
        token: intent.capability, source: Readable.from([bytes]) });
      return Object.freeze({ ...intent, objectId: pending.object_id });
    }
    async function processOne({ expectedFailure = false } = {}) {
      const rows = await queue.boss.fetch(queue.queueName, { batchSize: 1 }); assert.equal(rows.length, 1); const job = rows[0];
      try {
        const result = await worker.handlers['document.scan']({ payload: job.data, fencingToken: `pgboss:${job.id}` });
        if (expectedFailure) assert.fail('Expected scanner failure.'); await queue.boss.complete(queue.queueName, job.id, result); return result;
      } catch (error) {
        await queue.boss.fail(queue.queueName, job.id, { code: 'LOCAL_SCANNER_UNAVAILABLE' });
        if (!expectedFailure) throw error; assert.match(error.message, /MALWARE_SCANNER_UNAVAILABLE/); return null;
      }
    }
    async function restartRuntime() {
      await storage.shutdown();
      storage = null; scanner = null; worker = null; remoteClient = null; buildRemoteRuntime();
    }

    phase = 'REMOTE_EFFECT_RECOVERY';
    const recoveredIntent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId,
      input: intentInput(RECOVERY_BYTES) });
    let recoveredRow = await repository.findVersion({ organizationId, versionId: recoveredIntent.versionId });
    safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: `${organizationId}/${recoveredRow.object_id}`,
      sha256: sha(RECOVERY_BYTES), size: RECOVERY_BYTES.length });
    await repository.transition({ organizationId, versionId: recoveredIntent.versionId, fromState: 'PENDING', toState: 'UPLOADING',
      scanState: 'NOT_REQUESTED', lockVersion: 0 });
    const recoveryHandle = await storage.beginWrite({ objectId: recoveredRow.object_id, storageClass: 'QUARANTINE', conditionalCreate: true,
      expectedSize: RECOVERY_BYTES.length, expectedSha256: sha(RECOVERY_BYTES), declaredMime: 'application/pdf' });
    await storage.write(recoveryHandle, Readable.from([RECOVERY_BYTES]));
    await storage.commit(recoveryHandle, { size: RECOVERY_BYTES.length, sha256: sha(RECOVERY_BYTES), mime: 'application/pdf' });
    const notEligible = await worker.handlers['document.reconcile']({ payload: { organizationId, limit: 25 }, fencingToken: `not-eligible:${crypto.randomUUID()}` });
    assert.deepEqual(notEligible.recovered, []); assert.equal((await repository.findVersion({ organizationId, versionId: recoveredIntent.versionId })).state, 'UPLOADING');
    await restartRuntime();
    const agedRecovery = await tenant.query(`UPDATE document_storage.document_version SET updated_at=transaction_timestamp()-interval '6 minutes'
      WHERE organization_id=$1 AND version_id=$2 AND state='UPLOADING' RETURNING version_id`, [organizationId, recoveredIntent.versionId]);
    assert.equal(agedRecovery.rowCount, 1);
    const recovered = await worker.handlers['document.reconcile']({ payload: { organizationId, limit: 25 }, fencingToken: `eligible:${crypto.randomUUID()}` });
    assert(recovered.recovered.includes(recoveredIntent.versionId));
    recoveredRow = await repository.findVersion({ organizationId, versionId: recoveredIntent.versionId });
    assert.equal(recoveredRow.state, 'AVAILABLE'); assert.equal(recoveredRow.scan_state, 'CLEAN');
    await applicationService.execute('documentLink', { expectedRevision: 1, idempotencyKey: crypto.randomUUID(),
      documentId: recoveredIntent.documentId, versionId: recoveredIntent.versionId }, seeded.applicationId, allowed.request);
    observations.recovery = Object.freeze({ notEligibleNotClaimed: true, syntheticUpdatedAtAgedByMinutes: 6,
      memoryDiscardedBeforeEligibleClaim: true, recoveredFromRemoteEffect: true });

    phase = 'PERSISTED_MULTIPART_RESTART';
    const multipartBytes = Buffer.alloc(LIMITS.multipartThreshold + 1, 0x31); Buffer.from('%PDF-1.7\n').copy(multipartBytes, 0);
    const multipartIntent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId,
      input: intentInput(multipartBytes) });
    const multipartRow = await repository.findVersion({ organizationId, versionId: multipartIntent.versionId });
    await repository.transition({ organizationId, versionId: multipartIntent.versionId, fromState: 'PENDING', toState: 'UPLOADING',
      scanState: 'NOT_REQUESTED', lockVersion: 0 });
    const multipartKey = `${organizationId}/${multipartRow.object_id}`;
    safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: multipartKey, sha256: sha(multipartBytes), size: multipartBytes.length });
    const multipartHandle = await storage.beginMultipart({ objectId: multipartRow.object_id, storageClass: 'QUARANTINE', conditionalCreate: true,
      expectedSize: multipartBytes.length, expectedSha256: sha(multipartBytes), declaredMime: 'application/pdf' });
    const firstPart = multipartBytes.subarray(0, LIMITS.partBytes);
    await storage.writePart(multipartHandle, 1, Readable.from([firstPart]));
    await repository.registerMultipart({ organizationId, versionId: multipartIntent.versionId, objectId: multipartRow.object_id,
      providerUploadId: multipartHandle.multipartSessionId, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
    await repository.recordMultipartPart({ organizationId, versionId: multipartIntent.versionId, partNumber: 1,
      size: firstPart.length, sha256: sha(firstPart) });
    const multipartNotEligible = await worker.handlers['document.reconcile']({ payload: { organizationId, limit: 25 },
      fencingToken: `multipart-not-eligible:${crypto.randomUUID()}` });
    assert.deepEqual(multipartNotEligible.aborted, []);
    const agedMultipart = await tenant.query(`UPDATE document_storage.multipart_upload SET expires_at=transaction_timestamp()-interval '1 minute'
      WHERE organization_id=$1 AND version_id=$2 AND state='INITIATED' RETURNING version_id`, [organizationId, multipartIntent.versionId]);
    assert.equal(agedMultipart.rowCount, 1);
    remoteClient.destroy(); remoteClient = null; storage = null; scanner = null; worker = null;
    cleanupClient.destroy(); cleanupClient = null; safeguards.close();
    let restartOutput, restartFailure = null;
    try {
      restartOutput = execFileSync(process.execPath, [path.join(__dirname, 'group-c-r2-restart-worker.js')], { encoding: 'utf8',
        env: { ...process.env, DOC_MVP01_R2_RESTART_ORGANIZATION_ID: organizationId,
          DOC_MVP01_R2_RESTART_VERSION_ID: multipartIntent.versionId,
          DOC_MVP01_R2_RESTART_OBJECT_KEY: multipartKey,
          DOC_MVP01_R2_RESTART_UPLOAD_ID: multipartHandle.multipartSessionId } });
    } catch (error) { restartFailure = error; }
    const resumedBytes = fs.readFileSync(journalPath), resumedRecords = resumedBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    const resumed = reconstructProofJournal(resumedRecords); assert.equal(resumedRecords.at(-1)?.event, 'JOURNAL_CLOSED');
    safeguards = createProofSafeguards({ journalPath, proofTag: approved.runId, limits: SAFEGUARD_LIMITS,
      allowedBuckets: [approved.documentsBucket, approved.quarantineBucket], prefix: `${approved.runId}/`,
      allowedFetchOrigin: new URL(approved.configuration.endpoint).origin, resume: true });
    safeguards.recordJournalInterpretation({ sourceSequence: resumed.sequence, sourceSha256: sha(resumedBytes).toUpperCase() });
    cleanupClient = providerClient(approved, safeguards);
    delete require.cache[require.resolve('../../../backend/src/documents/r2Storage')];
    buildRemoteRuntime();
    if (restartFailure) throw Object.assign(new Error('R2_CONTINUATION_RESTART_WORKER_FAILED'), { cause: restartFailure });
    const multipartRecovered = JSON.parse(restartOutput.trim());
    assert.equal(multipartRecovered.abortedVersionId, multipartIntent.versionId);
    const multipartState = await tenant.query('SELECT state FROM document_storage.multipart_upload WHERE organization_id=$1 AND version_id=$2',
      [organizationId, multipartIntent.versionId]);
    assert.equal(multipartState.rows[0]?.state, 'ABORTED');
    observations.multipart = Object.freeze({ initialNotEligible: true, syntheticExpiryAgedByMinutes: 1,
      processBoundary: true, processMemoryDiscarded: true, persistedUploadIdRecovered: true, exactSessionAbsent: true });

    phase = 'EICAR_BLOCKED';
    const infected = await upload(EICAR_BYTES, { fileClass: 'OOXML',
      declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'eicar.docx' });
    await processOne(); const infectedRow = await repository.findVersion({ organizationId, versionId: infected.versionId });
    assert.equal(infectedRow.state, 'QUARANTINED'); assert.equal(infectedRow.scan_state, 'INFECTED');
    await assert.rejects(() => applicationService.execute('documentLink', { expectedRevision: 2, idempotencyKey: crypto.randomUUID(),
      documentId: infected.documentId, versionId: infected.versionId }, seeded.applicationId, allowed.request));
    await assert.rejects(() => transport.download({ organizationId, versionId: infected.versionId }), unavailable);

    phase = 'SCANNER_TIMEOUT_RECOVERY';
    const timeoutIntent = await upload(TIMEOUT_BYTES); docker('pause', CLAM_CONTAINER); let paused = true;
    try {
      await processOne({ expectedFailure: true });
      assert.equal((await repository.findVersion({ organizationId, versionId: timeoutIntent.versionId })).state, 'SCANNING');
    } finally { if (paused) { docker('unpause', CLAM_CONTAINER); paused = false; } }
    await waitForScanner(scanner); await queue.boss.send(queue.queueName, { organizationId, versionId: timeoutIntent.versionId,
      correlationId: crypto.randomUUID() }, { retryLimit: 0 }); await processOne();
    assert.equal((await repository.findVersion({ organizationId, versionId: timeoutIntent.versionId })).state, 'AVAILABLE');

    phase = 'SCANNER_UNAVAILABLE_RECOVERY';
    const unavailableIntent = await upload(UNAVAILABLE_BYTES); docker('stop', '--time', '5', CLAM_CONTAINER); let stopped = true;
    try {
      assert.equal((await scanner.health()).ready, false); await processOne({ expectedFailure: true });
      assert.equal((await repository.findVersion({ organizationId, versionId: unavailableIntent.versionId })).state, 'SCANNING');
    } finally { if (stopped) { docker('start', CLAM_CONTAINER); stopped = false; } }
    await waitForScanner(scanner); await queue.boss.send(queue.queueName, { organizationId, versionId: unavailableIntent.versionId,
      correlationId: crypto.randomUUID() }, { retryLimit: 0 }); await processOne();
    assert.equal((await repository.findVersion({ organizationId, versionId: unavailableIntent.versionId })).state, 'AVAILABLE');
    observations.scanner = Object.freeze({ eicarBlocked: true, timeoutStayedClosed: true, unavailableStayedClosed: true,
      recoveredAfterRestore: true, ooxmlStructuralInspection: 'NOT_IMPLEMENTED' });

    phase = 'REVOCATION_AND_EXPIRY';
    const authorizedDownload = await applicationService.execute('documentDownload', { versionId: recoveredIntent.versionId }, seeded.applicationId, allowed.request);
    const issuanceStartedAt = new Date().toISOString();
    const download = await transport.download({ organizationId: authorizedDownload.organizationId, versionId: recoveredIntent.versionId });
    const issuedAt = new Date().toISOString();
    assert.equal(download.capability.kind, 'R2_SIGNED_DOWNLOAD');
    const signedTiming = inspectSignedCapability({ capability: download.capability, issuanceStartedAt, issuedAt,
      maximumTtlSeconds: LIMITS.downloadCapabilityMs / 1000 });
    await membershipRepository.changeStatus({ membershipId: allowed.membershipId, status: 'REMOVED', reason: 'R2_CONTINUATION_REVOCATION_PROOF' });
    await assert.rejects(() => applicationService.execute('documentDownload', { versionId: recoveredIntent.versionId },
      seeded.applicationId, allowed.request), unavailable);
    const beforeExpiryVerificationAt = new Date().toISOString();
    const stillValid = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: RECOVERY_BYTES.length });
    assert.deepEqual(await responseBytes(stillValid, RECOVERY_BYTES.length), RECOVERY_BYTES);
    const expiryWait = Math.max(Date.parse(download.capability.expiresAt), Date.parse(signedTiming.signedExpiresAt)) - Date.now() + 2000;
    if (expiryWait > 0) await new Promise(resolve => setTimeout(resolve, expiryWait));
    const afterExpiryVerificationAt = new Date().toISOString();
    const expired = await safeguards.controlledFetch(fetch, download.capability.url,
      { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: 0 });
    assert.equal(expired.ok, false); await expired.body?.cancel();
    observations.revocation = Object.freeze({ newIssueDenied: true, issuedUrlValidInsideTtl: true, issuedUrlDeniedAfterTtl: true,
      ...signedTiming, beforeExpiryVerificationAt, afterExpiryVerificationAt });

    phase = 'REMOTE_CLEANUP';
    await storage.shutdown(); storage = null; remoteClient = null;
    cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3); assert.equal(cleanup.status, 'COMPLETE');
    phase = 'FINAL_INVENTORY'; await assertEmptyPrefix(cleanupClient, approved); proofStarted = false;
    const result = Object.freeze({ result: 'PASS', continuationOnly: true, interpreterVersion: JOURNAL_INTERPRETER_VERSION,
      plan: CONTINUATION_PLAN, planTotal: PLAN_TOTAL, planMargin, recovery: observations.recovery, multipart: observations.multipart,
      scanner: observations.scanner, revocation: observations.revocation, cleanup, enforcedBudgets: safeguards.snapshot(),
      storage: 'REAL_R2', authority: 'REAL_CENTRAL_WITH_SYNTHETIC_SESSION', queue: 'REAL_PG_BOSS',
      ooxmlStructuralInspection: 'NOT_IMPLEMENTED', idp: 'NOT_EXECUTED', browser: 'NOT_EXECUTED', supervisedWorker: 'NOT_EXECUTED' });
    fs.writeFileSync(path.join(approved.evidence, 'r2-continuation-results.json'), `${JSON.stringify(result, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    error.proofDiagnostic = sanitizedError(error, phase, safeguards.snapshot());
    error.proofDiagnosticPath = writeFailureEvidence(approved.evidence, error.proofDiagnostic); throw error;
  } finally {
    try { if (docker('inspect', '-f', '{{.State.Paused}}', CLAM_CONTAINER) === 'true') docker('unpause', CLAM_CONTAINER); } catch {}
    try { if (docker('inspect', '-f', '{{.State.Status}}', CLAM_CONTAINER) !== 'running') docker('start', CLAM_CONTAINER); } catch {}
    if (storage) await storage.shutdown().catch(() => {});
    if (proofStarted && safeguards && cleanupClient) cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3).catch(error => ({ status: 'UNCERTAIN', errorCode: error.code || error.name }));
    cleanupClient?.destroy();
    if (fixture) await fixture.manager.closeAll().catch(() => {});
    if (queue) await queue.close().catch(() => {});
    if (central) await central.close().catch(() => {});
    if (tenant) await tenant.end().catch(() => {});
    for (const database of [QUEUE_DB, TENANT_DB]) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => {});
    try { await admin.end(); } finally { safeguards.close(); }
  }
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null,
      message: error.code || error.name || 'R2_CONTINUATION_FAILED', diagnostic: error.proofDiagnostic || null,
      diagnosticPath: error.proofDiagnosticPath || null })}\n`); process.exitCode = 1;
  });
}

module.exports = { CONTINUATION_PROOF, EXPECTED_JOURNAL, CONTINUATION_PLAN, PLAN_TOTAL, validateContinuationBaseline, assertPlanFits };
