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
        authorization_version: 1, base_role_code: p.profileCode || 'VIEWER', policy_version: policyVersion,
        assurance_requirements: recentMfaRequirement,
        grants: ['APPLICATION_READ', 'OPPORTUNITY_READ', ...(p.directory ? prechecks : [])].filter(code => code !== p.deniedOperation).map(code => ({
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
    if (sql.includes('AS month_rows')) {
      await hooks.calendar?.(values);
      return { rows: [{ month_rows: [], agenda_rows: [], application_rows: [] }] };
    }
    return { rows: [] };
  } };
  function repository(ports) {
    const report = async () => {
      repositoryCalls++;
      assert.equal([...active].some(tx => tx.protocol.some(read => read.args.includes(ports.organizationId))), false,
        'this organization report starts after its preliminary groups have ended');
      const target = require('../src/applications/repository').resource(ports.organizationId, ports.organizationId);
      await ports.protect({ operationCode: 'APPLICATION_READ', resource: target });
      const directory = await ports.reportDirectory(client);
      return { organizationId: ports.organizationId, unitsAvailable: Boolean(directory),
        ...(ports.organizationName === undefined ? {} : { organizationName: ports.organizationName }) };
    };
    const browse = () => phases.run('repository', async () => {
      const target = require('../src/applications/repository').resource(ports.organizationId, ports.organizationId);
      return ports.authorize('APPLICATION_READ', target);
    });
    return { report, reportExport: report, browse, browsePage: browse, partnersBrowse: browse };
  }
  const filename = path.resolve(__dirname, '../src/applications/composition.js'), native = Module.createRequire(filename);
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
    './responsibleAuthority': { createResponsibleAuthority: () => ({}) },
    './teamAccess': { createTeamAccessPolicy: () => input => {
      policies.push({ phase: phases.getStore(), active: active.size }); return input.snapshot;
    } },
    './readAuthority': { createReadAuthority: options => options.includeWork ? require('../src/applications/readAuthority').createReadAuthority(options) : ({}) },
    './browseAuthority': { createTransitionCapability: () => () => false },
    './repository': { ...require('../src/applications/repository'), createApplicationRepository: repository },
    './alerts':{...require('../src/applications/alerts'),createAlertsRepository:ports=>Object.fromEntries(['alertsList','alertsRefresh','alertsRefreshList'].map(method=>[method,()=>phases.run('repository',async()=>{const target=require('../src/applications/repository').resource(ports.organizationId,ports.organizationId);await ports.authorize('APPLICATION_READ',target);return ports.authorize('APPLICATION_READ',target)})]))},
    './partners': { ...require('../src/applications/partners'), createPartnersRepository: repository }
    ,'./opportunitySummary':{async opportunitySummary(_client,input){await hooks.summary?.();return {organizationId:input.organizationId,total:5};}}
  };
  const instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => replacements[name] || native(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  const composition = instance.exports.createApplicationComposition({ authorityCoordinator: coordinator,
    authorizationCatalogs: catalogs, assurancePolicyVersion: policyVersion, recentMfaRequirement, clock: dateClock,
    tenantRuntimeDependencies: {}, tokenKeys: { test: 'synthetic-report-key-only-not-production' }, tokenKeyId: 'test' });
  const run = (method, p, headers = {}, organizationContext) => composition.execute(method, method === 'calendar' ? { month: '2026-11' }
    : method === 'dashboard' ? {today:'2026-11-06',asOf:'2026-11-06T12:00:00.000Z'}
      : method === 'reportExport' ? { digest: 'a'.repeat(64) } : {}, null, { principal: p, headers, organizationContext });
  return { run, principal, transactions, events, policies, protections, active, hooks, clock, repositoryCalls: () => repositoryCalls };
}
const reads = (f, phase = 'prechecks') => f.transactions.filter(tx => tx.phase === phase && tx.protocol.length);
const domain = transactions => transactions.flatMap(tx => tx.protocol);

test('the entity calendar checks the live admin profile and organization before reading events', async t => {
 const f = fixture(t), p = f.principal();
 let eventReads = 0;
 f.hooks.calendar = ([organizationId]) => { assert.equal(organizationId, p.organizationId); eventReads++; };
 p.profileCode = 'FUNDING_MANAGER';
 await assert.rejects(f.run('calendar', p), { code: 'NOT_AUTHORIZED' });
 p.profileCode = 'ORG_ADMIN';
 await assert.rejects(f.run('calendar', p, { 'x-c4g-organization': randomUUID() }), { code: 'RESOURCE_NOT_AVAILABLE' });
 assert.equal(eventReads, 0);
 assert.deepEqual((await f.run('calendar', p)).agenda, []);
 assert.equal(eventReads, 1);
 p.profileCode = 'VIEWER';
 await assert.rejects(f.run('calendar', p), { code: 'NOT_AUTHORIZED' });
 assert.equal(eventReads, 1);
});

