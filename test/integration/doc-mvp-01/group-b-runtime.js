'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { Pool } = require('../../../backend/node_modules/pg');
const { createApplicationDocumentTransport } = require('../../../backend/src/documents/applicationTransport');
const { createConfirmationService } = require('../../../backend/src/documents/confirmationService');
const { createDocumentRepository } = require('../../../backend/src/documents/repository');
const { createDocumentWorker } = require('../../../backend/src/documents/worker');
const { createScanService } = require('../../../backend/src/documents/scanService');
const { inspectDocumentInfrastructure } = require('../../../backend/src/documents/infrastructureStatus');
const { validateProductionDocumentsBootstrap } = require('../../../backend/src/documents/productionDocuments');
const { createF11ObjectStorageDouble } = require('../../../backend/test/support/f11ObjectStorageDouble');
const { createF11MalwareScanDouble } = require('../../../backend/test/support/f11MalwareScanDouble');
const { createPgBossQueueAdapter } = require('../../../backend/src/async/adapters/pgBossQueueAdapter');
const { createEnvelopeV2, createTrustedObservability } = require('../../../backend/src/async/envelope');
const { createWorkerProcessor } = require('../../../backend/src/async/workerProcessor');
const { InboxRepository } = require('../../../backend/src/async/inboxRepository');
const { WorkerLifecycle } = require('../../../backend/src/async/workerLifecycle');
const { load: loadAsyncMigration } = require('../../../backend/src/async/migrationManifest');

const PROOF = 'C4G_DOC_MVP01_GROUP_B_V2';
const DB_A = 'doc_mvp01_031_a';
const DB_B = 'doc_mvp01_031_b';
const DB_QUEUE = 'doc_mvp01_b_queue';
const PERMISSIONS = Object.freeze({
  DOCUMENT_UPLOAD_INITIATE: 'document.upload.initiate',
  DOCUMENT_UPLOAD_CONFIRM: 'document.upload.confirm',
  DOCUMENT_VERSION_CREATE: 'document.version.create'
});

function target(name) {
  if (process.env.DOC_MVP01_GROUP_B_PROOF !== PROOF) throw new Error('Disposable Group B proof is required.');
  const url = new URL(process.env.DOC_MVP01_GROUP_B_ADMIN_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '56031' || url.pathname !== '/postgres') {
    throw new Error('Group B target is not the dedicated local PostgreSQL instance.');
  }
  url.pathname = `/${name}`;
  return url;
}

async function queueDatabase() {
  const adminUrl = target('postgres');
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    for (const role of ['c4g_central_owner', 'c4g_central_runtime']) {
      if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
    }
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [DB_QUEUE])).rowCount) {
      await admin.query(`CREATE DATABASE ${DB_QUEUE} ENCODING 'UTF8' TEMPLATE template0`);
    }
  } finally { await admin.end(); }
  const url = target(DB_QUEUE);
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  if (!(await pool.query("SELECT to_regclass('pgboss.version') IS NOT NULL AS installed")).rows[0].installed) {
    await pool.query(loadAsyncMigration('central', 'up').sql);
  }
  return Object.freeze({ pool, url });
}

function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function failure(code) { return Object.assign(new Error(code), { code }); }

function createExplicitAccessPolicy({ applications, memberships }) {
  const evidence = { checks: 0, lookups: 0, denials: [] };
  return Object.freeze({
    evidence,
    async authorize({ request, applicationId, operationCode }) {
      evidence.checks += 1;
      const actor = request?.actor;
      const membership = actor && memberships.get(actor.membershipId);
      const permission = PERMISSIONS[operationCode];
      if (!membership || membership.status !== 'ACTIVE' || membership.userId !== actor.id
        || membership.organizationId !== actor.organizationId || !permission || !membership.grants.has(permission)) {
        evidence.denials.push('AUTHORIZATION');
        throw failure('DOCUMENT_NOT_AVAILABLE');
      }
      evidence.lookups += 1;
      const application = applications.get(applicationId);
      if (!application || application.organizationId !== membership.organizationId) {
        evidence.denials.push('RESOURCE');
        throw failure('DOCUMENT_NOT_AVAILABLE');
      }
      return Object.freeze({ context: Object.freeze({ actor: Object.freeze({ id: actor.id,
        organizationId: actor.organizationId }), correlationId: request.correlationId || crypto.randomUUID(),
        causationId: null, signal: request.signal }), resourceId: applicationId });
    }
  });
}

