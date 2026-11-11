const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLocalTenantRoleChain, TOLERATED_WORKER_ROLES } = require('../src/security/localTenantIdentityProvisioner');

const AGGREGATOR = 'c4g_tenant_worker_capabilities';
const LOGIN = 'c4g_chat_retention_login';
const RETENTION = 'c4g_chat_retention_runtime';
const attributes = name => ({ rolname: name, rolcanlogin: name === LOGIN, rolinherit: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false });
const edge = (granted, member, overrides = {}) => ({ granted, member, set_option: true, inherit_option: false, admin_option: false, ...overrides });

// Fake catalog: `roles` exist with safe attributes; `edges` are the memberships reachable from the login.
function client({ roles, edges, elevated = false }) {
  return {
    async query(sql, params) {
      if (/FROM pg_roles WHERE rolname=ANY/.test(sql)) return { rows: roles.filter(name => params[0].includes(name)).map(attributes), rowCount: roles.filter(name => params[0].includes(name)).length };
      if (/AS elevated/.test(sql)) return { rows: [{ elevated }] };
      if (/WITH RECURSIVE reachable/.test(sql)) return { rows: edges };
      throw new Error(`unexpected query: ${sql.slice(0, 40)}`);
    }
  };
}
const chain = (...functional) => [edge(AGGREGATOR, LOGIN), ...functional.map(role => edge(role, AGGREGATOR))];

test('o papel de retenção é tolerado em qualquer login WORKER mas nunca é exigido', async () => {
  assert.deepEqual([...TOLERATED_WORKER_ROLES], [RETENTION]);
  const worker = { login: LOGIN, workload: 'WORKER', functionalRoles: ['c4g_import_worker_runtime'] };
  const base = ['c4g_import_worker_runtime', AGGREGATOR, LOGIN];
  // Without the retention role: unchanged behaviour.
  await validateLocalTenantRoleChain(client({ roles: base, edges: chain('c4g_import_worker_runtime') }), worker);
  // With the retention role granted to the aggregator: still valid.
  await validateLocalTenantRoleChain(client({ roles: [...base, RETENTION], edges: chain('c4g_import_worker_runtime', RETENTION) }), worker);
});

test('o executor de retenção exige o seu papel e só tolera os papéis conhecidos dos outros workers', async () => {
  const executor = { login: LOGIN, workload: 'WORKER', functionalRoles: [RETENTION], optionalFunctionalRoles: ['c4g_import_worker_runtime'] };
  const roles = [RETENTION, 'c4g_import_worker_runtime', AGGREGATOR, LOGIN];
  await validateLocalTenantRoleChain(client({ roles, edges: chain(RETENTION) }), executor);
  await validateLocalTenantRoleChain(client({ roles, edges: chain(RETENTION, 'c4g_import_worker_runtime') }), executor);
  await assert.rejects(validateLocalTenantRoleChain(client({ roles, edges: chain('c4g_import_worker_runtime') }), executor), /ROLE_CHAIN_INVALID/);
});

test('papéis desconhecidos, privilégios de herança e atributos perigosos continuam recusados', async () => {
  const worker = { login: LOGIN, workload: 'WORKER', functionalRoles: ['c4g_import_worker_runtime'] };
  const roles = ['c4g_import_worker_runtime', AGGREGATOR, LOGIN, RETENTION, 'c4g_tenant_owner'];
  await assert.rejects(validateLocalTenantRoleChain(client({ roles, edges: chain('c4g_import_worker_runtime', 'c4g_tenant_owner') }), worker), /ROLE_CHAIN_INVALID/);
  await assert.rejects(validateLocalTenantRoleChain(client({ roles, edges: [...chain('c4g_import_worker_runtime'), edge(RETENTION, AGGREGATOR, { inherit_option: true })] }), worker), /ROLE_CHAIN_INVALID/);
  await assert.rejects(validateLocalTenantRoleChain(client({ roles, edges: [...chain('c4g_import_worker_runtime'), edge(RETENTION, AGGREGATOR, { admin_option: true })] }), worker), /ROLE_CHAIN_INVALID/);
  await assert.rejects(validateLocalTenantRoleChain(client({ roles, edges: chain('c4g_import_worker_runtime'), elevated: true }), worker), /ROLE_CHAIN_INVALID/);
});

test('o papel de retenção não é tolerado em logins API', async () => {
  const api = { login: LOGIN, workload: 'API', functionalRoles: ['c4g_opportunity_tenant_runtime'] };
  const API_AGGREGATOR = 'c4g_tenant_api_capabilities';
  const roles = ['c4g_opportunity_tenant_runtime', API_AGGREGATOR, LOGIN, RETENTION];
  const edges = [edge(API_AGGREGATOR, LOGIN), edge('c4g_opportunity_tenant_runtime', API_AGGREGATOR), edge(RETENTION, API_AGGREGATOR)];
  await assert.rejects(validateLocalTenantRoleChain(client({ roles, edges }), api), /ROLE_CHAIN_INVALID/);
});

test('parâmetros inválidos são recusados', async () => {
  const c = client({ roles: [], edges: [] });
  await assert.rejects(validateLocalTenantRoleChain(c, { login: LOGIN, workload: 'WORKER', functionalRoles: [RETENTION], optionalFunctionalRoles: 'x' }), TypeError);
  await assert.rejects(validateLocalTenantRoleChain(c, { login: LOGIN, workload: 'WORKER', functionalRoles: [RETENTION], optionalFunctionalRoles: ['Bad Role;'] }), TypeError);
});
