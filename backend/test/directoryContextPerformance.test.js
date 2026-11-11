'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const { createAuthorityCoordinator, hash } = require('../src/security/authorityCoordinator');
const { createAuthorityDataRepository } = require('../src/authorization/authorityDataRepository');
const { createTaxonomyAuthorization } = require('../src/authorization/resourceAuthorization');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { createManualClock } = require('./support/tenantRuntimeDoubles');
const protocol = require('../src/security/authorityProtocolQueries');

const byCode = new Map(protocol.queries.map(sql => [hash(sql), sql]));
const policyVersion = 'report-authority-read-group-test-v1';
const recentMfaRequirement = { maxAgeSeconds: 300, mfa: true, acceptedAcr: ['c4g-loa2'], acceptedAmr: ['otp'], amrMode: 'all' };
const prechecks = ['ORGANIZATION_DIRECTORY_READ', 'ORGANIZATIONAL_SCOPE_READ'];

// The production composition, authorizer, F5 repository, closed SQL protocol
// and coordinator are real. Storage/admission and the tenant runtime/guard
// are controlled here; this is not PostgreSQL or end-to-end authority evidence.
function fixture(t, { timeoutMs = 10000 } = {}) {
  const clock = createManualClock(), dateClock = { now: () => new Date(clock.now()) };
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' });
  const phases = new AsyncLocalStorage(), principals = [], transactions = [], events = [], policies = [], protections = [];
  const active = new Set(), hooks = { protocol: null, commit: null, audit: null };
  let repositoryCalls = 0, authorization;
  const security = require('../src/security/authoritySecurityManifest');
  t.mock.method(security, 'assertAuthorityAdmission', async () => ({ currentVersion: 'synthetic-admitted' }));
  t.mock.method(security, 'assertAuthoritySecurity', async () => {});
  function principal() {
    const p = { organizationId: randomUUID(), membershipId: randomUUID(), userId: randomUUID(), status: 'ACTIVE', directory: true };
    principals.push(p); return p;
  }
  function trusted(p) {
    return { actor: { type: 'HUMAN', id: p.userId, organizationId: p.organizationId, membershipId: p.membershipId,
      membershipVersion: 1, authorizationVersion: 1 }, correlationId: p.membershipId,
      assuranceEvidence: { policyVersion, authTime: clock.now() / 1000, acr: 'c4g-loa2', amr: ['otp'] } };
  }
  function rows(sql, values) {
    const membership = sql.startsWith('SELECT m.id,m.organization_id,m.global_user_id');
    assert.ok(membership || sql.startsWith('SELECT f.organization_id,f.membership_id'), 'only membership and F5 reads');
    const p = principals.find(value => value.organizationId === values[membership ? 1 : 0]
      && value.membershipId === values[membership ? 0 : 1]);
    const kind = membership ? 'membership' : 'policy';
    if (!p) return { kind, rows: [] };
    return { kind, rows: [membership ? { id: p.membershipId, organization_id: p.organizationId,
      global_user_id: p.userId, membership_version: 1, status: p.status, valid_until: null }
      : { organization_id: p.organizationId, membership_id: p.membershipId, membership_version: 1,
        authorization_version: 1, base_role_code: 'VIEWER', policy_version: policyVersion,
        assurance_requirements: recentMfaRequirement,
        grants: ['ORGANIZATION_DIRECTORY_READ','ORGANIZATION_DIRECTORY_EDIT','ORGANIZATIONAL_SCOPE_READ','ORGANIZATIONAL_SCOPE_CREATE','ORGANIZATIONAL_SCOPE_RENAME','ORGANIZATIONAL_SCOPE_REPARENT'].filter(code => code !== p.deniedOperation).map(code => ({
          permission: catalogs.operationCatalog.resolve(code).permission,
          scope: { type: 'ORGANIZATION', id: p.organizationId, organizationId: p.organizationId }
        })) }] };
  }
  const pool = { query() { throw Error('Raw pool forbidden'); }, async connect() {
    const tx = { phase: phases.getStore(), statements: [], protocol: [], released: [] };
    transactions.push(tx);
    return { release(error) { tx.released.push(error); }, async query(sql, values = []) {
      tx.statements.push(sql);
      if (sql === 'BEGIN') active.add(tx);
      if (sql === 'COMMIT') { await hooks.commit?.(tx); active.delete(tx); }
      if (sql === 'ROLLBACK') active.delete(tx);
      if (sql === 'SELECT authority_api.execute($1,$2::text[],$3) AS result') {
        const original = byCode.get(values[0]); assert.ok(original, 'closed protocol query');
        const result = rows(original, values[1]), observation = { kind: result.kind, code: values[0], args: values[1] };
        tx.protocol.push(observation); await hooks.protocol?.({ tx, observation });
        return { rows: [{ result: { rows: result.rows, rowCount: result.rows.length } }] };
      }
      return { rows: sql.includes('c4g_database_identity') ? [{ valid: true }] : [] };
    } };
  } };
  const realCoordinator = createAuthorityCoordinator({ pool, clock: dateClock, timeoutMs,
    permitSecret: 'synthetic-report-read-group-not-production' });
  const data = createAuthorityDataRepository({ coordinator: realCoordinator, catalogs, policyVersion, recentMfaRequirement });
  const coordinator = { withAuthority: realCoordinator.withAuthority, assert() {}, registerRecovery() {},
    bindAuthority() { return { protect: (client, input) => phases.run('prepare', () => realCoordinator.withAuthority(async () => {
      protections.push(input.additionalAuthorizations || []);
      const checks = [{ operationCode: input.operationCode, resource: input.resource }, ...(input.additionalAuthorizations || [])];
      for (const check of checks) {
        const decision = await authorization.authorize(check.operationCode, trusted(input.handle), check.resource);
        if (!decision.allowed) throw Object.assign(Error('Guard refused'), { code: 'SERVICE_UNAVAILABLE' });
      }
      return { token: {} };
    })) }; }
  };
  const client = { async query(sql, values = []) {
    if (sql.startsWith('WITH population')) return { rows: [{ scope_id: values[0], label: 'Unit', people: 1 }] };
    return { rows: [] };
  } };
  function repository(ports) {
    return {async context(){
      const resource=require('../src/organizationDirectory/repository').resource;
      await ports.protect({operationCode:'ORGANIZATION_DIRECTORY_READ',resource:resource(ports.organizationId)});
      const permissions={};
      for(const [key,code,type] of [['edit','ORGANIZATION_DIRECTORY_EDIT','ORGANIZATION'],['units','ORGANIZATIONAL_SCOPE_READ','ORGANIZATIONAL_SCOPE'],['createUnit','ORGANIZATIONAL_SCOPE_CREATE','ORGANIZATION'],['renameUnit','ORGANIZATIONAL_SCOPE_RENAME','ORGANIZATIONAL_SCOPE'],['moveUnit','ORGANIZATIONAL_SCOPE_REPARENT','ORGANIZATIONAL_SCOPE']]){
        permissions[key]=await phases.run('permissions',()=>ports.authorize(code,resource(ports.organizationId,ports.organizationId,type)));
      }
      return {organization:{id:ports.organizationId},permissions};
    }};
  }
  const filename = path.resolve(__dirname, '../src/organizationDirectory/composition.js'), native = Module.createRequire(filename);
  const replacements = {
    '../authorization/authorityDataRepository': { createAuthorityDataRepository: () => data },
    '../security/authenticatedAuthority': { createTaxonomySessionAuthority: () => ({
      captureAuthenticatedRequest: async request => request.principal, resolve: async handle => trusted(handle)
    }) },
    '../authorization/resourceAuthorization': { createTaxonomyAuthorization(options) { const instance=createTaxonomyAuthorization(options);if(options.membershipPort===data.membershipPort)authorization=instance;return instance; } },
    '../security/tenantRuntime': { createTenantRuntime: () => ({ async resolve({ operationAdapter }) {
      return { execute: input => phases.run('prechecks', () => operationAdapter.queryModule.execute({ client, input })) };
    } }) },
    '../security/tenantOperationCatalog': { createAuthorizedTenantOperationCatalog: value => value },
    '../security/tenantLeaseExecutor': {
      preparedAuthorityBinding: () => ({ transactionId: 'synthetic', tenantId: 'synthetic' }),
      isPreparedTenantTransaction: () => false
    },
    '../security/tenantAuthorityRecovery': { createTenantAuthorityRecovery: () => ({}) },
    '../organizationalProfile/editorialUiAudit': { createEditorialUiAudit: () => ({ async accept(event) {
      events.push({ event, phase: phases.getStore(), active: active.size });
      await hooks.audit?.(event); return 'ACCEPTED';
    } }) },
    './repository': { ...require('../src/organizationDirectory/repository'), createDirectoryRepository: repository }
  };
  const instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => replacements[name] || native(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  const composition = instance.exports.createDirectoryComposition({ authorityCoordinator: coordinator,
    authorizationCatalogs: catalogs, assurancePolicyVersion: policyVersion, recentMfaRequirement, clock: dateClock,
    tenantRuntimeDependencies: {}, tokenKeys: { test: 'synthetic-report-key-only-not-production' }, tokenKeyId: 'test' });
  const run = (method, p) => composition.execute(method, {}, null, { principal: p, headers: {'x-c4g-organization':p.organizationId} });
  return { run, principal, transactions, events, policies, protections, active, hooks, clock, repositoryCalls: () => repositoryCalls };
}
const reads = (f, phase = 'prechecks') => f.transactions.filter(tx => tx.phase === phase && tx.protocol.length);
const domain = transactions => transactions.flatMap(tx => tx.protocol);


test('directory context evaluates and audits all five capabilities with one protected snapshot',async t=>{
 const f=fixture(t),p=f.principal();const result=await f.run('context',p);
 assert(Object.values(result.permissions).every(Boolean));
 assert.equal(reads(f,'permissions').length,1);
 assert.deepEqual(domain(reads(f,'permissions')).map(r=>r.kind),['membership','policy']);
 assert.equal(f.events.filter(r=>r.phase==='permissions').length,5);
 p.deniedOperation='ORGANIZATIONAL_SCOPE_REPARENT';
 const next=await f.run('context',p);assert.equal(next.permissions.moveUnit,false);assert.equal(next.permissions.edit,true);
 assert.equal(reads(f,'permissions').length,2);
});
for(const fault of ['membership','policy','commit','audit'])test(`directory capability ${fault} failure prevents publication`,async t=>{
 const f=fixture(t),p=f.principal();
 if(fault==='audit')f.hooks.audit=()=>{throw Error('unavailable')};
 else if(fault==='commit')f.hooks.commit=tx=>{if(tx.phase==='permissions')throw Error('unavailable')};
 else f.hooks.protocol=({tx,observation})=>{if(tx.phase==='permissions'&&observation.kind===fault)throw Error('unavailable')};
 await assert.rejects(f.run('context',p));
});