test('combined dashboard protects application, opportunity and included directory data in the same guarded read',async t=>{
 const f=fixture(t),p=f.principal();
 const result=await f.run('dashboard',p);
 assert.equal(result.report.organizationId,p.organizationId);assert.equal(result.privateSummary.total,5);
 assert.deepEqual(f.protections.at(-1).map(x=>x.operationCode),[...prechecks,'OPPORTUNITY_READ']);
 for(const denied of ['APPLICATION_READ','OPPORTUNITY_READ']){
  p.deniedOperation=denied;await assert.rejects(f.run('dashboard',p));
 }
 p.deniedOperation=null;p.directory=false;
 assert.equal((await f.run('dashboard',p)).report.unitsAvailable,false);
 assert.deepEqual(f.protections.at(-1).map(x=>x.operationCode),['OPPORTUNITY_READ']);
})

test('real report composition groups the two preliminary decisions from four transactions to two with unchanged reads and audit', async t => {
  const f = fixture(t), p = f.principal();
  // reportExport deliberately retains the pre-change read boundary.
  const baseline = await f.run('reportExport', p), original = reads(f), originalEvents = f.events.filter(row => row.phase === 'prechecks');
  const txStart = f.transactions.length, eventStart = f.events.length;
  const result = await f.run('report', p);
  const actual = f.transactions.slice(txStart).filter(tx => tx.phase === 'prechecks' && tx.protocol.length);
  assert.deepEqual(result, baseline); assert.equal(result.unitsAvailable, true);
  assert.equal(original.length, 4); assert.equal(actual.length, 2);
  assert.deepEqual(domain(actual), domain(original));
  assert.deepEqual(actual.map(tx => tx.protocol.map(row => row.kind)), [['membership', 'policy'], ['membership', 'policy']]);
  assert.deepEqual(f.events.slice(eventStart).filter(row => row.phase === 'prechecks'), originalEvents);
  assert.ok(f.policies.filter(row => row.phase === 'prechecks').every(row => row.active === 0));
  assert.ok(f.events.filter(row => row.phase === 'prechecks').every(row => row.active === 0));
  assert.deepEqual(f.protections.map(checks => checks.map(check => check.operationCode)), [prechecks, prechecks]);
  const prepared = f.transactions.slice(txStart).filter(tx => tx.phase === 'prepare');
  assert.equal(prepared.length, 1, 'grouping reuses the existing protected preparation transaction');
  assert.equal(prepared[0].statements.filter(sql => sql === 'BEGIN').length, 1);
  assert.equal(prepared[0].statements.filter(sql => sql === 'COMMIT').length, 1);
});

for (const [method, expected] of [['partnersBrowse', 1], ['browse', 2], ['browsePage', 1]]) test(`real ${method} retains its existing authority read boundary`, async t => {
  const f = fixture(t), p = f.principal();
  assert.equal(await f.run(method, p), true);
  assert.equal(reads(f, 'repository').length, expected);
  assert.deepEqual(domain(reads(f, 'repository')).map(row => row.kind), ['membership', 'policy']);
});

test('report export uses the active organization name even without directory permission', async t => {
  const f = fixture(t), p = f.principal();
  p.directory = false;
  const organization = { id: p.organizationId, displayName: 'Centro de Investigação' };
  const own = await f.run('reportExport', p, {}, { organization });
  assert.equal(own.organizationName, organization.displayName);
  assert.equal(own.unitsAvailable, false);
  const other = await f.run('reportExport', p, {}, { organization: { id: randomUUID(), displayName: 'Outra entidade' } });
  assert.equal(other.organizationName, undefined);
});

test('report keeps optional directory denial and freshly observes permission and membership revocation', async t => {
  const f = fixture(t), p = f.principal();
  assert.equal((await f.run('report', p)).unitsAvailable, true);
  p.directory = false;
  assert.equal((await f.run('report', p)).unitsAvailable, false);
  assert.deepEqual(f.protections.at(-1), []);
  assert.deepEqual(f.events.filter(row => row.phase === 'prechecks').map(row => row.event.result), ['ALLOW', 'ALLOW', 'DENY', 'DENY']);
  assert.equal(reads(f).length, 4, 'each new preliminary decision observes fresh central data');
  p.status = 'SUSPENDED';
  await assert.rejects(f.run('report', p), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.repositoryCalls(), 2, 'revocation stops before the report');
  assert.deepEqual(reads(f).at(-1).protocol.map(row => row.kind), ['membership']);
  assert.equal(f.active.size, 0);
});

