'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const contracts=require('../src/organizationalProfile/competencyContracts');
const {createPreparedCompetencyService,OPS}=require('../src/organizationalProfile/competencyService');
const {createProductionCatalogs}=require('../src/authorization/catalogs');
const {createCompetencyRepository}=require('../src/organizationalProfile/competencyRepository');
const {createCompetencyTelemetry}=require('../src/organizationalProfile/competencyTelemetry');
const base=()=>({draftId:randomUUID(),expectedRevision:1,idempotencyKey:randomUUID()});
const assertion=()=>({assertionId:randomUUID(),versionId:randomUUID(),knowledgeStatus:'UNKNOWN',conceptId:null,levelId:null});
const commands=()=>({setCompetencies:{...base(),assertions:[assertion()]},setExperiences:{...base(),experiences:[]},
 attachEvidence:{...base(),linkId:randomUUID(),assertionVersionId:randomUUID(),experienceVersionId:randomUUID(),documentVersionId:null},
 verifyCompetency:{...base(),verificationId:randomUUID(),assertionVersionId:randomUUID(),methodId:randomUUID(),validUntil:null},
 readEvidenceLink:{draftId:randomUUID(),linkId:randomUUID(),idempotencyKey:randomUUID()}});
test('S5 five closed commands reject all caller authority without invoking accessors',()=>{
 let calls=0;
 for(const [method,command] of Object.entries(commands())){
  assert.ok(Object.isFrozen(contracts[method](command)));
  for(const key of ['actor','membershipId','organizationId','tenantId','resourceId','correlationId','assurance'])
   assert.throws(()=>contracts[method]({...command,[key]:randomUUID()}));
  const accessor={...command};Object.defineProperty(accessor,'draftId',{get(){calls++;},enumerable:true});
  assert.throws(()=>contracts[method](accessor));
  assert.throws(()=>contracts[method](new Proxy(command,{})));
 }
 assert.equal(calls,0);
});
test('S5 unknown is explicit, no invented type/method or default verification',()=>{
 const c=commands();assert.throws(()=>contracts.setCompetencies({...c.setCompetencies,assertions:[{...assertion(),knowledgeStatus:'VERIFIED'}]}));
 assert.throws(()=>contracts.setCompetencies({...c.setCompetencies,assertions:[{...assertion(),knowledgeStatus:'KNOWN'}]}));
 assert.throws(()=>contracts.setExperiences({...c.setExperiences,experiences:[{type:'PROJECT'}]}));
 assert.throws(()=>contracts.verifyCompetency({...c.verifyCompetency,method:'DEFAULT'}));
});
test('S5 versions, duplicate IDs, periods and revision overflow fail closed',()=>{
 const a=assertion(),c=commands();assert.throws(()=>contracts.setCompetencies({...c.setCompetencies,assertions:[a,a]}));
 assert.throws(()=>contracts.setCompetencies({...c.setCompetencies,expectedRevision:Number.MAX_SAFE_INTEGER}));
 assert.throws(()=>contracts.setExperiences({...c.setExperiences,experiences:[{experienceId:randomUUID(),versionId:randomUUID(),typeId:randomUUID(),provenanceRef:randomUUID(),observedFrom:'2026-10-11T00:00:00.000Z',observedUntil:'2026-10-10T00:00:00.000Z'}]}));
});
test('S5 real productive catalog has exact resources, permissions, MFA and empty bundles',()=>{
 const c=createProductionCatalogs({catalogVersion:'f13'});
 const resources={setCompetencies:'PROFILE_DRAFT',setExperiences:'PROFILE_DRAFT',attachEvidence:'ASSERTION',verifyCompetency:'COMPETENCY_ASSERTION',readEvidenceLink:'EVIDENCE_LINK'};
 for(const [method,code]of Object.entries(OPS))assert.equal(c.operationCatalog.resolve(code).resourceType,resources[method]);
 assert.equal(c.operationCatalog.resolve(OPS.setCompetencies).permission,'organization_profile.draft.edit');
 assert.equal(c.operationCatalog.resolve(OPS.setExperiences).permission,'organization_profile.draft.edit');
 const verification=c.permissionCatalog.resolve(c.operationCatalog.resolve(OPS.verifyCompetency).permission);
 assert.equal(verification.sensitive,true);assert.equal(verification.sodRule,'F13_COMPETENCY_VERIFICATION_SOD');
 assert.ok(c.profileCatalog.profiles.every(p=>p.permissions.length===0));
});
test('S5 unprepared clients and forged contexts execute zero SQL, F5 and F7',async()=>{
 let sql=0,f5=0,f7=0;const context={organizationId:randomUUID()};
 const service=createPreparedCompetencyService({contexts:new WeakMap([[context,{}]]),protectAuthorization(){f5++;},repository:{setCompetencies(){f7++;}}});
 await assert.rejects(()=>service.execute({query(){sql++;}},'setCompetencies',commands().setCompetencies,context));
 await assert.rejects(()=>service.execute({query(){sql++;}},'setCompetencies',commands().setCompetencies,{...context}));
 assert.deepEqual([sql,f5,f7],[0,0,0]);
});
test('S5 intention digest separates tenants, operations and changed content',()=>{
 const a=createCompetencyRepository({organizationId:randomUUID()}),b=createCompetencyRepository({organizationId:randomUUID()}),c=commands().setCompetencies;
 assert.notEqual(a.intention('setCompetencies',c).digest,b.intention('setCompetencies',c).digest);
 assert.notEqual(a.intention('setCompetencies',c).digest,a.intention('setCompetencies',{...c,assertions:[]}).digest);
 assert.notEqual(a.intention('setCompetencies',c).operation,a.intention('setExperiences',{...base(),experiences:[]}).operation);
});
test('S5 F10 labels are closed and contain no functional data',async()=>{
 const records=[],t=createCompetencyTelemetry({metrics:{record(...args){records.push(args);}}});
 await t.observe('profile.competency.setCompetencies',async()=>({secret:'not-recorded'}));
 assert.deepEqual(records[0][2],{operation:'profile.competency.setCompetencies',resultClass:'success'});
 await assert.rejects(()=>t.observe(randomUUID(),async()=>{}));assert.ok(!JSON.stringify(records).includes('secret'));
});
test('S5 migration is pinned and additive, catalogs contain zero seeds, downgrade is narrow',()=>{
 const {manifest,migrationSql,COMPETENCY_TENANT_DOWNGRADE}=require('../src/security/tenantMigrationManifest'),e=manifest[9];
 assert.equal(e.version,'009_f13_competencies_and_experience');assert.equal(migrationSql(e.version,'up').checksum,e.sqlChecksum);
 assert.ok(e.capabilities.includes('F13_COMPETENCIES_AND_EXPERIENCE'));assert.ok(!e.capabilities.includes('F13_ORGANIZATIONAL_PROFILE'));
 assert.ok(!/INSERT\s+INTO\s+organization_profile\.competency_catalog/i.test(migrationSql(e.version,'up').sql));
 assert.ok(migrationSql(e.version,'down').sql.includes('F13_COMPETENCY_009_DOWN_REFUSES_DATA_LOSS'));
 assert.ok(JSON.stringify(COMPETENCY_TENANT_DOWNGRADE).includes('008_f13_profile_authoring_and_assertions'));
});
