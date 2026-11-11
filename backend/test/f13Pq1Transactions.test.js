'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate,operations}=require('../src/prequalification/contracts');
const {id}=require('./fixtures/pq1Activation');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const {resolveEvent}=require('../src/audit/eventCatalog');
const {manifest,migrationSql,PQ1_ACTIVATION_TENANT_DOWNGRADE}=require('../src/security/tenantMigrationManifest');
test('activation has explicit sensitive permission and existing two-person segregation',()=>{
 const c=validateProductionAuthorizationBootstrap(),p=c.permissionCatalog.resolve('organization_profile.activate');
 assert.equal(p.sensitive,true);assert.equal(p.sodRule,'F13_PROFILE_ACTIVATION_SOD');
 assert.equal(c.operationCatalog.resolve(operations.activate).resourceType,'PROFILE_ACTIVATION_COHORT');
 assert.ok(c.profileCatalog.profiles.every(p=>p.permissions.length===0));
 assert.notEqual(c.operationCatalog.resolve(operations.evaluate).permission,c.operationCatalog.resolve(operations.read).permission);
});
test('activation command pins both null/zero or exact identity/generation without tenant authority in body',()=>{
 const input={versionId:id(1),expectedActivationId:null,expectedGeneration:0,reason:'Fixture',idempotencyKey:id(2)};
 assert.equal(validate('activate',input).versionId,id(1));
 for(const delta of [{expectedGeneration:1},{expectedActivationId:id(3)},{expectedGeneration:NaN},{reason:' '},{organizationId:id(9)}])assert.throws(()=>validate('activate',{...input,...delta}));
 assert.equal(validate('activate',{...input,expectedActivationId:id(3),expectedGeneration:1}).expectedGeneration,1);
});
test('evaluation command requires exact criteria, opportunity and activation generation',()=>{
 const input={opportunityId:id(1),opportunityRevisionId:id(2),criteriaRevisionId:id(3),activationId:id(4),generation:1,idempotencyKey:id(5)};
 assert.equal(validate('evaluate',input).generation,1);
 for(const delta of [{generation:0},{criteriaRevisionId:null},{score:0},{actorId:id(6)}])assert.throws(()=>validate('evaluate',{...input,...delta}));
});
test('019 is admitted with reversible empty-only downgrade and append-only records',()=>{
 const entry=manifest.find(e=>e.version==='019_f13_pq1_activation');assert.equal(entry.version,'019_f13_pq1_activation');
 assert.ok(entry.capabilities.includes('F14_PQ1_CONSUMPTION'));assert.equal(entry.sqlChecksum,migrationSql(entry.version,'up').checksum);
 assert.equal(PQ1_ACTIVATION_TENANT_DOWNGRADE.downChecksum,migrationSql(entry.version,'down').checksum);
 assert.match(migrationSql(entry.version,'down').sql,/PQ1_ACTIVATION_DOWNGRADE_REQUIRES_EMPTY_DATA/);
});
test('activation and evaluation are critical F7 events, result reads are observational',()=>{
 for(const code of ['PROFILE_COHORT_ACTIVATED','PREQUALIFICATION_EVALUATED'])assert.equal(resolveEvent(code).auditClass,'CRITICAL_PRE_EFFECT');
 assert.equal(resolveEvent('PREQUALIFICATION_ACCESSED').auditClass,'OBSERVATIONAL_RECONCILABLE');
});

test('active baseline audit identifies a profile projection, not an evaluation',async()=>{
 const now='2030-01-15T12:00:00.000Z';let material;
 const client={async query(sql,values){
  if(sql.includes('prepare_append'))return {rows:[{stream_id:id(7),sequence:1,previous_hash:null,accepted_at:now}]};
  material=JSON.parse(values.at(-1));return {rows:[{status:'APPENDED',event_id:values[0],event_hash:values[21]}]};
 }};
 await require('../src/prequalification/audit').createWriter({organizationId:id(1),actor:{id:id(2),membershipId:id(3)},correlationId:require('../src/audit/uuidV7').createUuidV7(),clock:()=>new Date(now)})(client,{operationCode:operations.active,eventCode:'PREQUALIFICATION_ACCESSED',resourceId:id(1),key:id(5),digest:'a'.repeat(64)});
 assert.equal(material.resource.type,'PROFILE_PROJECTION');assert.equal(material.resource.id,id(1));
});
