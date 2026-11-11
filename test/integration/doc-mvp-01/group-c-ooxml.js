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
const { createOoxmlStructuralInspector } = require('../../../backend/src/documents/ooxmlStructuralInspector');
const { createR2AdapterBoundary } = require('../../../backend/src/documents/r2Adapter');
const { loadApplicationDocumentConfiguration } = require('../../../backend/src/config/applicationDocuments');
const { createProofSafeguards, reconstructProofJournal } = require('./r2-proof-safeguards');
const { FIXTURE_IDS, fixture, sha256 } = require('./ooxml-proof-fixtures');
const { providerClient, databaseUrl, sha, sanitizedError, writeFailureEvidence, request, unavailable,
  createInfrastructure, seedApplication, createQueue, assertEmptyPrefix, responseBytes, waitForScanner, docker,
  FULL_PERMISSIONS, CLAM_CONTAINER } = require('./group-c-r2');

const PROOF = 'C4G_DOC_MVP01_R2_OOXML_V1';
const BASELINE = Object.freeze({
  sequence: 693,
  sha256: 'E3BE8414537080ECEBE805A5DE45C151CBCFA67639FBDAEFDF0CAD649A0BF65E',
  budget: Object.freeze({ functionalRequests: 97, cleanupRequests: 31, applicationBytes: 58721774,
    objectIntentions: 12, completedObjects: 11, multipartIntentions: 3, unresolvedMultipart: 0 })
});
const PREVIOUS_LIMITS = Object.freeze({ functionalRequests: 101, cleanupRequests: 32,
  applicationBytes: 67108864, objectIntentions: 12, completedObjects: 11,
  multipartIntentions: 3, unresolvedMultipart: 2 });
const PLAN = Object.freeze({ functionalRequests: 280, cleanupRequests: 24, applicationBytes: 1711655,
  objectIntentions: 8, completedObjects: 8, multipartIntentions: 0, unresolvedMultipart: 0 });
const LIMITS = Object.freeze({ functionalRequests: 377, cleanupRequests: 63,
  applicationBytes: 67108864, objectIntentions: 20, completedObjects: 19,
  multipartIntentions: 3, unresolvedMultipart: 2 });
const PROPOSED_TOTAL_REQUEST_LIMIT = LIMITS.functionalRequests + LIMITS.cleanupRequests;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = code => Object.assign(new Error(code), { code });

const SCENARIOS = Object.freeze([
  Object.freeze({ id: 'valid-docx', outcome: 'AVAILABLE', associate: true, download: true }),
  Object.freeze({ id: 'valid-xlsx', outcome: 'AVAILABLE', associate: true, download: true }),
  Object.freeze({ id: 'valid-pptx', outcome: 'AVAILABLE', associate: true, download: true }),
  Object.freeze({ id: 'external-docx', outcome: 'QUARANTINED', detailCode: 'OOXML_EXTERNAL_RELATIONSHIP_FORBIDDEN' }),
  Object.freeze({ id: 'active-xlsx', outcome: 'QUARANTINED', detailCode: 'OOXML_ACTIVE_CONTENT_FORBIDDEN' }),
  Object.freeze({ id: 'broken-pptx', outcome: 'QUARANTINED', detailCode: 'OOXML_RELATIONSHIP_TARGET_MISSING' }),
  Object.freeze({ id: 'expanded-docx', outcome: 'QUARANTINED', detailCode: 'OOXML_EXPANSION_LIMIT_EXCEEDED' }),
  Object.freeze({ id: 'cancel-docx', outcome: 'AVAILABLE_AFTER_CANCEL_RETRY', cancelBeforeWorker: true })
]);

function assertPlanFits(baseline = BASELINE.budget, limits = LIMITS, plan = PLAN) {
  for (const name of ['functionalRequests', 'cleanupRequests', 'applicationBytes', 'objectIntentions',
    'completedObjects', 'multipartIntentions']) assert(baseline[name] + plan[name] <= limits[name], name);
  assert(Math.max(baseline.unresolvedMultipart, plan.unresolvedMultipart) <= limits.unresolvedMultipart);
  assert.equal(limits.functionalRequests + limits.cleanupRequests, PROPOSED_TOTAL_REQUEST_LIMIT);
  return Object.freeze(Object.fromEntries(Object.keys(baseline).map(name => [name,
    name === 'unresolvedMultipart' ? Math.max(baseline[name], plan[name]) : baseline[name] + plan[name]])));
}

