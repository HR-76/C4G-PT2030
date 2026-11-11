'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const validators=require('../src/organizationalProfile/populationContracts');const {effectiveState,ORIGINS,OPS,createPreparedPopulationService}=require('../src/organizationalProfile/populationService');
const {createProductionCatalogs}=require('../src/authorization/catalogs');const {createPopulationRepository}=require('../src/organizationalProfile/populationRepository');
const {createPopulationTelemetry}=require('../src/organizationalProfile/populationTelemetry');const {MetricRegistry}=require('../src/observability/metrics');
const {manifest,migrationSql,POPULATION_TENANT_DOWNGRADE}=require('../src/security/tenantMigrationManifest');
const {resolveEvent}=require('../src/audit/eventCatalog');const {validatePayload}=require('../src/audit/event');
const {createPopulationResourceLoader}=require('../src/organizationalProfile/populationResources');
const create=()=>({assertionId:randomUUID(),assertionKind:'SERVED_POPULATION',countValue:'0',unitId:randomUUID(),metricId:randomUUID(),countingBasisId:randomUUID(),territoryRefs:[{geographicId:randomUUID(),coverageKind:'FULL'}],groupRefs:[{conceptId:randomUUID(),schemeId:randomUUID(),releaseId:randomUUID()}],organizationalScopeId:null,startDate:'2025-01-01',endDate:'2025-12-31',provenanceRef:randomUUID(),documentVersionIds:[],idempotencyKey:randomUUID()});
test('S8 integer counts are exact canonical strings without rounding',()=>{for(const countValue of ['0','1','9007199254740993'])assert.equal(validators.create({...create(),countValue}).countValue,countValue);for(const countValue of ['-0','-1','1e2','00','1.5',1,NaN])assert.throws(()=>validators.create({...create(),countValue}),{code:'F13_INVALID_INPUT'});});
test('S8 assertions distinguish territory, target group and actually served population',()=>{const c=create(),noCount={countValue:null,unitId:null,metricId:null,countingBasisId:null};assert.doesNotThrow(()=>validators.create({...c,...noCount,assertionKind:'TERRITORY',groupRefs:[]}));assert.doesNotThrow(()=>validators.create({...c,...noCount,assertionKind:'TARGET_GROUP',territoryRefs:[]}));for(const patch of [{assertionKind:'TARGET_GROUP'},{assertionKind:'TERRITORY'},{countValue:null},{territoryRefs:[]},{groupRefs:[]},{territoryRefs:[{geographicId:randomUUID(),coverageKind:'PARTIAL',percentage:10}]}])assert.throws(()=>validators.create({...c,...patch}));});
test('S8 calendar periods are inclusive and validated',()=>{const c=create();assert.doesNotThrow(()=>validators.create({...c,startDate:c.endDate}));for(const value of [{startDate:'2025-02-30'},{endDate:'2024-01-01'},{startDate:'2025-1-01'}])assert.throws(()=>validators.create({...c,...value}));});
test('S8 identity, authority and population-derived fields are never functional inputs',()=>{for(const field of ['actor','organizationId','membershipId','resourceId','correlationId','assurance','state','score','convertedAmount'])assert.throws(()=>validators.create({...create(),[field]:'injected'}));let accesses=0;const c=create();Object.defineProperty(c,'countValue',{get(){accesses++;return '1';}});assert.throws(()=>validators.create(c));assert.equal(accesses,0);assert.throws(()=>validators.create(new Proxy(create(),{})));});
test('S8 document references are bounded, canonical and closed',()=>{const c=create();const a=randomUUID(),b=randomUUID();assert.deepEqual(validators.create({...c,documentVersionIds:[a,b]}).documentVersionIds,[a,b].sort());assert.throws(()=>validators.create({...c,documentVersionIds:[a,a]}));assert.throws(()=>validators.create({...c,documentVersionIds:Array.from({length:17},randomUUID)}));});
test('S8 transitions have separate closed contracts and mandatory reasons',()=>{for(const method of ['reject','dispute','revoke']){const c={assertionId:randomUUID(),expectedRevision:1,reasonId:randomUUID(),idempotencyKey:randomUUID()};assert.doesNotThrow(()=>validators[method](c));const {reasonId,...noReason}=c;assert.throws(()=>validators[method](noReason));}assert.deepEqual(ORIGINS.revoke,['VERIFIED','DISPUTED']);assert.equal(Object.hasOwn(validators,'expire'),false);});
test('S8 effective expiration is derived, inclusive and does not mutate persisted state',()=>{const r={state:'VERIFIED',valid_until:'2025-01-01T00:00:00.000Z'};const t=Date.parse(r.valid_until);assert.equal(effectiveState(r,t-1),'VERIFIED');assert.equal(effectiveState(r,t),'VERIFIED');assert.equal(effectiveState(r,t+1),'EXPIRED');assert.equal(r.state,'VERIFIED');assert.equal(effectiveState({state:'REVOKED',valid_until:r.valid_until},t+1),'REVOKED');assert.equal(effectiveState({state:'VERIFIED',valid_until:null},t+1),'VERIFIED');});
test('S8 F5 has exactly eight explicit ORG-only resources and empty bundles',()=>{const c=createProductionCatalogs({catalogVersion:'f13'});for(const [method,op] of Object.entries(OPS)){const o=c.operationCatalog.resolve(op);assert.equal(o.permission,'profile_population.'+method);assert.equal(o.resourceType,method==='create'?'POPULATION_SCOPE':'POPULATION_ASSERTION');const p=c.permissionCatalog.resolve(o.permission);assert.deepEqual(p.scopes,['ORGANIZATION']);assert.equal(p.sensitive,['read','verify','reject','dispute','revoke'].includes(method));assert.equal(Boolean(p.sodRule),['verify','reject','revoke'].includes(method));}assert.ok(c.profileCatalog.profiles.every(p=>p.permissions.length===0));});
test('S8 unprepared service cannot authorize or execute SQL',async()=>{let sql=0;const svc=createPreparedPopulationService({repository:{},loader:{},contexts:new WeakMap(),revalidate(){throw Error('must not authorize');}});await assert.rejects(()=>svc.execute({query(){sql++;}},'create',validators.create(create()),{}),{code:'F13_AUTHORIZATION_REQUIRED'});assert.equal(sql,0);});
test('S8 intention binds organization, operation, exact count and explicit references',()=>{const c=validators.create(create()),repo=createPopulationRepository({organizationId:randomUUID()});const d=repo.intention('create',c);assert.equal(d.digest,repo.intention('create',{...c}).digest);for(const patch of [{countValue:'1'},{countingBasisId:randomUUID()},{territoryRefs:[{geographicId:randomUUID(),coverageKind:'FULL'}]}])assert.notEqual(d.digest,repo.intention('create',{...c,...patch}).digest);assert.notEqual(d.digest,createPopulationRepository({organizationId:randomUUID()}).intention('create',c).digest);});
test('S8 migration 012 pins and closed safe downgrade are consistent',()=>{assert.equal(manifest[12].version,'012_f13_territories_and_populations');assert.equal(migrationSql(manifest[12].version,'up').checksum,manifest[12].sqlChecksum);assert.equal(migrationSql(manifest[12].version,'down').checksum,POPULATION_TENANT_DOWNGRADE.downChecksum);assert.equal(POPULATION_TENANT_DOWNGRADE.targetVersion,'011_f13_operational_capacity');});
test('S8 telemetry records only operation and bounded result class',async()=>{const metrics=new MetricRegistry(),t=createPopulationTelemetry({metrics});await t.observe('profile.population.create',async()=>1);await assert.rejects(()=>t.observe('profile.population.verify',async()=>{throw Object.assign(Error('not logged'),{code:'F13_AUTHORIZATION_REQUIRED'});}));for(const m of metrics.snapshot().records)assert.deepEqual(Object.keys(m.labels).sort(),['operation','resultClass']);});

