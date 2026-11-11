const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatRetentionInfrastructure, loadChatRetentionConfiguration, ROLE, OTHER_WORKER_ROLES } = require('../src/config/chatRetentionInfrastructure');
const { main } = require('../src/chatRetention');
const { CHAT_RETENTION_SCHEMA_VERSION } = require('../src/security/tenantMigrationManifest');

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const credential = (organizationId = ORG, extra = {}) => ({ workload: 'WORKER', organizationId, tenantId: '33333333-3333-4333-8333-333333333333', connectionVersion: 1,
  credentialRef: `ref-${organizationId}`, databaseGenerationId: '44444444-4444-4444-8444-444444444444', host: 'db.invalid', port: 5432, database: 'tenant', login: 'retention_login',
  password: 'synthetic', ssl: true, ...extra });
const env = (overrides = {}) => ({ NODE_ENV: 'test', AUTHORITY_DATABASE_URL: 'postgresql://authority.invalid/central', AUTHORITY_COMMIT_PERMIT_SECRET: 'synthetic-authority-permit-at-least-32-characters',
  CHAT_RETENTION_CREDENTIALS_JSON: JSON.stringify([credential()]), ...overrides });

test('configuração: valores por omissão, limites e recusas', () => {
  const config = loadChatRetentionConfiguration(env());
  assert.deepEqual([config.retentionDays, config.batchSize, config.maxBatches], [90, 50, 200]);
  assert.equal(loadChatRetentionConfiguration(env({ CHAT_RETENTION_DAYS: '180' })).retentionDays, 180);
  const invalid = overrides => assert.throws(() => loadChatRetentionConfiguration(env(overrides)), { code: 'CHAT_RETENTION_CONFIGURATION_INVALID' });
  invalid({ CHAT_RETENTION_DAYS: '89' });
  invalid({ CHAT_RETENTION_BATCH_SIZE: '501' });
  invalid({ CHAT_RETENTION_MAX_BATCHES: '0' });
  invalid({ AUTHORITY_DATABASE_URL: '' });
  invalid({ AUTHORITY_COMMIT_PERMIT_SECRET: 'curta' });
  invalid({ CHAT_RETENTION_CREDENTIALS_JSON: 'não é json' });
  invalid({ CHAT_RETENTION_CREDENTIALS_JSON: '[]' });
  invalid({ CHAT_RETENTION_CREDENTIALS_JSON: JSON.stringify([credential(ORG, { workload: 'API' })]) });
  invalid({ CHAT_RETENTION_CREDENTIALS_JSON: JSON.stringify([credential(), credential()]) });
  invalid({ NODE_ENV: 'production' });
});

function fakes({ snapshot = null, login = {}, observed = null, chainError = null } = {}) {
  const state = { pools: [], queries: [], ended: 0, chain: null, observed: null };
  class FakePool {
    constructor(options) { this.options = options; state.pools.push(this); }
    async connect() {
      return { async query(sql) {
        state.queries.push(String(sql).split('\n')[0].trim().slice(0, 40));
        if (/FROM pg_roles r WHERE r.rolname = session_user/.test(sql)) return { rows: [{ session_user: 'retention_login', current_user: 'retention_login', rolcanlogin: true, rolinherit: false, rolsuper: false,
          rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, ...login }] };
        return { rows: [] };
      }, release() {} };
    }
    async end() { state.ended += 1; }
  }
  const good = credential();
  return { state, deps: {
    Pool: FakePool,
    createDirectory: ({ organizations }) => { state.organizations = organizations; return { async resolveSnapshotByOrganization(organizationId, workload) {
      state.resolved = [organizationId, workload];
      return snapshot === null ? { tenantId: good.tenantId, connectionVersion: good.connectionVersion, credentialRef: good.credentialRef, databaseGenerationId: good.databaseGenerationId, bindingDigest: 'digest' } : snapshot;
    } }; },
    bindingDigest: () => 'digest',
    validateRoleChain: async (_client, input) => { state.chain = input; if (chainError) throw chainError; },
    observeMetadata: async (_client, input) => { state.observed = input; return observed || { currentVersion: CHAT_RETENTION_SCHEMA_VERSION, capabilities: ['APPLICATION_CHAT_RETENTION'] }; }
  } };
}