function validateBaseline(records, bytes) {
  if (!Array.isArray(records) || records.at(-1)?.event !== 'JOURNAL_CLOSED') throw failure('R2_OOXML_JOURNAL_NOT_CLOSED');
  const reconstructed = reconstructProofJournal(records);
  assert.equal(reconstructed.sequence, BASELINE.sequence);
  assert.equal(sha(bytes).toUpperCase(), BASELINE.sha256);
  assert.deepEqual(reconstructed.budget, BASELINE.budget);
  return reconstructed;
}

function approvedTarget() {
  const runId = String(process.env.DOC_MVP01_R2_RUN_ID || '').toLowerCase();
  if (runId !== 'df1f6c0b-c107-4509-af52-73b4eefb244b') throw failure('R2_OOXML_RUN_ID_INVALID');
  if (process.env.DOC_MVP01_R2_OOXML_PROOF !== PROOF) throw failure('R2_OOXML_AUTHORIZATION_REQUIRED');
  const loaded = loadApplicationDocumentConfiguration(process.env), endpointHash = sha(Buffer.from(loaded.r2.endpoint, 'utf8'));
  const url = new URL(process.env.DOC_MVP01_R2_ADMIN_URL), evidence = process.env.DOC_MVP01_R2_EVIDENCE;
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55431' || url.pathname !== '/postgres') {
    throw failure('R2_OOXML_POSTGRES_TARGET_INVALID');
  }
  if (!evidence || !path.isAbsolute(evidence)) throw failure('R2_OOXML_EVIDENCE_PATH_REQUIRED');
  if (process.env.DOC_MVP01_CLAMAV_CONTAINER !== CLAM_CONTAINER) throw failure('R2_OOXML_CLAMAV_TARGET_INVALID');
  if (loaded.scanner.host !== '127.0.0.1' || loaded.scanner.port !== 53310) throw failure('R2_OOXML_CLAMAV_ENDPOINT_INVALID');
  if (endpointHash !== process.env.DOC_MVP01_R2_APPROVED_ENDPOINT_SHA256
    || loaded.r2.documentsBucket !== process.env.DOC_MVP01_R2_APPROVED_DOCUMENTS_BUCKET
    || loaded.r2.quarantineBucket !== process.env.DOC_MVP01_R2_APPROVED_QUARANTINE_BUCKET
    || process.env.DOC_MVP01_R2_APPROVED_PREFIX !== `${runId}/`) throw failure('R2_OOXML_DESTINATION_NOT_APPROVED');
  const approvals = [['FUNCTIONAL_REQUESTS', '377'], ['CLEANUP_REQUESTS', '63'], ['TOTAL_REQUESTS', '440'],
    ['APPLICATION_BYTES', '67108864'], ['OBJECT_INTENTIONS', '20'], ['COMPLETED_OBJECTS', '19'],
    ['MULTIPART_INTENTIONS', '3'], ['UNRESOLVED_MULTIPART', '2']];
  if (approvals.some(([name, expected]) => process.env[`DOC_MVP01_R2_OOXML_APPROVED_${name}`] !== expected)) {
    throw failure('R2_OOXML_BUDGETS_NOT_APPROVED');
  }
  const configuration = Object.freeze({ ...loaded.r2,
    capabilities: Object.freeze({ layerCValidated: true, multipartConditionalValidated: true }) });
  return Object.freeze({ url, evidence, runId, endpointHash, configuration, credentials: loaded.credentials,
    documentsBucket: loaded.r2.documentsBucket, quarantineBucket: loaded.r2.quarantineBucket });
}

function recordFor(row, value) {
  return Object.freeze({ organizationId: row.organization_id, versionId: row.version_id, objectId: row.object_id,
    lockVersion: Number(row.lock_version), observedSize: Number(row.observed_size), expectedSize: Number(row.expected_size),
    sha256: row.sha256, expectedSha256: row.expected_sha256, expectedFileClass: row.expected_file_class,
    declaredMime: row.declared_mime, displayFilename: row.display_filename, state: row.state,
    scanState: row.scan_state, fixtureId: value.id });
}