for (const deniedOperation of prechecks) test(`report keeps directory unavailable when only ${deniedOperation} is denied`, async t => {
  const f = fixture(t), p = f.principal(); p.deniedOperation = deniedOperation;
  assert.equal((await f.run('report', p)).unitsAvailable, false);
  assert.deepEqual(f.protections.at(-1), []);
  assert.equal(reads(f).length, 2);
  assert.deepEqual(f.events.filter(row => row.phase === 'prechecks').map(row => [row.event.operationCode, row.event.result]),
    prechecks.map(operation => [operation, operation === deniedOperation ? 'DENY' : 'ALLOW']));
});

for(const method of ['report','dashboard'])for (const fault of ['membership', 'policy', 'commit', 'deadline', 'audit']) test(`${method} ${fault} failure cannot produce a partial report`, async t => {
  const f = fixture(t, { timeoutMs: fault === 'deadline' ? 40 : 10000 }), p = f.principal();
  if (fault === 'commit') f.hooks.commit = tx => { if (tx.phase === 'prechecks') throw Error('SYNTHETIC_COMMIT'); };
  else if (fault === 'audit') f.hooks.audit = () => { throw Object.assign(Error('SYNTHETIC_AUDIT'), { code: 'AUDIT_UNAVAILABLE' }); };
  else f.hooks.protocol = ({ tx, observation }) => {
    if (tx.phase !== 'prechecks') return;
    if (fault === 'deadline') f.clock.advance(25);
    else if (observation.kind === fault) throw Error('SYNTHETIC_STORAGE');
  };
  await assert.rejects(f.run(method, p), error => ['SERVICE_UNAVAILABLE', 'AUDIT_UNAVAILABLE'].includes(error.code));
  assert.equal(f.repositoryCalls(), 0); assert.equal(f.protections.length, 0); assert.equal(f.active.size, 0);
  assert.ok(f.events.every(row => row.active === 0));
  if (fault !== 'audit') assert.ok(f.events.every(row => row.event.result === 'DENY'));
  if (fault === 'deadline') assert.equal(reads(f).length, 1, 'the membership and policy reads share one deadline');
});

test('a private summary failure cannot publish the already collected application report',async t=>{
 const f=fixture(t),p=f.principal();f.hooks.summary=()=>{throw Error('SYNTHETIC_PRIVATE_FAILURE')};
 await assert.rejects(f.run('dashboard',p));assert.equal(f.repositoryCalls(),1);assert.equal(f.protections.length,1);
})

test('concurrent report compositions isolate organization policy and fresh transactions', async t => {
  const f = fixture(t), a = f.principal(), b = f.principal(); b.directory = false;
  const results = await Promise.all([a, b].map(p => f.run('report', p)));
  assert.deepEqual(results, [{ organizationId: a.organizationId, unitsAvailable: true }, { organizationId: b.organizationId, unitsAvailable: false }]);
  assert.equal(reads(f).length, 4);
  for (const tx of reads(f)) {
    assert.deepEqual(tx.protocol.map(row => row.kind), ['membership', 'policy']);
    assert.deepEqual(tx.protocol[0].args, [...tx.protocol[1].args].reverse());
  }
  for (const p of [a, b]) assert.deepEqual(f.events.filter(row => row.phase === 'prechecks' && row.event.organizationId === p.organizationId)
    .map(row => row.event.result), p.directory ? ['ALLOW', 'ALLOW'] : ['DENY', 'DENY']);
  assert.equal(f.active.size, 0);
});

for(const method of ['alertsList','alertsRefresh','alertsRefreshList'])test(`${method} loads a protected snapshot but observes fresh revocation on the next operation`,async t=>{
 const f=fixture(t),p=f.principal();assert.equal(await f.run(method,p),true);
 assert.equal(f.policies.filter(r=>r.phase==='repository').length,2);assert.equal(f.events.filter(r=>r.phase==='repository').length,2);
 const first=reads(f,'repository');assert.equal(first.length,1);assert.deepEqual(domain(first).map(r=>r.kind),['membership','policy']);
 assert(f.policies.filter(r=>r.phase==='repository').every(r=>r.active===0));
 assert(f.events.filter(r=>r.phase==='repository').every(r=>r.active===0));
 p.deniedOperation='APPLICATION_READ';assert.equal(await f.run(method,p),false);
 assert.equal(reads(f,'repository').length,2);
})
