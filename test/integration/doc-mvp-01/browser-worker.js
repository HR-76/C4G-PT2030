'use strict';

// Synthetic infrastructure only. The child loads the production F9 runtime;
// this module never consumes a queue or calls a document handler.
const crypto = require('node:crypto');
const path = require('node:path');
const { createManagedChild } = require('./multiprocess-child');
const { createLocalTenantIdentityProvisioner, configureLocalTenantDatabaseConnect } = require('../../../backend/src/security/localTenantIdentityProvisioner');
const { bindingDigest } = require('../../../backend/src/security/localTenantCredentialAdapter');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { QUEUES } = require('../../../backend/src/config/documentWorkerInfrastructure');
const { createDocumentJobRegistry, SERVICE_ACTORS } = require('../../../backend/src/documents/jobs');
const { createEnvelopeV2, createTrustedObservability, validateEnvelope } = require('../../../backend/src/async/envelope');
const { OutboxRepository } = require('../../../backend/src/async/outboxRepository');
const { transaction } = require('../../../backend/src/documents/postgresWorkerPorts');

async function prepareBrowserWorker({ tenant, central, identity, organizationId, storageRoot, port, scannerPort, events, budgetConfiguration, remoteStorageEnv = {} }) {
  const database = (await tenant.query('SELECT current_database() AS name')).rows[0].name;
  const suffix = crypto.randomBytes(4).toString('hex');
  const workerLogin = `c4g_browser_worker_${suffix}`, apiLogin = `c4g_browser_api_${suffix}`;
  const password = crypto.randomBytes(24).toString('base64url');
  const provisioner = await createLocalTenantIdentityProvisioner(tenant);
  await provisioner.reconcile({ apiLogin, workerLogin, apiPassword: crypto.randomBytes(24).toString('base64url'), workerPassword: password,
    apiRoles: ['c4g_document_runtime'], workerRoles: ['c4g_document_worker_runtime', 'c4g_document_runtime'] });
  await configureLocalTenantDatabaseConnect(tenant, { database, authorizedLogins: [apiLogin, workerLogin], knownLogins: [apiLogin, workerLogin], migratorRoles: ['postgres', 'c4g_tenant_migrator'] });
  const credentialRef = `synthetic.browser.worker.${identity.tenantId}`;
  const credential = { organizationId, tenantId: identity.tenantId, workload: 'WORKER', connectionVersion: 1, credentialRef,
    databaseGenerationId: identity.databaseGenerationId, host: '127.0.0.1', port, database, login: workerLogin, password, ssl: false };
  const digest = bindingDigest(credential), entry = manifest.at(-1);
  const systemIdentifier = (await tenant.query('SELECT system_identifier::text AS value FROM pg_control_system()')).rows[0].value;
  const capabilities = JSON.stringify(Object.fromEntries([...entry.capabilities.map(code => [code, true]), ['schemaFingerprint', entry.schemaFingerprint]]));
  const intent = crypto.createHash('sha256').update(JSON.stringify({ tenantId: identity.tenantId, workload: 'WORKER', credentialRef, bindingDigest: digest })).digest('hex');
  const c = await central.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("INSERT INTO public.tenant(tenant_id,organization_id,deployment_mode) VALUES($1,$2,'DATABASE_PER_ORGANIZATION')", [identity.tenantId, organizationId]);
    await c.query("INSERT INTO public.organization_provisioning(organization_id,tenant_assignment_state,tenant_id,status,current_step_code,idempotency_key,manifest_version,revision) VALUES($1,'ASSIGNED',$2,'READY','COMPLETE',$3,$4,5)", [organizationId, identity.tenantId, `browser-${identity.tenantId}`, entry.version]);
    await c.query('INSERT INTO public.tenant_database_generation(database_generation_id,tenant_id,database_ref) VALUES($1,$2,$3)', [identity.databaseGenerationId, identity.tenantId, database]);
    await c.query("INSERT INTO public.organization_connection_version(tenant_id,connection_version,deployment_mode,database_generation_id,database_ref,credential_ref,region_code,residency_policy_version,observed_system_identifier,binding_digest,version_state,validated_at) VALUES($1,1,'DATABASE_PER_ORGANIZATION',$2,$3,$4,'EU','1',$5,$6,'VALIDATED',NOW())", [identity.tenantId, identity.databaseGenerationId, database, credentialRef, systemIdentifier, digest]);
    await c.query("INSERT INTO public.organization_connection(tenant_id,current_connection_version,operational_state,last_transition_code,revision) VALUES($1,1,'AVAILABLE','PUBLISH_VERSION',2)", [identity.tenantId]);
    await c.query("INSERT INTO public.tenant_schema_state(tenant_id,compatibility_state,current_version,target_version,minimum_read_version,minimum_write_version,verified_capabilities,checked_at,revision) VALUES($1,'COMPATIBLE',$2,$2,$2,$2,$3::jsonb,NOW(),2)", [identity.tenantId, entry.version, capabilities]);
    await c.query("INSERT INTO public.tenant_workload_binding(tenant_id,workload,current_connection_version,credential_ref,lifecycle_status,compatibility_status,provisioning_status,fence,binding_digest,revision,published_at) VALUES($1,'WORKER',1,$2,'AVAILABLE','COMPATIBLE','READY',1,$3,2,NOW())", [identity.tenantId, credentialRef, digest]);
    await c.query("INSERT INTO public.tenant_workload_connection_version(tenant_id,workload,connection_version,credential_ref,lifecycle_status,compatibility_status,provisioning_status,fence,binding_digest,intent_digest,revision,validated_at,published_at) VALUES($1,'WORKER',1,$2,'AVAILABLE','COMPATIBLE','READY',1,$3,$4,3,NOW(),NOW())", [identity.tenantId, credentialRef, digest, intent]);
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
  const { PgBoss } = await import('../../../backend/node_modules/pg-boss/dist/index.js');
  const boss = new PgBoss({ connectionString: central.connectionString, schema: 'pgboss', createSchema: true, migrate: true, supervise: false, schedule: false });
  await boss.start({ supervise: false, schedule: false });
  for (const name of Object.values(QUEUES)) if (!(await boss.getQueue(name))) await boss.createQueue(name);
  const outbox = new OutboxRepository();
  // Registry is used solely for envelope validation; no handler can execute here.
  const registry = createDocumentJobRegistry(Object.fromEntries(Object.keys(QUEUES).map(type => [type, async () => { throw new Error('GATE_MUST_NOT_EXECUTE_HANDLER'); }])));
  const jobs = Object.freeze({ async enqueueScan(payload) {
    if (payload.organizationId !== organizationId) throw new Error('WORKER_ORGANIZATION_MISMATCH');
    const actor = SERVICE_ACTORS['document.scan'];
    const value = createEnvelopeV2({ trustedContext: { organizationId, actor: { kind: 'SERVICE', serviceActorCode: actor.code },
      operation: actor.operation, correlationId: crypto.randomUUID(), causationId: crypto.randomUUID() },
      job: { type: 'document.scan', version: 1, payloadVersion: 1, idempotencyKey: `scan:${payload.versionId}`, deadlineMs: 300000 },
      payload, registry, observability: createTrustedObservability({ traceparent: null, tracestate: null }) }).envelope;
    const validated = validateEnvelope(value, registry);
    await transaction(tenant, 'c4g_document_worker_runtime', organizationId, client => outbox.enqueueLineage(client, {
      organizationId, logicalId: `scan:${payload.versionId}`, envelope: value,
      lineage: { deliveryKind: 'INITIAL', attempt: 1, rootExecutionId: value.executionId, previousExecutionId: null,
        contentDigest: validated.contentDigest, envelopeDigest: validated.envelopeDigest, replayRequestId: null } }));
    events.push({ kind: 'WORKER_OUTBOX_ENQUEUED', executionId: value.executionId, versionId: payload.versionId, operation: actor.operation });
  } });
  let child = null, generation = 0;
  return { jobs, async start() {
    generation += 1;
    child = createManagedChild({ label: `browser-worker-${generation}`, file: path.resolve(__dirname, '../../../backend/test/fixtures/documentWorkerEntrypointChild.js'),
      controlPath: path.join(storageRoot, `stop-${generation}`), env: { ...process.env, ...remoteStorageEnv, NODE_ENV: 'test', DOCUMENT_WORKER_RUNTIME: 'f11-documents',
        CENTRAL_DATABASE_URL: central.connectionString, DOCUMENT_WORKER_CREDENTIALS_JSON: JSON.stringify([credential]),
        DOCUMENT_WORKER_STORAGE_MODE: 'test-provider', DOCUMENT_WORKER_TEST_ADAPTERS: 'enabled',
        DOCUMENT_WORKER_TEST_PROVIDER: path.resolve(__dirname, 'shared-budget-storage.js'),
        DOCUMENT_PROOF_REMOTE_STORAGE: remoteStorageEnv.DOCUMENT_PROOF_REMOTE_STORAGE || '',
        DOCUMENT_PROOF_BUDGET_PORT: String(budgetConfiguration.port), DOCUMENT_PROOF_BUDGET_TOKEN: budgetConfiguration.token,
        DOCUMENT_WORKER_TEST_STORAGE_ROOT: storageRoot, DOCUMENT_WORKER_TEST_CONTROL_PATH: path.join(storageRoot, `stop-${generation}`),
        DOCUMENT_WORKER_POLL_INTERVAL_MS: '200', DOCUMENT_WORKER_GRACE_MS: '30000', DOCUMENT_WORKER_BATCH_SIZE: '1',
        C4G_CLAMAV_HOST: '127.0.0.1', C4G_CLAMAV_PORT: String(scannerPort) } });
    const ready = await child.ready; events.push({ kind: 'WORKER_PROCESS_READY', generation, ...ready });
  }, async stop() { if (!child) return; const result = await child.stop(); events.push({ kind: 'WORKER_PROCESS_STOPPED', generation, ...result }); child = null; },
  async close() { if (child) { await child.stop(); child = null; } await boss.stop({ graceful: true, timeout: 5000 }); } };
}

module.exports = { prepareBrowserWorker };
