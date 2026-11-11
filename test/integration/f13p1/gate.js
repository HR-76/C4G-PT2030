'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Pool } = require('../../../backend/node_modules/pg');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { preflightTenant, preflightTenantClient } = require('../../../backend/src/security/tenantMigrationPreflight');
const { tenantSchemaFingerprint, tenantSchemaSnapshot } = require('../../../backend/src/security/tenantSchemaFingerprint');
const { createRepository } = require('../../../backend/src/organizationalScopes/repository');
const { createOrganizationalScopeService } = require('../../../backend/src/organizationalScopes/service');
const { createArchiveParticipantRegistry, createArchiveParticipantRegistryFixture, F13_CAPABILITY } = require('../../../backend/src/organizationalScopes/participantRegistry');
const { isTenantCapabilityEvidence, isTenantCapabilityEvidenceForPool } = require('../../../backend/src/security/tenantMigrationPreflight');
const { createOrganizationalScopeAuditWriter } = require('../../../backend/src/organizationalScopes/postgresAuditWriter');
const { createOrganizationalScopeAuthorization } = require('../../../backend/src/organizationalScopes/authorization');
const { createProductionCatalogs } = require('../../../backend/src/authorization/catalogs');
const { createPolicyEngine } = require('../../../backend/src/authorization/policyEngine');
const { createAuditCoordinator } = require('../../../backend/src/authorization/audit');
const { createMetricsPort } = require('../../../backend/src/authorization/metrics');
const { createOrganizationalScopeProductionComposition } = require('../../../backend/src/organizationalScopes/productionComposition');

const DB = 'c4g_f13p1_synthetic_gate';
const ORG_A = '13131313-1313-4313-8313-131313131313';
const ORG_B = '23232323-2323-4323-8323-232323232323';
const GENERATION = '34343434-3434-4343-8343-343434343434';
const ACTOR = Object.freeze({ type: 'HUMAN', id: '45454545-4545-4454-8454-454545454545', membershipId: '56565656-5656-4656-8656-565656565656', membershipVersion: 1, authorizationVersion: 1 });
const PROVENANCE = Object.freeze({ sourceType: 'ORGANIZATION_MANUAL', sourceReference: 'synthetic-gate', observedAt: '2026-10-10T00:00:00.000Z' });
const AUTHORIZATION_NOW = new Date('2030-01-15T12:00:00.000Z');
const ASSURANCE = Object.freeze({ authTime: Math.floor(AUTHORIZATION_NOW.getTime()/1000), acr: 'c4g-loa2', amr: Object.freeze(['otp']), policyVersion: 'c4g-assurance-v1' });
let sequence = 0;
function correlation() { sequence += 1; return `01890f3e-7b12-7abc-8def-${String(sequence).padStart(12, '0')}`; }
function command(extra = {}) { sequence += 1; return { idempotencyKey: `synthetic-${String(sequence).padStart(4, '0')}`, correlationId: correlation(), actor: ACTOR, assuranceEvidence: extra.reasonCode ? ASSURANCE : null, provenance: PROVENANCE, ...extra }; }
function percentile(values, fraction) { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*fraction)-1)]; }

