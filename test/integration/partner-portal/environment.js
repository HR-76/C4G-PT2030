'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID, randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { classifySetupError } = require('./setupErrorDiagnostic');
const { createTimingHub, observePool, observeRuntime, observeAuthorizationFactory } = require('./temporalDiagnostic');
const root = path.resolve(__dirname, '../../..');
const prepared = new WeakSet();

// Shape check only. The caller must first verify ownership of its disposable
// container by immutable container ID and run label. No environment fallback.
function validateTarget(adminUrl, runId) {
  assert.match(runId || '', /^[a-f0-9]{32}$/, 'PARTNER_GATE_RUN_REQUIRED');
  const url = new URL(adminUrl);
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/postgres'); assert.equal(url.search, ''); assert.equal(url.hash, '');
  assert(Number(url.port) >= 1024 && Number(url.port) <= 65535 && !['5432', '5433'].includes(url.port));
  assert.match(url.username, /^[a-z][a-z0-9_]{0,62}$/); assert(url.password);
  assert.notEqual(url.username, 'c4g_f12_admin', 'fixture installer cannot own its own bootstrap session');
  return url;
}

function privateModule(filename, replacements) {
  const local = Module.createRequire(filename), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = specifier => Object.hasOwn(replacements, specifier) ? replacements[specifier] : local(specifier);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return instance.exports;
}

// Compile the exact active composition privately, observing dependency ports.
// No source substitution, global loader hook, cache replacement or runtime edit.
function loadApplicationComposition(variant, hooks = {}, timing = null) {
  assert(['baseline', 'candidate'].includes(variant), 'PARTNER_GATE_VARIANT_INVALID');
  const partners = require('../../../backend/src/applications/partners');
  const candidate = require('../../../backend/prototypes/partnerSqlPortal');
  const replacement = { ...partners,
    createPartnersRepository(options) {
      const ports = { ...options,
        protect: (...args) => timing ? timing.measure('PROTECT', () => options.protect(...args)) : options.protect(...args),
        async authorize(operation, resource) {
        const work = () => options.authorize(operation, resource);
        const allowed = await (timing ? timing.authorization(work) : work());
        await hooks.onAuthorize?.({ operation, resource, allowed });
        return allowed;
      } };
      const repository = { ...partners.createPartnersRepository(ports), ...(variant === 'candidate' ? candidate.createPartnersPortalRepository(ports) : {}) };
      return timing ? { ...repository, partnersBrowse(...args) { return timing.measure('READER', () => repository.partnersBrowse(...args)); } } : repository;
    } };
  const replacements = { './partners': replacement };
  if (timing) {
    const authorization = require('../../../backend/src/authorization/resourceAuthorization');
    const runtime = require('../../../backend/src/security/tenantRuntime');
    const executor = require('../../../backend/src/security/tenantLeaseExecutor');
    replacements['../authorization/resourceAuthorization'] = { ...authorization,
      createTaxonomyAuthorization: options => observeAuthorizationFactory(authorization.createTaxonomyAuthorization, options, timing) };
    replacements['../security/tenantRuntime'] = { ...runtime,
      createTenantRuntime: (...args) => observeRuntime(runtime.createTenantRuntime(...args), timing) };
    replacements['../security/tenantLeaseExecutor'] = { ...executor, preparedAuthorityBinding(...args) {
      const binding = executor.preparedAuthorityBinding(...args);
      // In the exact composition's partner authorize port this call occurs on
      // cache hits immediately before the unchanged coordinator.assert.
      timing.cacheGuard(); return binding;
    } };
  }
  return privateModule(path.join(root, 'backend/src/applications/composition.js'), replacements);
}

// Executable setup, invoked only by the explicitly authorized owned-container
// runner. Applies unchanged manifests inside that disposable cluster, provisions
// real limited LOGINs, real Central authority and real tenant runtime metadata.
function setupDiagnostic(onUpdate) {
  let state = { phase: 'TARGET_VALIDATION', tenant: null, status: 'RUNNING',
    classification: null, errorCode: null, localCleanup: 'NOT_STARTED' };
  function publish(change) {
    state = Object.freeze({ ...state, ...change });
    // An observer must never replace the setup error or prevent local cleanup.
    try { onUpdate?.(state); } catch { /* The runner still fails on its primary error. */ }
  }
  return {
    enter(phase, tenant = null) { publish({ phase, tenant, substep: null, substepStatus: null, substepFailure: null }); },
    ensureSubstep(value) {
      if (state.phase === 'TENANT_ENSURE') publish({ substep: value.substep, substepStatus: value.substepStatus, substepFailure: value.substepFailure });
    },
    cleanup(localCleanup) { publish({ localCleanup }); },
    ready() { publish({ phase: 'READY', tenant: null, status: 'READY' }); },
    fail(error) {
      publish({ status: 'FAILED', ...classifySetupError(error) });
    }
  };
}