function transportInput(bytes, overrides = {}) {
  return { expectedSize: bytes.length, declaredMime: 'application/pdf', filename: 'synthetic.pdf',
    fileClass: 'PDF', checksum: sha(bytes), idempotencyKey: crypto.randomUUID(), versionNumber: 1, ...overrides };
}

async function seedObject(storage, objectId, bytes, mime = 'application/pdf') {
  const checksum = sha(bytes);
  const handle = await storage.beginWrite({ objectId, storageClass: 'QUARANTINE', conditionalCreate: true,
    expectedSize: bytes.length, expectedSha256: checksum, declaredMime: mime });
  await storage.write(handle, Readable.from([bytes]));
  await storage.commit(handle, { size: bytes.length, sha256: checksum, mime });
  return checksum;
}

async function seedVersion(repository, organizationId, resourceId, bytes, state) {
  const documentId = crypto.randomUUID(), versionId = crypto.randomUUID(), objectId = crypto.randomUUID();
  const checksum = sha(bytes);
  await repository.createIntent({ documentId, versionId, organizationId, versionNumber: 1, objectId,
    expectedSize: bytes.length, fileClass: 'PDF', checksum, declaredMime: 'application/pdf',
    displayFilename: 'recovery.pdf', idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID(),
    causationId: null, actorId: crypto.randomUUID(), capabilityDigest: sha(Buffer.from(crypto.randomUUID())),
    capabilityExpiresAt: new Date(Date.now() + 600000).toISOString(), resourceType: 'APPLICATION', resourceId });
  if (state !== 'PENDING') await repository.transition({ organizationId, versionId, fromState: 'PENDING',
    toState: 'UPLOADING', scanState: 'NOT_REQUESTED', lockVersion: 0 });
  if (['UPLOADED', 'SCANNING'].includes(state)) await repository.transition({ organizationId, versionId,
    fromState: 'UPLOADING', toState: 'UPLOADED', scanState: 'PENDING', lockVersion: 1,
    observedSize: bytes.length, detectedMime: 'application/pdf', sha256: checksum });
  if (state === 'SCANNING') {
    await repository.confirm({ organizationId, versionId, sha256: checksum, size: bytes.length });
    await repository.transition({ organizationId, versionId, fromState: 'UPLOADED', toState: 'SCANNING',
      scanState: 'PENDING', lockVersion: 2 });
  }
  return Object.freeze({ documentId, versionId, objectId, checksum, bytes });
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function queueProof({ tenantPool, queuePool, connectionString, worker, ports, organizationId, versionId }) {
  const queueMap = Object.freeze({ 'document.scan': 'c4g.document.scan',
    'document.reconcile': 'c4g.document.reconcile', 'document.expire_upload': 'c4g.document.expire-upload' });
  const { PgBoss } = await import(pathToFileURL(require.resolve('../../../backend/node_modules/pg-boss')).href);
  const setup = new PgBoss({ connectionString, schema: 'pgboss', createSchema: false, migrate: false,
    supervise: false, schedule: false });
  await setup.start({ supervise: false, schedule: false });
  try { for (const name of Object.values(queueMap)) if (!(await setup.getQueue(name))) await setup.createQueue(name); }
  finally { await setup.stop({ graceful: true, timeout: 30000 }); }
  const queue = await createPgBossQueueAdapter({ connectionString, queueMap,
    inspectSchema: async () => ({ schema: 'pgboss', schemaVersion: Number((await queuePool.query('SELECT version FROM pgboss.version')).rows[0].version) }) });
  const lifecycle = new WorkerLifecycle({ queue, run: async () => {} });
  const processor = createWorkerProcessor({ queue, registry: worker.registry, inbox: new InboxRepository(),
    transactionResolver: { resolve: async requested => {
      assert.equal(requested, organizationId);
      return work => transaction(tenantPool, work);
    } }, lifecycle, consumer: 'doc-mvp01-group-b', workerId: 'doc-mvp01-worker',
    clock: () => new Date('2026-10-24T12:00:01Z') });
  const observability = createTrustedObservability({ traceparent: null, tracestate: null });
  const runId = crypto.randomUUID();
  async function publish(type, payload, suffix, duplicate = false) {
    const created = createEnvelopeV2({ trustedContext: { organizationId,
      actor: { kind: 'SERVICE', serviceActorCode: 'F11_DOCUMENT_WORKER' }, operation: type,
      correlationId: crypto.randomUUID(), causationId: crypto.randomUUID() },
    job: { type, version: 1, payloadVersion: 1, idempotencyKey: `doc-${suffix}-${runId}`, deadlineMs: 300000 },
    payload, registry: worker.registry, observability, clock: () => new Date('2026-10-24T12:00:00Z') });
    await queue.publish({ type, envelope: created.envelope, envelopeDigest: created.envelopeDigest });
    if (duplicate) await queue.publish({ type, envelope: created.envelope, envelopeDigest: created.envelopeDigest });
    assert.deepEqual(await processor.processOnce({ type, batchSize: 1 }), ['SUCCESS']);
    if (duplicate) assert.deepEqual(await processor.processOnce({ type, batchSize: 1 }), ['DUPLICATE']);
  }
  try {
    await publish('document.scan', { organizationId, versionId }, 'scan', true);
    await publish('document.reconcile', { organizationId, limit: 25 }, 'reconcile');
    const pending = await seedVersion(ports.repository, organizationId, ports.resourceId,
      Buffer.from('%PDF-1.7\nexpire\n%%EOF'), 'PENDING');
    await publish('document.expire_upload', { organizationId, record: { organizationId, versionId: pending.versionId,
      objectId: pending.objectId, state: 'PENDING', scanState: 'NOT_REQUESTED', lockVersion: 0,
      expiresAt: '2026-10-24T11:59:59Z' } }, 'expire');
    assert.equal((await ports.repository.findVersion({ organizationId, versionId: pending.versionId })).state, 'EXPIRED');
  } finally { await lifecycle.shutdown(); }
  return Object.freeze({ types: worker.registry.types, persistentInbox: true, duplicateSuppressed: true, fencing: true });
}

async function run() {
  const poolA = new Pool({ connectionString: target(DB_A).toString(), max: 8 });
  const poolB = new Pool({ connectionString: target(DB_B).toString(), max: 4 });
  let queueInfrastructure;
  try {
    queueInfrastructure = await queueDatabase();
    const orgA = (await poolA.query('SELECT tenant_id::text FROM c4g_system.tenant_identity')).rows[0].tenant_id;
    const orgB = (await poolB.query('SELECT tenant_id::text FROM c4g_system.tenant_identity')).rows[0].tenant_id;
    const appA = crypto.randomUUID(), appB = crypto.randomUUID(), missing = crypto.randomUUID();
    const userA = crypto.randomUUID(), deniedUser = crypto.randomUUID(), revokedUser = crypto.randomUUID();
    const memberA = crypto.randomUUID(), deniedMember = crypto.randomUUID(), revokedMember = crypto.randomUUID();
    const applications = new Map([[appA, { organizationId: orgA }], [appB, { organizationId: orgB }]]);
    const memberships = new Map([
      [memberA, { userId: userA, organizationId: orgA, status: 'ACTIVE', grants: new Set(Object.values(PERMISSIONS)) }],
      [deniedMember, { userId: deniedUser, organizationId: orgA, status: 'ACTIVE', grants: new Set(['document.upload.initiate']) }],
      [revokedMember, { userId: revokedUser, organizationId: orgA, status: 'REVOKED', grants: new Set(Object.values(PERMISSIONS)) }]
    ]);
    const accessPort = createExplicitAccessPolicy({ applications, memberships });
    const repositoryA = createDocumentRepository(poolA), repositoryB = createDocumentRepository(poolB);
    const storageA = createF11ObjectStorageDouble(), storageB = createF11ObjectStorageDouble();
    const scanner = createF11MalwareScanDouble({ result: 'CLEAN' });
    const enqueued = [], findings = [], auditEvents = [];
    const audit = { async accept(code) { auditEvents.push(code); return { status: 'ACCEPTED' }; },
      async emit(code) { auditEvents.push(code); return { status: 'ACCEPTED' }; } };
    const reconciliation = { async record(value) { findings.push(value); } };
    let now = new Date('2026-10-24T12:00:00Z');
    const transport = createApplicationDocumentTransport({ accessPort,
      repositoryFactory: organizationId => organizationId === orgA ? repositoryA : repositoryB,
      storageFactory: organizationId => organizationId === orgA ? storageA : storageB,
      auditFactory: () => audit, reconciliationFactory: () => reconciliation,
      jobs: { async enqueueScan(value) { enqueued.push(value); } }, clock: () => new Date(now), id: crypto.randomUUID });
    const requestA = { actor: { id: userA, organizationId: orgA, membershipId: memberA }, correlationId: crypto.randomUUID() };
    const deniedRequest = { actor: { id: deniedUser, organizationId: orgA, membershipId: deniedMember } };
    const revokedRequest = { actor: { id: revokedUser, organizationId: orgA, membershipId: revokedMember } };

    const lookupsBefore = accessPort.evidence.lookups;
    for (const [request, applicationId] of [[revokedRequest, appA], [deniedRequest, appB], [deniedRequest, missing]]) {
      await assert.rejects(() => transport.createIntent({ request, applicationId,
        input: transportInput(Buffer.from('%PDF-1.7\ndenied\n%%EOF')) }), error => error.code === 'DOCUMENT_NOT_AVAILABLE');
    }
    assert.equal(accessPort.evidence.lookups, lookupsBefore + 2);
    const asymmetricIntent = await transport.createIntent({ request: deniedRequest, applicationId: appA,
      input: transportInput(Buffer.from('%PDF-1.7\nasymmetric\n%%EOF')) });
    await assert.rejects(() => transport.upload({ request: deniedRequest, applicationId: appA,
      versionId: asymmetricIntent.versionId, token: asymmetricIntent.capability,
      source: Readable.from([Buffer.from('%PDF-1.7\nasymmetric\n%%EOF')]) }), error => error.code === 'DOCUMENT_NOT_AVAILABLE');

    const clean = Buffer.from('%PDF-1.7\nclean synthetic\n%%EOF');
    const intent = await transport.createIntent({ request: requestA, applicationId: appA, input: transportInput(clean) });
    const uploaded = await transport.upload({ request: requestA, applicationId: appA, versionId: intent.versionId,
      token: intent.capability, source: Readable.from([clean]) });
    assert.equal(uploaded.state, 'PENDING_SCAN');
    assert.equal(enqueued.length, 1);
    await assert.rejects(() => transport.upload({ request: requestA, applicationId: appA, versionId: intent.versionId,
      token: intent.capability, source: Readable.from([clean]) }), /UPLOAD_CAPABILITY_INVALID/);
    const confirmation = createConfirmationService({ repository: repositoryA, reconciliation, audit });
    assert.equal((await confirmation.confirm({ organizationId: orgA, versionId: intent.versionId,
      sha256: sha(clean), size: clean.length })).status, 'ALREADY_CONFIRMED');

    const expiredIntent = await transport.createIntent({ request: requestA, applicationId: appA,
      input: transportInput(clean) });
    now = new Date('2026-10-24T12:10:00Z');
    await assert.rejects(() => transport.upload({ request: requestA, applicationId: appA,
      versionId: expiredIntent.versionId, token: expiredIntent.capability, source: Readable.from([clean]) }), /UPLOAD_CAPABILITY_INVALID/);
    now = new Date('2026-10-24T12:00:00Z');
    const bad = Buffer.from(clean); bad[bad.length - 2] ^= 1;
    const badIntent = await transport.createIntent({ request: requestA, applicationId: appA, input: transportInput(clean) });
    const beforeBadQueue = enqueued.length;
    await assert.rejects(() => transport.upload({ request: requestA, applicationId: appA,
      versionId: badIntent.versionId, token: badIntent.capability, source: Readable.from([bad]) }), /CHECKSUM_OR_SIZE_MISMATCH/);
    assert.equal(enqueued.length, beforeBadQueue);
    assert.notEqual((await repositoryA.findVersion({ organizationId: orgA, versionId: badIntent.versionId })).state, 'AVAILABLE');

    const scanService = createScanService({ scanner, repository: repositoryA, storage: storageA, audit });
    const ports = { repository: repositoryA, storage: storageA, scanService, audit, reconciliation, resourceId: appA };
    const worker = createDocumentWorker({ portsForOrganization: organizationId => {
      assert.equal(organizationId, orgA); return ports;
    } });
    const queueEvidence = await queueProof({ tenantPool: poolA, queuePool: queueInfrastructure.pool,
      connectionString: queueInfrastructure.url.toString(), worker, ports,
      organizationId: orgA, versionId: intent.versionId });
    assert.equal((await repositoryA.findVersion({ organizationId: orgA, versionId: intent.versionId })).state, 'AVAILABLE');

    const eicar = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');
    const infected = await seedVersion(repositoryA, orgA, appA, Buffer.from(`%PDF-1.7\n${eicar}\n%%EOF`), 'SCANNING');
    await seedObject(storageA, infected.objectId, infected.bytes);
    scanner.setResult('INFECTED');
    await worker.handlers['document.scan']({ payload: { organizationId: orgA, versionId: infected.versionId }, fencingToken: 2 });
    assert.equal((await repositoryA.findVersion({ organizationId: orgA, versionId: infected.versionId })).state, 'QUARANTINED');
    const unavailable = await seedVersion(repositoryA, orgA, appA, Buffer.from('%PDF-1.7\nscanner down\n%%EOF'), 'SCANNING');
    await seedObject(storageA, unavailable.objectId, unavailable.bytes);
    scanner.setResult('UNAVAILABLE');
    await assert.rejects(() => worker.handlers['document.scan']({ payload: { organizationId: orgA,
      versionId: unavailable.versionId }, fencingToken: 3 }), error => error.code === 'SCANNER_UNAVAILABLE');
    assert.equal((await repositoryA.findVersion({ organizationId: orgA, versionId: unavailable.versionId })).state, 'SCANNING');
    scanner.setResult('CLEAN');

    const recoveryStates = [];
    for (const state of ['UPLOADING', 'UPLOADED', 'SCANNING']) {
      const item = await seedVersion(repositoryA, orgA, appA, Buffer.from(`%PDF-1.7\nrecover ${state}\n%%EOF`), state);
      await seedObject(storageA, item.objectId, item.bytes);
      if (state === 'UPLOADING') await poolA.query("UPDATE document_storage.document_version SET updated_at=clock_timestamp()-interval '10 minutes' WHERE version_id=$1", [item.versionId]);
      const restarted = createDocumentWorker({ portsForOrganization: () => ports });
      await restarted.handlers['document.reconcile']({ payload: { organizationId: orgA, limit: 25 }, fencingToken: 4 });
      recoveryStates.push((await repositoryA.findVersion({ organizationId: orgA, versionId: item.versionId })).state);
    }
    assert.deepEqual(recoveryStates, ['AVAILABLE', 'AVAILABLE', 'AVAILABLE']);

    const confirmFailureRepository = Object.freeze({ ...repositoryA,
      async confirm() { throw failure('SYNTHETIC_CONFIRMATION_INTERRUPTION'); } });
    const interruptedBeforeConfirmation = createApplicationDocumentTransport({ accessPort,
      repositoryFactory: () => confirmFailureRepository, storageFactory: () => storageA,
      auditFactory: () => audit, reconciliationFactory: () => reconciliation,
      jobs: { async enqueueScan() { throw failure('UNEXPECTED_ENQUEUE'); } },
      clock: () => new Date(now), id: crypto.randomUUID });
    const interruptedBytes = Buffer.from('%PDF-1.7\nconfirmation interruption\n%%EOF');
    const interruptedIntent = await interruptedBeforeConfirmation.createIntent({ request: requestA,
      applicationId: appA, input: transportInput(interruptedBytes) });
    await assert.rejects(() => interruptedBeforeConfirmation.upload({ request: requestA, applicationId: appA,
      versionId: interruptedIntent.versionId, token: interruptedIntent.capability,
      source: Readable.from([interruptedBytes]) }), /SYNTHETIC_CONFIRMATION_INTERRUPTION/);
    assert.equal((await repositoryA.findVersion({ organizationId: orgA,
      versionId: interruptedIntent.versionId })).state, 'UPLOADED');
    await createDocumentWorker({ portsForOrganization: () => ports }).handlers['document.reconcile']({
      payload: { organizationId: orgA, limit: 25 }, fencingToken: 5 });
    assert.equal((await repositoryA.findVersion({ organizationId: orgA,
      versionId: interruptedIntent.versionId })).state, 'AVAILABLE');

    const interruptedBeforeEnqueue = createApplicationDocumentTransport({ accessPort,
      repositoryFactory: () => repositoryA, storageFactory: () => storageA,
      auditFactory: () => audit, reconciliationFactory: () => reconciliation,
      jobs: { async enqueueScan() { throw failure('SYNTHETIC_ENQUEUE_INTERRUPTION'); } },
      clock: () => new Date(now), id: crypto.randomUUID });
    const enqueueBytes = Buffer.from('%PDF-1.7\nenqueue interruption\n%%EOF');
    const enqueueIntent = await interruptedBeforeEnqueue.createIntent({ request: requestA,
      applicationId: appA, input: transportInput(enqueueBytes) });
    await assert.rejects(() => interruptedBeforeEnqueue.upload({ request: requestA, applicationId: appA,
      versionId: enqueueIntent.versionId, token: enqueueIntent.capability,
      source: Readable.from([enqueueBytes]) }), /SYNTHETIC_ENQUEUE_INTERRUPTION/);
    assert.equal((await repositoryA.findVersion({ organizationId: orgA,
      versionId: enqueueIntent.versionId })).state, 'SCANNING');
    await createDocumentWorker({ portsForOrganization: () => ports }).handlers['document.reconcile']({
      payload: { organizationId: orgA, limit: 25 }, fencingToken: 6 });
    assert.equal((await repositoryA.findVersion({ organizationId: orgA,
      versionId: enqueueIntent.versionId })).state, 'AVAILABLE');

    const multipart = await seedVersion(repositoryA, orgA, appA, Buffer.from('%PDF-1.7\nmultipart interrupted\n%%EOF'), 'UPLOADING');
    const multipartHandle = await storageA.beginMultipart({ objectId: multipart.objectId,
      storageClass: 'QUARANTINE', conditionalCreate: true, expectedSize: multipart.bytes.length,
      expectedSha256: multipart.checksum, declaredMime: 'application/pdf' });
    await repositoryA.registerMultipart({ organizationId: orgA, versionId: multipart.versionId,
      objectId: multipart.objectId, providerUploadId: multipartHandle.multipartSessionId,
      expiresAt: new Date(Date.now() + 60000).toISOString() });
    await poolA.query("UPDATE document_storage.multipart_upload SET expires_at=clock_timestamp()-interval '1 minute' WHERE version_id=$1", [multipart.versionId]);
    const unrelatedObjectId = crypto.randomUUID();
    await seedObject(storageA, unrelatedObjectId, Buffer.from('%PDF-1.7\nunrelated\n%%EOF'));
    const multipartRecovery = await createDocumentWorker({ portsForOrganization: () => ports }).handlers['document.reconcile']({
      payload: { organizationId: orgA, limit: 25 }, fencingToken: 7 });
    assert.ok(multipartRecovery.aborted.includes(multipart.versionId));
    assert.equal((await poolA.query('SELECT state FROM document_storage.multipart_upload WHERE version_id=$1',
      [multipart.versionId])).rows[0].state, 'ABORTED');
    assert.ok(await storageA.head({ objectId: unrelatedObjectId }));

    const foreign = await seedVersion(repositoryA, orgB, appB, Buffer.from('%PDF-1.7\nforeign\n%%EOF'), 'UPLOADING');
    const rlsClient = await poolA.connect();
    try {
      await rlsClient.query('BEGIN');
      await rlsClient.query('SET LOCAL ROLE c4g_document_runtime');
      await rlsClient.query("SELECT set_config('app.organization_id',$1,true)", [orgA]);
      assert.equal((await rlsClient.query('SELECT count(*)::int n FROM document_storage.document_version WHERE organization_id=$1', [orgB])).rows[0].n, 0);
      async function denied(name, action, predicate) {
        await rlsClient.query(`SAVEPOINT ${name}`);
        await assert.rejects(action, predicate);
        await rlsClient.query(`ROLLBACK TO SAVEPOINT ${name}`);
      }
      await denied('foreign_function', () => rlsClient.query('SELECT document_storage.register_multipart_upload($1,$2,$3,$4,$5)',
        [orgB, foreign.versionId, foreign.objectId, crypto.randomUUID(), new Date(Date.now() + 60000)]), /DOCUMENT_TENANT_CONTEXT_INVALID/);
      await denied('foreign_part', () => rlsClient.query('INSERT INTO document_storage.multipart_part(version_id,part_number,size_bytes,sha256) VALUES($1,1,1,$2)',
        [foreign.versionId, '0'.repeat(64)]), error => error.code === '42501');
      await denied('destructive', () => rlsClient.query('DELETE FROM document_storage.multipart_upload'), error => error.code === '42501');
      await rlsClient.query('ROLLBACK');
    } finally { await rlsClient.query('ROLLBACK').catch(() => {}); rlsClient.release(); }

    const missingConfig = inspectDocumentInfrastructure({});
    assert.equal(missingConfig.ready, false);
    const configured = inspectDocumentInfrastructure({ C4G_R2_ENDPOINT: 'https://synthetic.eu.r2.cloudflarestorage.com',
      C4G_R2_DOCUMENTS_BUCKET: 'synthetic-documents', C4G_R2_QUARANTINE_BUCKET: 'synthetic-quarantine',
      C4G_R2_ACCESS_KEY_ID: 'synthetic-present', C4G_R2_SECRET_ACCESS_KEY: 'synthetic-present',
      C4G_CLAMAV_HOST: '127.0.0.1', C4G_CLAMAV_PORT: '53310' });
    assert.equal(configured.ready, false); assert.equal(configured.networkProbed, false);
    const bootstrap = validateProductionDocumentsBootstrap({ r2: null, migrationReady: true,
      scannerReady: false, reconciliationLagSeconds: 0, runtime: {} });
    assert.equal(bootstrap.ready, false); assert.ok(bootstrap.reasons.includes('SCANNER_NOT_CONFIGURED'));

    process.stdout.write(`${JSON.stringify({ result: 'PASS', postgres: true, objectStorage: 'LOCAL_DOUBLE',
      scanner: 'LOCAL_DOUBLE', authorization: { explicitGrants: true, revokedDenied: true,
        asymmetricDenied: true, authorizationBeforeLookup: true, foreignAndMissingUniform: true },
      upload: { oneShot: true, expiry: true, checksumFailClosed: true, confirmationIdempotent: true },
      queue: queueEvidence, recoveryStates, rls: true, multipartForeignDenied: true,
      interruptions: { confirmationRecovered: true, enqueueRecovered: true, multipartProviderIdRecovered: true,
        unrelatedObjectPreserved: true },
      scannerEvidence: { clean: true, eicarStandardFileWithDouble: true, unavailableFailClosed: true, ooxml: 'UNIT_ONLY' },
      readiness: { configurationIsNotHealth: true, scannerRequired: true }, findings: findings.length,
      auditEvents: auditEvents.length })}\n`);
    await Promise.all([storageA.shutdown(), storageB.shutdown()]);
  } finally { await Promise.all([poolA.end(), poolB.end(), queueInfrastructure?.pool.end()]); }
}

run().catch(error => {
  process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null,
    message: error.message, stack: error.stack?.split('\n').slice(0, 5) })}\n`);
  process.exitCode = 1;
});