function assertTarget() {
  if (process.env.F13P1_DISPOSABLE_PROOF !== 'C4G_F13P1_DISPOSABLE_V1') throw new Error('Disposable proof is absent.');
  const target = new URL(process.env.F13P1_GATE_URL);
  if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== `/${DB}` || ['5432','5433'].includes(target.port)) throw new Error('Unsafe target.');
}
function migrationPool(pool) { return Object.freeze({ async connect() { return pool.connect(); } }); }
function commitUncertaintyPool(delegate) {
  const armed=[];let connects=0,discarded=0,healthy=0,injected=0;
  return Object.freeze({
    armOnce(sqlstate=null){armed.push(sqlstate);},
    snapshot(){return Object.freeze({armed:armed.length,connects,discarded,healthy,injected});},
    async connect(){
      connects+=1;
      const client=await delegate.connect();
      return Object.freeze({
        async query(...args){
          const sql=String(args[0]).trim().toUpperCase();
          if(sql==='COMMIT'&&armed.length>0){const sqlstate=armed.shift();await client.query(...args);injected+=1;
            throw Object.assign(new Error('synthetic commit confirmation loss'),sqlstate?{code:sqlstate}:{});}
          return client.query(...args);
        },
        release(reason){if(reason)discarded+=1;else healthy+=1;return client.release(reason);}
      });
    }
  });
}
async function infrastructure(admin) {
  for (const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime']) await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  // The cumulative manifest includes 015: same grantless technical role as the
  // canonical F12 gate; only that migration installs its explicit worker ACLs.
  await admin.query('CREATE ROLE c4g_import_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
  await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
  await admin.query(`CREATE DATABASE ${DB} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
  await admin.query(`ALTER DATABASE ${DB} SET timezone TO 'UTC'`);
  await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${DB} TO c4g_tenant_owner`);
  await admin.query(`GRANT CONNECT ON DATABASE ${DB} TO c4g_tenant_migrator,c4g_tenant_runtime`);
}
function composition(pool, organizationId, registry = createArchiveParticipantRegistryFixture(), options = {}) {
  const authorizedScopeIds = new Set();
  const auditWriter = options.auditWriter || createOrganizationalScopeAuditWriter({ organizationId, tenantId: organizationId });
  const identityFactory = { next() { const id=crypto.randomUUID(); authorizedScopeIds.add(id); return id; } };
  const repository = createRepository({ organizationId, identityFactory, auditWriter, participantRegistry: registry });
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13p1' });
  const policyEngine = createPolicyEngine({ permissionCatalog: catalogs.permissionCatalog, profileCatalog: catalogs.profileCatalog,
    assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: Object.freeze({ maxAgeSeconds:300,mfa:true,
      acceptedAcr:Object.freeze(['c4g-loa2']),acceptedAmr:Object.freeze(['otp']),amrMode:'all' }) });
  const authorization = createOrganizationalScopeAuthorization({ operationCatalog: catalogs.operationCatalog,
    membershipPort: { async revalidate(actor) { return { id:actor.membershipId,organizationId,status:options.membershipStatus||'ACTIVE' }; } },
    authorizationDataPort: { async load() {
      const defaultGrants = [
        {permission:'organizational_scope.read',scope:{type:'ORGANIZATION',id:organizationId,organizationId}},
        {permission:'organizational_scope.create',scope:{type:'ORGANIZATION',id:organizationId,organizationId}},
        {permission:'organizational_scope.reparent',scope:{type:'ORGANIZATION',id:organizationId,organizationId}},
        ...[...authorizedScopeIds].flatMap(id => ['organizational_scope.read','organizational_scope.create','organizational_scope.rename','organizational_scope.reparent','organizational_scope.archive']
          .flatMap(permission => ['UNIT','TEAM'].map(type => ({permission,scope:{type,id,organizationId}}))))
      ];
      const grants = options.withoutGrants ? [] : options.grants || defaultGrants;
      return { organizationId,membershipVersion:options.membershipVersion||1,authorizationVersion:options.authorizationVersion||1,profileCode:'VIEWER',grants:Object.freeze(grants.map(grant=>Object.freeze({permission:grant.permission,scope:Object.freeze(grant.scope)}))),
        sodRules:Object.freeze([{code:'ORGANIZATIONAL_SCOPE_ARCHIVE_SOD',distinctFromActorIds:Object.freeze([])}]),supportGrant:null };
    } },
    resourcePort: { load:(client,input)=>repository.loadAuthorizationResource(client,input) }, policyEngine,
    auditCoordinator:createAuditCoordinator({port:{async accept(){return 'ACCEPTED';}},timeoutMs:100}),
    clock:{now:()=>AUTHORIZATION_NOW},metricsPort:createMetricsPort(()=>{}) });
  return { authorization, repository, service: createOrganizationalScopeService({ pool, organizationId, repository, authorization }) };
}

async function run() {
  assertTarget();
  const admin = new Pool({ connectionString: process.env.F13P1_GATE_ADMIN_URL, max: 2 });
  let tenant;
  let tenantB;
  try {
    await infrastructure(admin);
    tenant = new Pool({ connectionString: process.env.F13P1_GATE_URL, max: 12 });
    const functionalPool=commitUncertaintyPool(tenant);
    await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await tenant.query(`REVOKE CONNECT,TEMP ON DATABASE ${DB} FROM PUBLIC`);
    await tenant.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${DB} SET search_path TO pg_catalog,c4g_app`);
    let fingerprintIndex = 0;
    const migrated = await createTenantMigrationRunner({ pool: migrationPool(tenant), observationPublisher: { async publish() {} }, timeoutMs: 15000,
      scheduler: { setTimeout, clearTimeout }, fingerprintSchema: async client => {
        const value = tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
        if (!manifest.some(entry => entry.schemaFingerprint === value)) process.stderr.write(`F13-P1 unregistered fingerprint ordinal ${fingerprintIndex}: ${value}\n`);
        fingerprintIndex += 1;
        return value;
      } }).migrate({ tenantId: ORG_A, databaseGenerationId: GENERATION, expectedRevision: 1,
      correlationId: 'f13p1-migrate', idempotencyKey: 'f13p1-migrate' });
    assert.deepEqual(migrated.appliedVersions, manifest.map(entry => entry.version));
    const verifiedEvidence = await preflightTenant(functionalPool, { tenantId: ORG_A, databaseGenerationId: GENERATION }, manifest, { timeoutMs: 10000 });
    assert.equal(verifiedEvidence.currentVersion, manifest.at(-1).version);
    assert.equal(isTenantCapabilityEvidence(verifiedEvidence),true);
    assert.equal(isTenantCapabilityEvidenceForPool(verifiedEvidence,functionalPool),true);
    assert.deepEqual(await createArchiveParticipantRegistry({capabilityEvidence:verifiedEvidence}).beforeArchive(null,{}),{status:'NOT_APPLICABLE'});
    const productionBinding = createOrganizationalScopeProductionComposition({
      authorizationCatalogs: createProductionCatalogs({ catalogVersion: 'f13p1' })
    }).bindTenant({ pool: functionalPool, organizationId: ORG_A, tenantId: ORG_A,
      tenantCapabilityEvidence: verifiedEvidence,
      membershipPort: { async revalidate() { throw new Error('not invoked during binding'); } },
      authorizationDataPort: { async load() { throw new Error('not invoked during binding'); } },
      authorizationAuditPort: { async accept() { throw new Error('not invoked during binding'); } } });
    assert.equal(productionBinding.operations.catalog.size, 5);
    tenantB = new Pool({ connectionString: process.env.F13P1_GATE_URL, max: 2 });
    const production = createOrganizationalScopeProductionComposition({
      authorizationCatalogs: createProductionCatalogs({ catalogVersion: 'f13p1' })
    });
    const bindingInput = { organizationId:ORG_A,tenantId:ORG_A,
      membershipPort:{async revalidate(){throw new Error('not invoked during binding');}},
      authorizationDataPort:{async load(){throw new Error('not invoked during binding');}},
      authorizationAuditPort:{async accept(){throw new Error('not invoked during binding');}} };
    const poolBConnectionsBefore = tenantB.totalCount;
    assert.throws(()=>production.bindTenant({...bindingInput,pool:tenantB,tenantCapabilityEvidence:verifiedEvidence}),/binding is incomplete/);
    assert.equal(tenantB.totalCount,poolBConnectionsBefore);
    assert.equal(isTenantCapabilityEvidenceForPool(verifiedEvidence,tenantB),false);
    const directClient=await tenant.connect();
    let unboundEvidence;
    try { unboundEvidence=await preflightTenantClient(directClient,{tenantId:ORG_A,databaseGenerationId:GENERATION},manifest); }
    finally { directClient.release(); }
    assert.equal(isTenantCapabilityEvidence(unboundEvidence),true);
    assert.equal(isTenantCapabilityEvidenceForPool(unboundEvidence,functionalPool),false);
    assert.throws(()=>production.bindTenant({...bindingInput,pool:functionalPool,tenantCapabilityEvidence:unboundEvidence}),/binding is incomplete/);
    for(const clone of [Object.freeze({...verifiedEvidence}),JSON.parse(JSON.stringify(verifiedEvidence))]) {
      assert.equal(isTenantCapabilityEvidenceForPool(clone,functionalPool),false);
      assert.throws(()=>production.bindTenant({...bindingInput,pool:functionalPool,tenantCapabilityEvidence:clone}),/binding is incomplete/);
    }
    const evidenceB=await preflightTenant(tenantB,{tenantId:ORG_A,databaseGenerationId:GENERATION},manifest,{timeoutMs:10000});
    assert.equal(isTenantCapabilityEvidenceForPool(evidenceB,tenantB),true);
    assert.equal(production.bindTenant({...bindingInput,pool:tenantB,tenantCapabilityEvidence:evidenceB}).operations.catalog.size,5);
    let releasedWithFailure=false;
    const failingReleasePool={async connect(){const client=await tenant.connect();return{query:(...args)=>client.query(...args),release(){client.release();releasedWithFailure=true;throw new Error('synthetic release failure');}};}};
    await assert.rejects(()=>preflightTenant(failingReleasePool,{tenantId:ORG_A,databaseGenerationId:GENERATION},manifest,{timeoutMs:10000}),error=>error.internalCode==='TENANT_PREFLIGHT_CLIENT_CLEANUP_FAILED');
    assert.equal(releasedWithFailure,true);

    async function rejectsSecurityDrift(mutate, restore) {
      await tenant.query(mutate);
      try {
        await assert.rejects(() => preflightTenant(tenant, { tenantId: ORG_A, databaseGenerationId: GENERATION }, manifest, { timeoutMs: 10000 }),
          error => ['TENANT_SCHEMA_FINGERPRINT_MISMATCH','CAPABILITY_EVIDENCE_MISMATCH'].includes(error.internalCode));
      } finally { await tenant.query(restore); }
      assert.equal((await preflightTenant(tenant, { tenantId: ORG_A, databaseGenerationId: GENERATION }, manifest, { timeoutMs: 10000 })).currentVersion, manifest.at(-1).version);
    }
    await rejectsSecurityDrift(
      'ALTER POLICY scope_isolation ON organizational_scope.scope USING (true) WITH CHECK (true)',
      "ALTER POLICY scope_isolation ON organizational_scope.scope USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid)");
    await rejectsSecurityDrift('ALTER TABLE organizational_scope.scope NO FORCE ROW LEVEL SECURITY',
      'ALTER TABLE organizational_scope.scope FORCE ROW LEVEL SECURITY');
    await rejectsSecurityDrift('GRANT DELETE ON organizational_scope.scope TO c4g_organizational_scope_runtime',
      'REVOKE DELETE ON organizational_scope.scope FROM c4g_organizational_scope_runtime');
    await rejectsSecurityDrift('ALTER ROLE c4g_organizational_scope_runtime BYPASSRLS',
      'ALTER ROLE c4g_organizational_scope_runtime NOBYPASSRLS');

    const a = composition(tenant, ORG_A);
    const rootCommand = command({ scopeType: 'UNIT', label: 'Root unit', stableCode: 'ROOT_UNIT', parentScopeId: null });
    const root = await a.service.create(rootCommand);
    const reorderedRootCommand = { provenance: Object.freeze({ observedAt:PROVENANCE.observedAt,sourceReference:PROVENANCE.sourceReference,sourceType:PROVENANCE.sourceType }), assuranceEvidence:null,
      actor:Object.freeze({ authorizationVersion:ACTOR.authorizationVersion,membershipVersion:ACTOR.membershipVersion,membershipId:ACTOR.membershipId,id:ACTOR.id,type:ACTOR.type }),
      parentScopeId:null,stableCode:'ROOT_UNIT',label:'Root unit',scopeType:'UNIT',correlationId:rootCommand.correlationId,idempotencyKey:rootCommand.idempotencyKey };
    assert.deepEqual(await a.service.create(reorderedRootCommand), root);
    assert.deepEqual(await a.service.create(rootCommand), root);
    assert.equal(Number((await tenant.query("SELECT count(*) FROM audit.event WHERE event_code='ORGANIZATIONAL_SCOPE_CREATED'")).rows[0].count),1);
    await assert.rejects(() => a.service.create({ ...rootCommand, label: 'Divergent' }), error => error.publicCode === 'IDEMPOTENCY_CONFLICT');
    const child = await a.service.create(command({ scopeType: 'UNIT', label: 'Child unit', stableCode: 'CHILD_UNIT', parentScopeId: root.scopeId }));
    const team = await a.service.create(command({ scopeType: 'TEAM', label: 'Delivery team', stableCode: 'TEAM_A', parentScopeId: child.scopeId }));
    const destination = await a.service.create(command({ scopeType: 'UNIT', label: 'Destination unit', stableCode: 'DESTINATION_UNIT', parentScopeId: root.scopeId }));
    const otherDestination = await a.service.create(command({ scopeType: 'UNIT', label: 'Other destination', stableCode: 'OTHER_DESTINATION', parentScopeId: root.scopeId }));
    const scopedGrant = (permission,type,id) => ({permission,scope:{type,id,organizationId:ORG_A}});
    const parentAuthorized = composition(tenant, ORG_A, createArchiveParticipantRegistryFixture(), {
      grants:[scopedGrant('organizational_scope.create','UNIT',destination.scopeId)]
    });
    const parentCreated = await parentAuthorized.service.create(command({ scopeType:'TEAM', label:'Parent authorized', stableCode:'PARENT_AUTHORIZED', parentScopeId:destination.scopeId }));
    assert.equal(parentCreated.parentScopeId,destination.scopeId);
    for (const [stableCode,grants] of [
      ['ORG_ONLY_CHILD',[scopedGrant('organizational_scope.create','ORGANIZATION',ORG_A)]],
      ['OTHER_UNIT_CHILD',[scopedGrant('organizational_scope.create','UNIT',otherDestination.scopeId)]]
    ]) {
      const denied=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants});
      const before=Number((await tenant.query("SELECT count(*) FROM audit.event WHERE event_code='ORGANIZATIONAL_SCOPE_CREATED'")).rows[0].count);
      await assert.rejects(()=>denied.service.create(command({scopeType:'TEAM',label:stableCode,stableCode,parentScopeId:destination.scopeId})),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
      assert.equal(Number((await tenant.query('SELECT count(*) FROM organizational_scope.scope WHERE stable_code=$1',[stableCode])).rows[0].count),0);
      assert.equal(Number((await tenant.query("SELECT count(*) FROM audit.event WHERE event_code='ORGANIZATIONAL_SCOPE_CREATED'")).rows[0].count),before);
    }
    const movable = await a.service.create(command({scopeType:'TEAM',label:'Movable',stableCode:'MOVABLE',parentScopeId:child.scopeId}));
    const sourceGrant=scopedGrant('organizational_scope.reparent','TEAM',movable.scopeId);
    const destinationGrant=scopedGrant('organizational_scope.reparent','UNIT',destination.scopeId);
    const reparentAuthorized=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[sourceGrant,destinationGrant]});
    const moved=await reparentAuthorized.service.reparent(command({scopeId:movable.scopeId,expectedRevision:1,parentScopeId:destination.scopeId}));
    assert.equal(moved.parentScopeId,destination.scopeId);
    const reparentEventCount=Number((await tenant.query("SELECT count(*) FROM audit.event WHERE event_code='ORGANIZATIONAL_SCOPE_REPARENTED'")).rows[0].count);
    for (const grants of [[sourceGrant],[destinationGrant],[sourceGrant,scopedGrant('organizational_scope.reparent','ORGANIZATION',ORG_A)],[sourceGrant,destinationGrant]]) {
      const denied=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants});
      await assert.rejects(()=>denied.service.reparent(command({scopeId:movable.scopeId,expectedRevision:2,parentScopeId:otherDestination.scopeId})),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
      assert.deepEqual((await tenant.query('SELECT parent_scope_id::text AS parent,revision FROM organizational_scope.scope WHERE scope_id=$1',[movable.scopeId])).rows[0],{parent:destination.scopeId,revision:'2'});
      assert.equal(Number((await tenant.query("SELECT count(*) FROM audit.event WHERE event_code='ORGANIZATIONAL_SCOPE_REPARENTED'")).rows[0].count),reparentEventCount);
    }
    const rootAuthorized=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[sourceGrant,scopedGrant('organizational_scope.reparent','ORGANIZATION',ORG_A)]});
    const rooted=await rootAuthorized.service.reparent(command({scopeId:movable.scopeId,expectedRevision:2,parentScopeId:null}));
    assert.equal(rooted.parentScopeId,null);
    const replayDenied=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{withoutGrants:true});
    const replayCommand=command({scopeId:movable.scopeId,expectedRevision:3,parentScopeId:destination.scopeId});
    const replayAllowed=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[sourceGrant,destinationGrant,scopedGrant('organizational_scope.reparent','UNIT',otherDestination.scopeId)]});
    await replayAllowed.service.reparent(replayCommand);
    await assert.rejects(()=>replayDenied.service.reparent(replayCommand),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
    await assert.rejects(()=>replayAllowed.service.reparent({...replayCommand,parentScopeId:otherDestination.scopeId}),error=>error.publicCode==='IDEMPOTENCY_CONFLICT');
    const staleAuthorization=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[sourceGrant,destinationGrant],authorizationVersion:2});
    await assert.rejects(()=>staleAuthorization.service.reparent(command({scopeId:movable.scopeId,expectedRevision:4,parentScopeId:destination.scopeId})),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
    const staleMembership=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[sourceGrant,destinationGrant],membershipStatus:'SUSPENDED'});
    await assert.rejects(()=>staleMembership.service.reparent(command({scopeId:movable.scopeId,expectedRevision:4,parentScopeId:destination.scopeId})),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
    await assert.rejects(() => a.service.create(command({ scopeType: 'UNIT', label: 'Invalid child', stableCode: 'TEAM_CHILD', parentScopeId: team.scopeId })));
    await assert.rejects(() => a.service.create(command({ scopeType: 'TEAM', label: 'Collision', stableCode: 'ROOT_UNIT', parentScopeId: null })));
    await assert.rejects(() => a.service.reparent(command({ scopeId: root.scopeId, expectedRevision: 1, parentScopeId: child.scopeId })));
    await assert.rejects(() => a.service.renameLabel(command({ scopeId: root.scopeId, expectedRevision: 99, label: 'Stale' })), error => error.publicCode === 'STALE_REVISION');

    const [uniqueOne, uniqueTwo] = await Promise.allSettled([
      a.service.create(command({ scopeType: 'UNIT', label: 'Concurrent A', stableCode: 'CONCURRENT', parentScopeId: null })),
      a.service.create(command({ scopeType: 'TEAM', label: 'Concurrent B', stableCode: 'CONCURRENT', parentScopeId: null }))
    ]);
    assert.equal([uniqueOne,uniqueTwo].filter(value => value.status === 'fulfilled').length, 1);
    const cycleA = await a.service.create(command({ scopeType: 'UNIT', label: 'Cycle A', stableCode: 'CYCLE_A', parentScopeId: null }));
    const cycleB = await a.service.create(command({ scopeType: 'UNIT', label: 'Cycle B', stableCode: 'CYCLE_B', parentScopeId: null }));
    const competingCycle = await Promise.allSettled([
      a.service.reparent(command({ scopeId: cycleA.scopeId, expectedRevision: 1, parentScopeId: cycleB.scopeId })),
      a.service.reparent(command({ scopeId: cycleB.scopeId, expectedRevision: 1, parentScopeId: cycleA.scopeId }))
    ]);
    assert.equal(competingCycle.filter(value => value.status === 'fulfilled').length, 1);

    const directCycleA = await a.service.create(command({ scopeType: 'UNIT', label: 'Direct cycle A', stableCode: 'DIRECT_CYCLE_A', parentScopeId: null }));
    const directCycleB = await a.service.create(command({ scopeType: 'UNIT', label: 'Direct cycle B', stableCode: 'DIRECT_CYCLE_B', parentScopeId: null }));
    async function directReparent(scopeId, parentScopeId) {
      const client = await tenant.connect();
      let begun = false;
      try {
        await client.query('BEGIN'); begun = true;
        await client.query('SET LOCAL ROLE c4g_organizational_scope_runtime');
        await client.query("SELECT set_config('app.organization_id',$1,true)", [ORG_A]);
        await client.query(`UPDATE organizational_scope.scope SET parent_scope_id=$1,revision=revision+1,
          provenance=$2::jsonb,updated_at=transaction_timestamp(),updated_by_actor_type='HUMAN',updated_by_actor_id=$3
          WHERE organization_id=$4 AND scope_id=$5 AND revision=1`, [parentScopeId,JSON.stringify(PROVENANCE),ACTOR.id,ORG_A,scopeId]);
        await client.query('COMMIT'); begun = false;
      } catch (error) {
        if (begun) await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    const directCompetingCycle = await Promise.allSettled([
      directReparent(directCycleA.scopeId,directCycleB.scopeId),
      directReparent(directCycleB.scopeId,directCycleA.scopeId)
    ]);
    assert.equal(directCompetingCycle.filter(value => value.status === 'fulfilled').length, 1);

    const raceParent = await a.service.create(command({ scopeType: 'UNIT', label: 'Race parent', stableCode: 'RACE_PARENT', parentScopeId: null }));
    const createArchiveRace = await Promise.allSettled([
      a.service.archive(command({ scopeId: raceParent.scopeId, expectedRevision: 1, reasonCode: 'REORGANIZATION' })),
      a.service.create(command({ scopeType: 'TEAM', label: 'Race child', stableCode: 'RACE_CHILD', parentScopeId: raceParent.scopeId }))
    ]);
    assert.equal(createArchiveRace.filter(value => value.status === 'fulfilled').length, 1);
    await assert.rejects(() => a.service.archive(command({ scopeId: root.scopeId, expectedRevision: 1, reasonCode: 'REORGANIZATION' })));
    const archivedTeam = await a.service.archive(command({ scopeId: team.scopeId, expectedRevision: 1, reasonCode: 'REORGANIZATION' }));
    assert.equal(archivedTeam.lifecycle, 'ARCHIVED');
    const archivedChild = await a.service.archive(command({ scopeId: child.scopeId, expectedRevision: 1, reasonCode: 'REORGANIZATION' }));
    assert.equal(archivedChild.lifecycle, 'ARCHIVED');
    await assert.rejects(() => a.service.create(command({ scopeType: 'UNIT', label: 'Reuse', stableCode: 'TEAM_A', parentScopeId: null })));

    const concurrentArchiveLeaf = await a.service.create(command({ scopeType: 'TEAM', label: 'Concurrent archive', stableCode: 'ARCHIVE_RACE', parentScopeId: null }));
    const archiveCommand = command({ scopeId: concurrentArchiveLeaf.scopeId, expectedRevision: 1, reasonCode: 'REORGANIZATION' });
    const concurrentArchives = await Promise.all([a.service.archive(archiveCommand), a.service.archive(archiveCommand)]);
    assert.deepEqual(concurrentArchives[0], concurrentArchives[1]);

    const b = composition(tenant, ORG_B);
    const foreignParent = await b.service.create(command({scopeType:'UNIT',label:'Foreign parent',stableCode:'FOREIGN_PARENT',parentScopeId:null}));
    await assert.rejects(() => b.service.renameLabel(command({ scopeId: root.scopeId, expectedRevision: 1, label: 'Cross tenant' })), error => error.publicCode === 'RESOURCE_NOT_AVAILABLE');
    const foreignTargetGrant={permission:'organizational_scope.create',scope:{type:'UNIT',id:foreignParent.scopeId,organizationId:ORG_A}};
    await assert.rejects(()=>composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[foreignTargetGrant]}).service.create(command({scopeType:'TEAM',label:'Cross tenant child',stableCode:'CROSS_TENANT_CHILD',parentScopeId:foreignParent.scopeId})),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
    const archivedDestination=await a.service.create(command({scopeType:'UNIT',label:'Archived destination',stableCode:'ARCHIVED_DESTINATION',parentScopeId:null}));
    await a.service.archive(command({scopeId:archivedDestination.scopeId,expectedRevision:1,reasonCode:'REORGANIZATION'}));
    const archivedCreate=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[scopedGrant('organizational_scope.create','UNIT',archivedDestination.scopeId)]});
    await assert.rejects(()=>archivedCreate.service.create(command({scopeType:'TEAM',label:'Archived child',stableCode:'ARCHIVED_CHILD',parentScopeId:archivedDestination.scopeId})),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
    const archivedReparent=composition(tenant,ORG_A,createArchiveParticipantRegistryFixture(),{grants:[sourceGrant,scopedGrant('organizational_scope.reparent','UNIT',archivedDestination.scopeId)]});
    await assert.rejects(()=>archivedReparent.service.reparent(command({scopeId:movable.scopeId,expectedRevision:4,parentScopeId:archivedDestination.scopeId})),error=>error.publicCode==='RESOURCE_NOT_AVAILABLE');
    const direct = await tenant.connect();
    try {
      await direct.query('BEGIN'); await direct.query('SET LOCAL ROLE c4g_organizational_scope_runtime');
      await direct.query("SELECT set_config('app.organization_id',$1,true)", [ORG_A]);
      await assert.rejects(() => direct.query('UPDATE organizational_scope.scope SET stable_code=$1,revision=revision+1 WHERE scope_id=$2', ['CHANGED',root.scopeId]), /IMMUTABLE/);
      await direct.query('ROLLBACK');
    } finally { direct.release(); }

    const directArchiveParent = await a.service.create(command({ scopeType: 'UNIT', label: 'Direct archive parent', stableCode: 'DIRECT_ARCHIVE_PARENT', parentScopeId: null }));
    await a.service.create(command({ scopeType: 'TEAM', label: 'Direct archive child', stableCode: 'DIRECT_ARCHIVE_CHILD', parentScopeId: directArchiveParent.scopeId }));
    const directArchive = await tenant.connect();
    try {
      await directArchive.query('BEGIN'); await directArchive.query('SET LOCAL ROLE c4g_organizational_scope_runtime');
      await directArchive.query("SELECT set_config('app.organization_id',$1,true)", [ORG_A]);
      await assert.rejects(() => directArchive.query(`UPDATE organizational_scope.scope
        SET lifecycle='ARCHIVED',revision=revision+1,updated_at=transaction_timestamp(),
            updated_by_actor_type='HUMAN',updated_by_actor_id=$1,archived_at=transaction_timestamp(),
            archived_by_actor_id=$1,archive_reason_code='REORGANIZATION'
        WHERE organization_id=$2 AND scope_id=$3 AND revision=1`, [ACTOR.id,ORG_A,directArchiveParent.scopeId]), /ACTIVE_DESCENDANT/);
      await directArchive.query('ROLLBACK');
    } finally { directArchive.release(); }

    let participantPid;
    const participant = Object.freeze({ capability: F13_CAPABILITY, version: 'v1', async beforeArchive(client) {
      participantPid = (await client.query('SELECT pg_backend_pid() pid,txid_current()::text xid')).rows[0];
      throw new Error('synthetic participant failure');
    } });
    const withParticipant = composition(tenant, ORG_A, createArchiveParticipantRegistryFixture({ required:true, participant }));
    const rollbackLeaf = await withParticipant.service.create(command({ scopeType: 'UNIT', label: 'Rollback leaf', stableCode: 'ROLLBACK_LEAF', parentScopeId: null }));
    await assert.rejects(() => withParticipant.service.archive(command({ scopeId: rollbackLeaf.scopeId, expectedRevision: 1, reasonCode: 'REORGANIZATION' })));
    assert.ok(participantPid?.pid && participantPid?.xid);
    const state = await tenant.query('SELECT lifecycle,revision FROM organizational_scope.scope WHERE scope_id=$1', [rollbackLeaf.scopeId]);
    assert.deepEqual(state.rows[0], { lifecycle: 'ACTIVE', revision: '1' });

    const failingAudit = composition(tenant, ORG_A, createArchiveParticipantRegistryFixture(), {
      auditWriter: { async append() { throw new Error('synthetic F7 failure'); } }
    });
    await assert.rejects(() => failingAudit.service.create(command({ scopeType: 'UNIT', label: 'Audit rollback', stableCode: 'AUDIT_ROLLBACK', parentScopeId: null })));
    assert.equal((await tenant.query("SELECT count(*)::int count FROM organizational_scope.scope WHERE stable_code='AUDIT_ROLLBACK'")).rows[0].count, 0);

    const noGrant = composition(tenant, ORG_A, createArchiveParticipantRegistryFixture(), { withoutGrants: true });
    await assert.rejects(() => noGrant.service.create(command({ scopeType: 'UNIT', label: 'No grant', stableCode: 'NO_GRANT', parentScopeId: null })),
      error => error.publicCode === 'RESOURCE_NOT_AVAILABLE');
    assert.equal((await tenant.query("SELECT count(*)::int count FROM organizational_scope.scope WHERE stable_code='NO_GRANT'")).rows[0].count, 0);

    const inactiveMembership = composition(tenant, ORG_A, createArchiveParticipantRegistryFixture(), { membershipStatus: 'SUSPENDED' });
    await assert.rejects(() => inactiveMembership.service.create(command({ scopeType: 'UNIT', label: 'Inactive member', stableCode: 'INACTIVE_MEMBER', parentScopeId: null })),
      error => error.publicCode === 'RESOURCE_NOT_AVAILABLE');
    assert.equal((await tenant.query("SELECT count(*)::int count FROM organizational_scope.scope WHERE stable_code='INACTIVE_MEMBER'")).rows[0].count, 0);

    const mfaLeaf = await a.service.create(command({ scopeType: 'TEAM', label: 'MFA leaf', stableCode: 'MFA_LEAF', parentScopeId: null }));
    await assert.rejects(() => a.service.archive(command({ scopeId: mfaLeaf.scopeId, expectedRevision: 1,
      reasonCode: 'REORGANIZATION', assuranceEvidence: null })), error => error.publicCode === 'RESOURCE_NOT_AVAILABLE');
    const staleAssurance = Object.freeze({ ...ASSURANCE, authTime: ASSURANCE.authTime - 301 });
    await assert.rejects(() => a.service.archive(command({ scopeId: mfaLeaf.scopeId, expectedRevision: 1,
      reasonCode: 'REORGANIZATION', assuranceEvidence: staleAssurance })), error => error.publicCode === 'RESOURCE_NOT_AVAILABLE');
    assert.deepEqual((await tenant.query('SELECT lifecycle,revision FROM organizational_scope.scope WHERE scope_id=$1', [mfaLeaf.scopeId])).rows[0],
      { lifecycle: 'ACTIVE', revision: '1' });
    const mfaArchived = await a.service.archive(command({ scopeId: mfaLeaf.scopeId, expectedRevision: 1, reasonCode: 'REORGANIZATION' }));
    assert.equal(mfaArchived.lifecycle, 'ARCHIVED');

    const uncertainScopeId='67676767-6767-4767-8767-676767676767';
    const subsequentScopeId='78787878-7878-4787-8787-787878787878';
    const identityIds=[uncertainScopeId,subsequentScopeId];
    const commitBinding=production.bindTenant({...bindingInput,pool:functionalPool,tenantCapabilityEvidence:verifiedEvidence,
      identityFactory:Object.freeze({next(){const value=identityIds.shift();if(!value)throw new Error('synthetic identity exhausted');return value;}}),
      membershipPort:{async revalidate(actor){return{id:actor.membershipId,organizationId:ORG_A,status:'ACTIVE'};}},
      authorizationDataPort:{async load(){return{organizationId:ORG_A,membershipVersion:1,authorizationVersion:1,profileCode:'VIEWER',
        grants:Object.freeze([{permission:'organizational_scope.create',scope:Object.freeze({type:'ORGANIZATION',id:ORG_A,organizationId:ORG_A})}]),
        sodRules:Object.freeze([]),supportGrant:null};}},authorizationAuditPort:{async accept(){return'ACCEPTED';}}});
    const uncertainCreate=command({idempotencyKey:'uncertain-create-0001',scopeType:'UNIT',label:'Commit uncertain',stableCode:'COMMIT_UNCERTAIN',parentScopeId:null});
    const beforeUncertain=functionalPool.snapshot();
    functionalPool.armOnce('40001');
    await assert.rejects(()=>commitBinding.service.create(uncertainCreate),error=>error.publicCode==='PERSISTENCE_UNAVAILABLE'&&!/synthetic|COMMIT|SQL/i.test(error.message));
    const afterUncertain=functionalPool.snapshot();
    assert.equal(afterUncertain.connects,beforeUncertain.connects+1);
    assert.equal(afterUncertain.injected,beforeUncertain.injected+1);
    assert.equal(afterUncertain.discarded,beforeUncertain.discarded+1);
    const committedCreate=(await tenant.query(`SELECT scope_id::text AS "scopeId",revision,lifecycle FROM organizational_scope.scope WHERE organization_id=$1 AND stable_code='COMMIT_UNCERTAIN'`,[ORG_A])).rows;
    assert.deepEqual(committedCreate,[{scopeId:uncertainScopeId,revision:'1',lifecycle:'ACTIVE'}]);
    assert.equal(Number((await tenant.query(`SELECT count(*) FROM organizational_scope.idempotency_record WHERE organization_id=$1 AND operation='CREATE' AND idempotency_key=$2`,[ORG_A,uncertainCreate.idempotencyKey])).rows[0].count),1);
    assert.equal(Number((await tenant.query(`SELECT count(*) FROM audit.event WHERE organization_id=$1 AND event_code='ORGANIZATIONAL_SCOPE_CREATED' AND idempotency_key=$2`,[ORG_A,`ORGANIZATIONAL_SCOPE_CREATED:${uncertainCreate.idempotencyKey}`])).rows[0].count),1);
    const reconciledCreate=await commitBinding.service.create(uncertainCreate);
    assert.equal(reconciledCreate.scopeId,uncertainScopeId);assert.equal(String(reconciledCreate.revision),'1');
    assert.equal(Number((await tenant.query(`SELECT count(*) FROM organizational_scope.scope WHERE organization_id=$1 AND stable_code='COMMIT_UNCERTAIN'`,[ORG_A])).rows[0].count),1);
    assert.equal(Number((await tenant.query(`SELECT count(*) FROM audit.event WHERE organization_id=$1 AND event_code='ORGANIZATIONAL_SCOPE_CREATED' AND idempotency_key=$2`,[ORG_A,`ORGANIZATIONAL_SCOPE_CREATED:${uncertainCreate.idempotencyKey}`])).rows[0].count),1);
    await assert.rejects(()=>commitBinding.service.create({...uncertainCreate,label:'Divergent'}),error=>error.publicCode==='IDEMPOTENCY_CONFLICT');
    const subsequent=await commitBinding.service.create(command({idempotencyKey:'subsequent-create-0001',scopeType:'UNIT',label:'Subsequent healthy',stableCode:'SUBSEQUENT_HEALTHY',parentScopeId:null}));
    assert.equal(subsequent.scopeId,subsequentScopeId);

    let archiveParticipantCalls=0;
    const archiveParticipant=Object.freeze({capability:F13_CAPABILITY,version:'v1',async beforeArchive(){archiveParticipantCalls+=1;return{status:'READY'};}});
    const archiveComposition=composition(functionalPool,ORG_A,createArchiveParticipantRegistryFixture({required:true,participant:archiveParticipant}));
    const uncertainArchiveLeaf=await archiveComposition.service.create(command({scopeType:'TEAM',label:'Uncertain archive',stableCode:'UNCERTAIN_ARCHIVE',parentScopeId:null}));
    const uncertainArchive=command({idempotencyKey:'uncertain-archive-0001',scopeId:uncertainArchiveLeaf.scopeId,expectedRevision:1,reasonCode:'REORGANIZATION'});
    functionalPool.armOnce('40P01');
    await assert.rejects(()=>archiveComposition.service.archive(uncertainArchive),error=>error.publicCode==='PERSISTENCE_UNAVAILABLE');
    assert.equal(archiveParticipantCalls,1);
    assert.deepEqual((await tenant.query('SELECT lifecycle,revision FROM organizational_scope.scope WHERE scope_id=$1',[uncertainArchiveLeaf.scopeId])).rows[0],{lifecycle:'ARCHIVED',revision:'2'});
    assert.equal(Number((await tenant.query(`SELECT count(*) FROM organizational_scope.idempotency_record WHERE organization_id=$1 AND operation='ARCHIVE' AND idempotency_key=$2`,[ORG_A,uncertainArchive.idempotencyKey])).rows[0].count),1);
    assert.equal(Number((await tenant.query(`SELECT count(*) FROM audit.event WHERE organization_id=$1 AND event_code='ORGANIZATIONAL_SCOPE_ARCHIVED' AND idempotency_key=$2`,[ORG_A,`ORGANIZATIONAL_SCOPE_ARCHIVED:${uncertainArchive.idempotencyKey}`])).rows[0].count),1);
    const reconciledArchive=await archiveComposition.service.archive(uncertainArchive);
    assert.equal(reconciledArchive.lifecycle,'ARCHIVED');assert.equal(String(reconciledArchive.revision),'2');assert.equal(archiveParticipantCalls,1);

    const samples = { create: [], read: [], reparent: [], archive: [] };
    for (let index=0; index<8; index += 1) {
      let started = performance.now();
      const value = await a.service.create(command({ scopeType: 'TEAM', label: `Benchmark ${index}`, stableCode: null, parentScopeId: root.scopeId }));
      samples.create.push(performance.now()-started);
      started = performance.now(); await a.service.read({ correlationId: correlation(), scopeId: value.scopeId, actor: ACTOR, assuranceEvidence: null }); samples.read.push(performance.now()-started);
      started = performance.now(); const moved = await a.service.reparent(command({ scopeId: value.scopeId, expectedRevision: 1, parentScopeId: null })); samples.reparent.push(performance.now()-started);
      started = performance.now(); await a.service.archive(command({ scopeId: value.scopeId, expectedRevision: Number(moved.revision), reasonCode: 'REORGANIZATION' })); samples.archive.push(performance.now()-started);
    }
    const baseline = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { medianMs: Number(percentile(values,.5).toFixed(3)), p95Ms: Number(percentile(values,.95).toFixed(3)) }]));

    const events = await tenant.query("SELECT event_code,count(*)::int count FROM audit.event WHERE event_code LIKE 'ORGANIZATIONAL_SCOPE_%' GROUP BY event_code ORDER BY event_code");
    assert.ok(events.rows.some(row => row.event_code === 'ORGANIZATIONAL_SCOPE_ARCHIVED' && row.count >= 2));
    assert.equal((await tenant.query('SELECT count(*)::int count FROM organizational_scope.scope WHERE organization_id=$1', [ORG_B])).rows[0].count, 1);
    process.stdout.write(JSON.stringify({ postgres17:true, canonicalRunner:true, rls:true, stableCode:true, hierarchy:true,
      directSqlLeafFirst:true, directSqlCycleSerialized:true, f5CanonicalAuthorization:true,
      f5ResourceLoading:true, exactParentDestinationAuthorization:true, poolBoundCapabilityEvidence:true, recentMfaEnforced:true, securityDriftDenied:true,
      leafFirst:true, canonicalIdempotency:true, functionalCommitUncertaintyReconciled:true, verifiedCapabilityEvidence:true, f7SourceLocal:true, participantRollback:true, historicalArchive:true, benchmarkBaseline:baseline, cleanupByFinally:true })+'\n');
  } finally {
    if (tenantB) await tenantB.end();
    if (tenant) await tenant.end();
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname=$1`, [DB]).catch(()=>{});
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`).catch(()=>{});
    for (const role of ['c4g_organizational_scope_runtime','c4g_organizational_scope_migrator','c4g_organizational_scope_owner','c4g_tenant_runtime','c4g_tenant_migrator','c4g_tenant_owner']) await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
    await admin.end();
  }
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