test('S8 read replay loader selects the recorded revision, not the current head',async()=>{
 const org=randomUUID(),id=randomUUID(),key=randomUUID();let selected;
 const client={async query(sql,values){if(sql.includes('population_assertion WHERE'))return{rows:[{head_revision:4}]};if(sql.includes('population_idempotency_record'))return{rows:[{assertion_id:id,revision:1}]};if(sql.includes('population_assertion_revision')){selected=values[2];assert.match(sql,/start_date::text/);return{rows:[{revision:1,state:'DRAFT',document_version_ids:[]}]};}return{rows:[{now:new Date()}]};}};
 await createPopulationResourceLoader({organizationId:org}).load(client,'read',{assertionId:id,idempotencyKey:key},true);assert.equal(selected,1);
 const mismatch=await createPopulationResourceLoader({organizationId:org}).load(client,'read',{assertionId:randomUUID(),idempotencyKey:key},true);assert.throws(()=>mismatch.validate(),{code:'F13_IDEMPOTENCY_CONFLICT'});
});

test('S8 VERIFY replay bounds maker-checker and documents to persisted pre-operation history',async()=>{
 const org=randomUUID(),id=randomUUID(),maker=randomUUID(),checker=randomUUID(),doc=randomUUID(),version=randomUUID();
 const command={assertionId:id,idempotencyKey:randomUUID(),expectedRevision:999},intention={operation:'POPULATION_VERIFY',digest:'a'.repeat(64)};
 let stored={assertion_id:id,revision:3,intention_digest:intention.digest,operation:'VERIFY',state:'VERIFIED'};
 const boundaries=[];
 const client={async query(sql,values){
  if(sql.includes('population_assertion WHERE'))return{rows:[{head_revision:5}]};
  if(sql.includes('population_idempotency_record'))return{rows:[stored]};
  if(sql.includes('SELECT *,start_date')){assert.equal(values[2],2);return{rows:[{revision:2,operation:'SUBMIT',state:'SUBMITTED',document_version_ids:[version]}]};}
  if(sql.includes('load_population_reference'))return{rows:[{document_id:doc,author_subject_id:maker}]};
  if(sql.includes('SELECT actor_subject_id')){const cutoff=values.at(-1);boundaries.push(cutoff);assert.equal(cutoff,2);return{rows:[{actor_subject_id:maker}]};}
  return{rows:[{now:new Date()}]};
 }};
 const loader=createPopulationResourceLoader({organizationId:org});
 const loaded=await loader.load(client,'verify',command,true,intention);loaded.validate();
 assert.deepEqual(boundaries,[2,2]);assert.deepEqual(loaded.resource.distinctFromActorIds,[maker]);assert.ok(!loaded.resource.distinctFromActorIds.includes(checker));
 assert.equal(loaded.additionalAuthorizations[0].resource.id,doc);
 stored={...stored,intention_digest:'b'.repeat(64)};
 const conflict=await loader.load(client,'verify',command,true,intention);assert.throws(()=>conflict.validate(),{code:'F13_IDEMPOTENCY_CONFLICT'});
 stored={...stored,operation:'REVOKE'};await assert.rejects(()=>loader.load(client,'verify',command,true,intention),{code:'F13_AUTHORIZATION_REQUIRED'});
});

test('S8 catalog evidence is population-only and rejects arbitrary content',()=>{
 const payload={reasonRef:randomUUID(),reasonReleaseRef:randomUUID(),reasonCatalogVersion:'synthetic-v1',purposeRef:randomUUID(),purposeReleaseRef:randomUUID(),purposeCatalogVersion:'synthetic-v1'};
 assert.doesNotThrow(()=>validatePayload(payload,resolveEvent('POPULATION_ASSERTION_READ')));
 assert.throws(()=>validatePayload({...payload,reasonRef:'free text'},resolveEvent('POPULATION_ASSERTION_READ')));
 assert.throws(()=>validatePayload({...payload,purposeCatalogVersion:'unapproved version'},resolveEvent('POPULATION_ASSERTION_READ')));
 assert.throws(()=>validatePayload(payload,resolveEvent('TAXONOMY_RELEASE_CREATED')));
 assert.throws(()=>validatePayload({...payload,documentId:randomUUID()},resolveEvent('POPULATION_ASSERTION_READ')));
});