async function createEnvironment(options = {}) {
  const diagnostic = setupDiagnostic(options.onSetupDiagnostic);
  diagnostic.enter('TARGET_VALIDATION');
  try { return await prepareEnvironment(options, diagnostic); }
  catch (error) { diagnostic.fail(error); throw error; }
}

async function prepareEnvironment({ adminUrl, runId, observeQuery }, diagnostic) {
  const url = validateTarget(adminUrl, runId);
  diagnostic.enter('ADMIN_POOL');
  const { Pool } = require('../../../backend/node_modules/pg');
  const admin = new Pool({ connectionString: url.toString(), max: 2 });
  const tenants = [], hooks = { beforeQuery: null, afterQuery: null };
  const timing = createTimingHub(), unobserve = [];
  let central, runtime, closed = false, env;
  const resources = [];
  async function close() {
    if (closed) return; closed = true; if (env) prepared.delete(env);
    const failures = [];
    for (const work of [() => runtime?.poolManager.closeAll(), ...resources.reverse().map(pool => () => pool.end()),
      () => central?.close({ retain: true }), () => admin.end()]) {
      try { await work(); } catch (error) { failures.push(error); }
    }
    for (const detach of unobserve) detach();
    if (failures.length) throw new AggregateError(failures, 'PARTNER_GATE_CONNECTION_CLEANUP_FAILED');
  }
  try {
    diagnostic.enter('CENTRAL_FIXTURE');
    central = await require('../f13/central-authority-fixture').centralAuthorityFixture(url.toString(), { validateHistoricalRoundTrip: false });
    diagnostic.enter('TENANT_ROLES');
    for (const role of ['c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime']) {
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
    }
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query(`GRANT c4g_tenant_migrator TO "${url.username}"`);
    // The provisioner opens its pool before ALTER DATABASE sets the default;
    // existing sessions need the required TimeZone from connection startup.
    const connection = { host: url.hostname, port: Number(url.port), user: url.username,
      password: decodeURIComponent(url.password), options: '-c timezone=UTC' };
    const reservations = new Map();
    diagnostic.enter('PROVISIONER');
    const provisioner = require('./provisioningDiagnostic').createObservedProvisioner({
      adminPool: admin, centralPool: central.pool, connection, ownershipKey: randomBytes(32).toString('hex'),
      journal: { async reserve(id, _input, create) { if (!reservations.has(id)) reservations.set(id, create()); return reservations.get(id); } },
      regionCode: 'EU', residencyPolicyVersion: 'partner-portal-isolated-v1' }, value => diagnostic.ensureSubstep(value));
    async function actor(tenant, { profileCode = 'ORG_ADMIN' } = {}) {
      const user = await central.user(tenant.organizationId, randomUUID(), randomUUID(), null, null, { profileCode });
      const grants = (profileCode === 'CONTRIBUTOR' ? ['application.read', 'opportunity.read']
        : ['application.read', 'application.edit', 'opportunity.read']).map(permission => ({ permission,
        scope: { type: 'ORGANIZATION', id: tenant.organizationId, organizationId: tenant.organizationId } }));
      await central.data.change({ organizationId: tenant.organizationId, membershipId: user.membershipId, expectedVersion: 1,
        grants, assuranceRequirements: central.requirement });
      return { ...user, organizationId: tenant.organizationId, grants, authorityVersion: 2,
        request: { ...user.request, headers: {} } };
    }
    for (let index = 0; index < 2; index++) {
      const tenant = { organizationId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` };
      const label = index === 0 ? 'A' : 'B';
      diagnostic.enter('TENANT_ACTOR', label);
      tenant.owner = await actor(tenant);
      const input = { operationId: randomUUID(), organizationId: tenant.organizationId, globalUserId: tenant.owner.id,
        membershipId: tenant.owner.membershipId, input: { adminName: 'Synthetic partner gate', adminEmail: `partner-gate-${index}@example.invalid` } };
      diagnostic.enter('TENANT_ENSURE', label);
      await provisioner.ensure(input);
      diagnostic.enter('TENANT_PROJECT', label);
      await provisioner.project(input);
      diagnostic.enter('TENANT_CREDENTIALS', label);
      tenant.credentials = await provisioner.apiCredentials(input);
      diagnostic.enter('TENANT_POOLS', label);
      tenant.generationId = reservations.get(input.operationId).generationId;
      tenant.pool = new Pool({ ...connection, database: tenant.credentials.database, max: 4 }); resources.push(tenant.pool);
      tenant.runtimePool = new Pool({ ...connection, database: tenant.credentials.database, user: tenant.credentials.login,
        password: tenant.credentials.password, max: 2 }); resources.push(tenant.runtimePool);
      diagnostic.enter('TENANT_PREFLIGHT', label);
      tenant.evidence = await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant.pool,
        { tenantId: tenant.organizationId, databaseGenerationId: tenant.generationId }, undefined, { timeoutMs: 15000 });
      diagnostic.enter('TENANT_OPPORTUNITY', label);
      const repository = new (require('../../../backend/src/opportunities/tenantRepository').TenantOpportunityRepository)({
        pool: tenant.pool, organizationId: tenant.organizationId, identityFactory: require('../../../backend/src/opportunities/identity').createIdentityFactory() });
      tenant.opportunityId = (await repository.create({ schemaVersion: 1, requestId: randomUUID(), snapshot: {
        schemaVersion: 1, title: `Partner gate ${index}`, funderName: 'Synthetic', provenanceId: randomUUID(),
        lifecycleState: 'ACTIVE', validationState: 'PENDING_REVIEW', normalizationVersion: 'opportunity-normalization-v1',
        qualityRuleVersion: 'opportunity-quality-v1', summary: 'Synthetic partner gate', fundingAmountMin: '0', fundingAmountMax: '100',
        currencyCode: 'EUR', closingDate: '2027-12-31' }, provenance: { schemaVersion: 1, sourceType: 'ORGANIZATION_MANUAL',
        sourceNamespace: 'PARTNER_PORTAL_GATE', observedAt: new Date().toISOString() } }, { actor: { type: 'HUMAN', reference: tenant.owner.id } })).opportunityId;
      tenants.push(tenant);
    }
    // Use the unchanged configured runtime with an observed Pool constructor in
    // this private module only. Hooks pause real SQL; they do not replace results.
    class ObservedPool extends Pool {
      async connect() {
        const client = await super.connect(), tenant = tenants.find(item => item.credentials.database === this.options.database);
        return { on: (...args) => client.on(...args), removeListener: (...args) => client.removeListener(...args),
          release: error => { const result = client.release(error); hooks.onRelease?.({ stage: 'physical-release-requested', discarded: Boolean(error) }); return result; }, async query(sql, values) {
            const context = { tenant, client, sql, values };
            await hooks.beforeQuery?.(context);
            try {
              const result = await timing.measure('SQL_TENANT', () => client.query(sql, values));
              await hooks.afterQuery?.({ ...context, result });
              observeQuery?.({ tenant: tenant === tenants[0] ? 'A' : 'B', phase: typeof sql === 'string' ? sql.split(/\s/, 1)[0] : 'QUERY', rows: result.rowCount });
              return result;
            } catch (error) { await hooks.onQueryError?.({ ...context, errorCode: error.code || 'UNAVAILABLE' }); throw error; }
          } };
      }
    }
    diagnostic.enter('RUNTIME_CONFIGURATION');
    for (const pool of [central.pool, central.authorityPool]) unobserve.push(observePool(pool, timing));
    const configuration = privateModule(path.join(root, 'backend/src/config/opportunityRuntime.js'), { pg: { Pool: ObservedPool } });
    runtime = configuration.createConfiguredOpportunityRuntime({ centralPool: central.pool, authorityCoordinator: central.coordinator,
      env: { OPPORTUNITY_API_CREDENTIALS_JSON: JSON.stringify(tenants.map(tenant => tenant.credentials)),
        OPPORTUNITY_ALLOWED_RESIDENCY_JSON: JSON.stringify([{ regionCode: 'EU', policyVersion: 'partner-portal-isolated-v1' }]) } });
    diagnostic.enter('RUNTIME_OBSERVATION');
    const manager = runtime.poolManager;
    runtime.poolManager = Object.freeze({ ...manager, async acquire(input) {
      const started = performance.now();
      try { const allocation = await manager.acquire(input); hooks.onAcquire?.({ ms: performance.now() - started }); return allocation; }
      catch (error) { hooks.onAcquire?.({ ms: performance.now() - started, error: error.code || 'UNAVAILABLE' }); throw error; }
    } });
    const keys = { gate: randomBytes(32).toString('hex') };
    function composition(variant = 'candidate') {
      return loadApplicationComposition(variant, hooks, timing).createApplicationComposition({ sessionStore: central.store,
        sessionRegistry: central.registry, authorityCoordinator: central.coordinator, centralPool: central.pool,
        authorizationCatalogs: central.catalogs, assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: central.requirement,
        tenantRuntimeDependencies: runtime, tokenKeys: keys, tokenKeyId: 'gate' });
    }
    env = { central, tenants, runtime, actor, composition, hooks, timing, runId, close };
    prepared.add(env); diagnostic.ready(); return env;
  } catch (error) {
    diagnostic.fail(error);
    diagnostic.cleanup('RUNNING');
    try { await close(); diagnostic.cleanup('COMPLETED'); }
    catch { diagnostic.cleanup('FAILED'); }
    throw error;
  }
}

module.exports = { createEnvironment, validateTarget, loadApplicationComposition, isPreparedEnvironment: value => prepared.has(value) };