async function run() {
  const approved = approvedTarget(), journalPath = path.join(approved.evidence, 'r2-proof-journal.jsonl');
  const journalBytes = fs.readFileSync(journalPath), records = journalBytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  const baseline = validateBaseline(records, journalBytes), projected = assertPlanFits();
  const safeguards = createProofSafeguards({ journalPath, proofTag: approved.runId, limits: LIMITS,
    allowedBuckets: [approved.documentsBucket, approved.quarantineBucket], prefix: `${approved.runId}/`,
    allowedFetchOrigin: new URL(approved.configuration.endpoint).origin, resume: true });
  safeguards.recordBudgetAuthorization(PREVIOUS_LIMITS, 'R2_OOXML_INTEGRATED_2026_10_24');
  safeguards.recordJournalInterpretation({ sourceSequence: baseline.sequence, sourceSha256: BASELINE.sha256 });
  assert.deepEqual(safeguards.snapshot(), BASELINE.budget);
  const admin = new Pool({ connectionString: approved.url.toString(), max: 3 });
  const cleanupClient = providerClient(approved, safeguards);
  let tenant, central, queue, runtimeFixture, storage, remoteClient, cleanup, proofStarted = false;
  let phase = 'INITIAL_INVENTORY';
  const observations = { audits: [], fixtures: [], cancellation: null };
  const audit = Object.freeze({
    async accept(code) { observations.audits.push(code); },
    async emit(code, value) { observations.audits.push(`${code}:${value?.detailCode || value?.result || 'RECORDED'}`); }
  });
  const reconciliation = Object.freeze({ async record(value) { observations.audits.push(value.code); } });
  try {
    phase = 'LOCAL_INFRASTRUCTURE'; tenant = await createInfrastructure(admin);
    const identity = Object.freeze({ tenantId: approved.runId, databaseGenerationId: crypto.randomUUID() });
    phase = 'TENANT_MIGRATIONS';
    await createTenantMigrationRunner({ pool: tenant, entries: manifest, observationPublisher: { async publish() {} },
      timeoutMs: 60000, scheduler: { setTimeout, clearTimeout } }).migrate(request('r2-ooxml-to031', identity));
    const evidence031 = await preflightTenant(tenant, identity, manifest, { timeoutMs: 60000 });
    assert.equal(evidence031.currentVersion, '031_application_document_transport');
    phase = 'CENTRAL_AUTHORITY_AND_QUEUE';
    central = await require('../f13/central-authority-fixture').centralAuthorityFixture(approved.url.toString(), { validateHistoricalRoundTrip: false });
    queue = await createQueue(approved.url);
    runtimeFixture = await require('../f13/runtime-fixture').runtimeFixture({ pool: tenant, evidence: evidence031,
      sessions: { memberships: new Map() } });
    const membershipRepository = createMembershipRepository(central.pool, central.coordinator);
    runtimeFixture.dependencies.membershipRepository = membershipRepository;
    const organizationId = identity.tenantId, allowed = await central.user(organizationId, crypto.randomUUID(), crypto.randomUUID());
    const scope = { type: 'ORGANIZATION', id: organizationId, organizationId };
    await central.data.change({ organizationId, membershipId: allowed.membershipId, expectedVersion: 1,
      grants: FULL_PERMISSIONS.map(permission => ({ permission, scope })), assuranceRequirements: central.requirement });
    const seeded = await seedApplication(tenant, organizationId, allowed.membershipId, allowed.id);
    const applicationService = createApplicationComposition({ sessionStore: central.store, sessionRegistry: central.registry,
      authorityCoordinator: central.coordinator, centralPool: central.pool, authorizationCatalogs: central.catalogs,
      assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: central.requirement,
      tenantRuntimeDependencies: runtimeFixture.dependencies,
      tokenKeys: { local: crypto.randomBytes(32).toString('hex') }, tokenKeyId: 'local' });
    const accessPort = createApplicationDocumentAuthorizationAdapter({ applicationService });
    const repository = createDocumentRepository(tenant);
    remoteClient = providerClient(approved, safeguards);
    storage = createR2AdapterBoundary(approved.configuration, { organizationId, credentials: approved.credentials, client: remoteClient });
    const scanner = createClamavScanner({ organizationId, storage, host: '127.0.0.1', port: 53310, timeoutMs: 60000 });
    phase = 'LOCAL_SCANNER_READINESS'; await waitForScanner(scanner);
    phase = 'INITIAL_INVENTORY'; await assertEmptyPrefix(cleanupClient, approved); proofStarted = true;
    phase = 'STORAGE_READINESS'; assert.deepEqual(await storage.health(), { ready: true, adapter: 'r2-s3-v1' });
    const jobs = Object.freeze({ async enqueueScan(value) { await queue.boss.send(queue.queueName, value, { retryLimit: 0 }); } });
    const transport = createApplicationDocumentTransport({ accessPort,
      repositoryFactory: value => { assert.equal(value, organizationId); return repository; },
      storageFactory: value => { assert.equal(value, organizationId); return storage; }, auditFactory: () => audit,
      reconciliationFactory: () => reconciliation, jobs, clock: () => new Date(), id: crypto.randomUUID });
    const normalWorker = createDocumentWorker({ portsForOrganization: value => { assert.equal(value, organizationId); return {
      repository, storage, scanService: createScanService({ scanner, repository, storage, audit }), audit, reconciliation }; } });

    async function upload(value) {
      const intent = await transport.createIntent({ request: allowed.request, applicationId: seeded.applicationId,
        input: { expectedSize: value.size, declaredMime: value.mime, filename: value.filename, fileClass: 'OOXML',
          checksum: value.sha256, idempotencyKey: crypto.randomUUID(), versionNumber: 1 } });
      const row = await repository.findVersion({ organizationId, versionId: intent.versionId });
      assert(row?.object_id && UUID.test(row.object_id));
      safeguards.registerObjectIntent({ Bucket: approved.quarantineBucket, Key: `${organizationId}/${row.object_id}`,
        sha256: value.sha256, size: value.size });
      const uploaded = await transport.upload({ request: allowed.request, applicationId: seeded.applicationId,
        versionId: intent.versionId, token: intent.capability, source: Readable.from([value.bytes]) });
      assert.equal(uploaded.sha256, value.sha256); assert.equal(uploaded.size, value.size);
      const jobsReady = await queue.boss.fetch(queue.queueName, { batchSize: 1 }); assert.equal(jobsReady.length, 1);
      return Object.freeze({ value, intent, job: jobsReady[0] });
    }
    async function processOne(item, worker = normalWorker) {
      const result = await worker.handlers['document.scan']({ payload: item.job.data, fencingToken: `pgboss:${item.job.id}` });
      await queue.boss.complete(queue.queueName, item.job.id, result); return result;
    }

    let applicationRevision = 1;
    for (const scenario of SCENARIOS) {
      phase = `OOXML_${scenario.id.toUpperCase().replaceAll('-', '_')}`;
      const value = fixture(scenario.id), item = await upload(value);
      if (scenario.cancelBeforeWorker) {
        const row = await repository.findVersion({ organizationId, versionId: item.intent.versionId });
        const controller = new AbortController(); let rangeOpened = false, streamClosed = false;
        const cancelStorage = Object.freeze({
          head: input => storage.head(input),
          async readRange(input) {
            const source = await storage.readRange(input); rangeOpened = true;
            source.once('close', () => { streamClosed = true; }); controller.abort(); return source;
          }
        });
        const inspector = createOoxmlStructuralInspector();
        await assert.rejects(inspector.inspect({ record: recordFor(row, value), storage: cancelStorage,
          signal: controller.signal }), error => error?.code === 'OOXML_INSPECTION_ABORTED');
        assert.equal(rangeOpened, true); await new Promise(resolve => setImmediate(resolve)); assert.equal(streamClosed, true);
        assert.equal((await repository.findVersion({ organizationId, versionId: item.intent.versionId })).state, 'SCANNING');
        await processOne(item);
        const retried = await repository.findVersion({ organizationId, versionId: item.intent.versionId });
        assert.equal(retried.state, 'AVAILABLE'); assert.equal(retried.sha256, value.sha256);
        observations.cancellation = Object.freeze({ storageRangeCancelled: true, streamClosed: true,
          stateBeforeRetry: 'SCANNING', stateAfterRetry: 'AVAILABLE', contentSha256: value.sha256 });
      } else {
        await processOne(item);
        const row = await repository.findVersion({ organizationId, versionId: item.intent.versionId });
        assert.equal(row.state, scenario.outcome); assert.equal(row.sha256, value.sha256);
        if (scenario.outcome === 'AVAILABLE') {
          await applicationService.execute('documentLink', { expectedRevision: applicationRevision++,
            idempotencyKey: crypto.randomUUID(), documentId: item.intent.documentId,
            versionId: item.intent.versionId }, seeded.applicationId, allowed.request);
          const authorized = await applicationService.execute('documentDownload', { versionId: item.intent.versionId },
            seeded.applicationId, allowed.request);
          const download = await transport.download({ organizationId: authorized.organizationId, versionId: item.intent.versionId });
          const response = await safeguards.controlledFetch(fetch, download.capability.url,
            { headers: download.capability.headers, redirect: 'error' }, { expectedBytes: value.size });
          assert.deepEqual(await responseBytes(response, value.size), value.bytes);
        } else {
          assert(observations.audits.includes(`DOCUMENT_SCAN_COMPLETED:${scenario.detailCode}`));
          await assert.rejects(() => transport.download({ organizationId, versionId: item.intent.versionId }), unavailable);
        }
      }
      observations.fixtures.push(Object.freeze({ id: value.id, extension: value.extension, mime: value.mime,
        entries: value.entries, purpose: value.purpose, sha256: value.sha256, size: value.size,
        confirmedSha256: value.sha256, inspectedSha256: value.sha256,
        downloadedSha256: scenario.download ? value.sha256 : null,
        expected: scenario.outcome, structuralCode: value.expectedCode }));
    }

    phase = 'EVIDENCE_BEFORE_CLEANUP';
    const clamav = Object.freeze({ version: docker('exec', CLAM_CONTAINER, 'clamdscan', '--version'),
      image: docker('inspect', '-f', '{{.Image}}', CLAM_CONTAINER),
      signatures: docker('exec', CLAM_CONTAINER, 'sh', '-c', "sigtool --info /var/lib/clamav/daily.cvd 2>/dev/null | grep -E 'Version:|Build time:|Signatures:'") });
    const resultBeforeCleanup = Object.freeze({ result: 'PASS_BEFORE_CLEANUP', proof: PROOF, projected,
      tenantVersion: evidence031.currentVersion, fixtures: Object.freeze(observations.fixtures),
      cancellation: observations.cancellation, auditCodes: Object.freeze(observations.audits), clamav,
      budget: safeguards.snapshot(),
      services: Object.freeze({ storage: 'REAL_R2', scanner: 'REAL_CLAMAV', authority: 'REAL_CENTRAL_WITH_SYNTHETIC_SESSION',
        queue: 'REAL_PG_BOSS', tenant: 'REAL_POSTGRESQL' }),
      limitations: Object.freeze(['IDP_SESSION_SYNTHETIC', 'WORKER_LIFECYCLE_SIGNAL_NOT_PROPAGATED', 'BROWSER_NOT_RUN']) });
    fs.writeFileSync(path.join(approved.evidence, 'r2-ooxml-proof-before-cleanup.json'),
      `${JSON.stringify(resultBeforeCleanup, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    phase = 'REMOTE_CLEANUP'; await storage.shutdown(); storage = null; remoteClient = null;
    try { cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3); }
    finally { proofStarted = false; }
    assert.equal(cleanup.status, 'COMPLETE');
    phase = 'FINAL_INVENTORY'; await assertEmptyPrefix(cleanupClient, approved);
    const result = Object.freeze({ ...resultBeforeCleanup, result: 'PASS', cleanup, finalBudget: safeguards.snapshot() });
    fs.writeFileSync(path.join(approved.evidence, 'r2-ooxml-results.json'), `${JSON.stringify(result, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    error.proofDiagnostic = sanitizedError(error, phase, safeguards.snapshot());
    error.proofDiagnosticPath = writeFailureEvidence(approved.evidence, error.proofDiagnostic); throw error;
  } finally {
    if (storage) await storage.shutdown().catch(() => {});
    if (proofStarted) cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3)
      .catch(error => ({ status: 'UNCERTAIN', errorCode: error.code || error.name }));
    cleanupClient.destroy();
    if (runtimeFixture) await runtimeFixture.manager.closeAll().catch(() => {});
    if (queue) await queue.close().catch(() => {});
    if (central) await central.close().catch(() => {});
    if (tenant) await tenant.end().catch(() => {});
    for (const database of ['doc_mvp01_r2_queue', 'doc_mvp01_r2_tenant']) {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => {});
    }
    try { await admin.end(); } finally { safeguards.close(); }
  }
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null,
    message: error.code || error.name || 'R2_OOXML_PROOF_FAILED', diagnostic: error.proofDiagnostic || null,
    diagnosticPath: error.proofDiagnosticPath || null })}\n`); process.exitCode = 1;
});

module.exports = { BASELINE, LIMITS, PLAN, PREVIOUS_LIMITS, PROOF, PROPOSED_TOTAL_REQUEST_LIMIT,
  SCENARIOS, approvedTarget, assertPlanFits, run, validateBaseline };