test('abrir uma organização verifica binding, login limitado, cadeia de papéis e esquema 040', async () => {
  const { state, deps } = fakes();
  const infrastructure = await createChatRetentionInfrastructure({ env: env(), deps });
  assert.deepEqual(await infrastructure.listTenants(), [{ organizationId: ORG }]);
  const handle = await infrastructure.openTenant({ organizationId: ORG });
  assert.deepEqual(state.resolved, [ORG, 'WORKER']);
  assert.deepEqual(state.chain, { login: 'retention_login', workload: 'WORKER', functionalRoles: [ROLE], optionalFunctionalRoles: [...OTHER_WORKER_ROLES] });
  assert.deepEqual(state.observed, { tenantId: credential().tenantId, databaseGenerationId: credential().databaseGenerationId });
  assert.ok(state.queries.includes('BEGIN TRANSACTION READ ONLY') && state.queries.includes('COMMIT'));
  assert.equal(typeof handle.pool.connect, 'function');
  await handle.close();
  await infrastructure.close();
  assert.equal(state.ended, 2);
});

test('binding diferente, organização desconhecida ou esquema antigo recusam e não deixam pools abertos', async () => {
  const mismatch = fakes({ snapshot: { tenantId: 'x', connectionVersion: 1, credentialRef: 'y', databaseGenerationId: 'z', bindingDigest: 'digest' } });
  const a = await createChatRetentionInfrastructure({ env: env(), deps: mismatch.deps });
  await assert.rejects(a.openTenant({ organizationId: ORG }), { code: 'CHAT_RETENTION_TENANT_BINDING_REQUIRED' });
  assert.equal(mismatch.state.pools.length, 1); // authority pool only: no tenant pool was created

  const unknown = fakes();
  const b = await createChatRetentionInfrastructure({ env: env(), deps: unknown.deps });
  await assert.rejects(b.openTenant({ organizationId: OTHER }), { code: 'CHAT_RETENTION_TENANT_UNKNOWN' });

  const old = fakes({ observed: { currentVersion: '039_document_deletion', capabilities: [] } });
  const c = await createChatRetentionInfrastructure({ env: env(), deps: old.deps });
  await assert.rejects(c.openTenant({ organizationId: ORG }), { code: 'CHAT_RETENTION_SCHEMA_INCOMPATIBLE' });
  assert.equal(old.state.ended, 1);
  assert.ok(old.state.queries.includes('ROLLBACK'));
});

test('login com herança, superutilizador ou cadeia de papéis inválida é recusado', async () => {
  for (const login of [{ rolinherit: true }, { rolsuper: true }, { rolbypassrls: true }, { current_user: 'outro' }, { rolcanlogin: false }]) {
    const { state, deps } = fakes({ login });
    const infrastructure = await createChatRetentionInfrastructure({ env: env(), deps });
    await assert.rejects(infrastructure.openTenant({ organizationId: ORG }), { code: 'CHAT_RETENTION_LIMITED_LOGIN_REQUIRED' });
    assert.equal(state.ended, 1);
  }
  const { deps } = fakes({ chainError: Object.assign(new Error('LOCAL_IDENTITY_ROLE_CHAIN_INVALID'), { code: undefined }) });
  const infrastructure = await createChatRetentionInfrastructure({ env: env(), deps });
  await assert.rejects(infrastructure.openTenant({ organizationId: ORG }), /ROLE_CHAIN_INVALID/);
});

test('entrypoint: código de saída 0 quando tudo corre e 1 com falhas, e fecha sempre a infraestrutura', async () => {
  const run = async (summary) => {
    let closed = 0;
    const logs = [];
    const infrastructure = { retentionDays: 90, batchSize: 50, maxBatches: 200, close: async () => { closed += 1; },
      listTenants: async () => summary.tenants, openTenant: async () => { if (summary.fail) throw Object.assign(new Error('x'), { code: 'BOOM' }); return { pool: { async connect() { return { async query() { return { rows: [] }; }, release() {} }; } }, close: async () => {} }; } };
    const code = await main({ env: {}, log: entry => logs.push(entry), infrastructureFactory: async () => infrastructure });
    return { code, closed, logs };
  };
  assert.deepEqual((({ code, closed }) => ({ code, closed }))(await run({ tenants: [{ organizationId: ORG }] })), { code: 0, closed: 1 });
  const failed = await run({ tenants: [{ organizationId: ORG }], fail: true });
  assert.deepEqual([failed.code, failed.closed], [1, 1]);
  assert.ok(failed.logs.some(entry => entry.event === 'CHAT_RETENTION_TENANT_FAILED' && entry.code === 'BOOM'));
  assert.ok(failed.logs.every(entry => !JSON.stringify(entry).includes('synthetic')));
});
