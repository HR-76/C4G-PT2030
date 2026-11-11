'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {listQuery,editCommand,createCommand,archiveCommand,materialize,mutationReceipt}=require('../src/opportunities/httpContracts');
const {updateIntentionDigest,createIntentionDigest,lifecycleIntentionDigest}=require('../src/opportunities/digests');
const {createProductionComposition}=require('../src/productionComposition');
const id='71300000-0000-4000-8000-000000000001',key='71300000-0000-4000-8000-000000000002';
const snapshot={schemaVersion:1,provenanceId:key,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',
  normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',title:'Synthetic',funderName:'Synthetic funder'};
test('write and replay receipt cannot project functional content without READ',()=>{
  const result=mutationReceipt({opportunityId:id,revisionId:key,rowVersion:'2',revisionNumber:'2',snapshot,title:'Private',summary:'Private',fundingAmountMax:'20.5'});
  assert.deepEqual(result,{opportunityId:id,revisionId:key,rowVersion:2,revisionNumber:2});
  assert.throws(()=>mutationReceipt({...result,rowVersion:'9007199254740992'}));
});
test('tenant metadata ACL inspection is caller-independent and uses OIDs',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const filename of ['tenantMigrationPreflight.js','tenantSchemaFingerprint.js']){
    const source=fs.readFileSync(path.join(__dirname,'../src/security',filename),'utf8');
    assert.ok(!source.includes('information_schema.table_privileges'));
    assert.ok(source.includes('pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault'));
    assert.ok(!/has_table_privilege\([^,]+,'organizational_scope\./.test(source));
  }
});
test('HTTP list is closed, cursor-based and contains no caller authority',()=>{
  assert.equal(listQuery({pageSize:'20',cursor:'synthetic'}).cursor,'synthetic');
  for(const name of ['organizationId','tenantId','membershipId','actor','correlationId','assurance','resourceId','page'])
    assert.throws(()=>listQuery({[name]:id}),{code:'OPPORTUNITY_INVALID_INPUT'});
  assert.throws(()=>listQuery({pageSize:'0'}));assert.throws(()=>listQuery({programmeName:['a','b']}));
});
test('HTTP edit is closed, requires UUID/CAS and rejects authority at both levels',()=>{
  const raw={requestId:key,expectedRowVersion:1,changes:{title:'Synthetic revised'}};
  assert.equal(editCommand(id,raw).opportunityId,id);
  assert.throws(()=>editCommand('1',raw));assert.throws(()=>editCommand(id,{...raw,expectedRowVersion:'1'}));
  for(const field of ['organizationId','tenantId','actor','membershipId','correlationId','assurance','lifecycleState','validationState']){
    assert.throws(()=>editCommand(id,{...raw,[field]:id}));
    assert.throws(()=>editCommand(id,{...raw,changes:{[field]:id}}));
  }
});
test('materialization preserves server lifecycle and validates money/dates without invented EUR',()=>{
  const result=materialize(editCommand(id,{requestId:key,expectedRowVersion:1,changes:{title:'Revised',fundingAmountMin:'0',fundingAmountMax:'12.123456',currencyCode:'USD'}}),snapshot,'2026-10-11T10:00:00.000Z');
  assert.equal(result.snapshot.lifecycleState,'ACTIVE');assert.equal(result.snapshot.currencyCode,'USD');
  assert.equal(result.provenance.sourceType,'ORGANIZATION_MANUAL');
  assert.throws(()=>materialize(editCommand(id,{requestId:key,expectedRowVersion:1,changes:{fundingAmountMin:'0'}}),snapshot,'2026-10-11T10:00:00.000Z'));
});
test('update idempotency includes target, CAS and non-searchable edits, excluding generated recording time',()=>{
  const full=materialize(editCommand(id,{requestId:key,expectedRowVersion:1,changes:{summary:'Synthetic one'}}),snapshot,'2026-10-11T10:00:00.000Z');
  const digest=v=>updateIntentionDigest(v,'ORGANIZATION',id);
  assert.equal(digest(full),digest({...full,provenance:{...full.provenance,observedAt:'2026-10-11T11:00:00.000Z'}}));
  for(const changed of [{...full,opportunityId:key},{...full,expectedRowVersion:2},{...full,snapshot:{...full.snapshot,summary:'Synthetic two'}},
    {...full,snapshot:{...full.snapshot,lifecycleState:'ARCHIVED'}}])assert.notEqual(digest(full),digest(changed));
});
test('production runtime fails closed before startup for non-OIDC auth',()=>{
  assert.throws(()=>createProductionComposition({dependencies:{},env:{AUTH_MODE:'disabled'}}),/AUTH_MODE|OIDC/);
});
test('HTTP create fixes authority, lifecycle and provenance; full intention excludes server time',()=>{
  const raw={requestId:key,fields:{title:'Synthetic create',funderName:'Synthetic funder',summary:'One'}};
  const command=createCommand(raw,'2026-10-12T10:00:00.000Z');
  assert.equal(command.snapshot.lifecycleState,'ACTIVE');assert.equal(command.snapshot.validationState,'PENDING_REVIEW');
  assert.equal(command.provenance.sourceType,'ORGANIZATION_MANUAL');assert.equal(command.snapshot.currencyCode,undefined);
  assert.equal(createIntentionDigest(command,'ORGANIZATION',id),createIntentionDigest(createCommand(raw,'2026-10-12T11:00:00.000Z'),'ORGANIZATION',id));
  assert.notEqual(createIntentionDigest(command,'ORGANIZATION',id),createIntentionDigest(createCommand({...raw,fields:{...raw.fields,summary:'Two'}},'2026-10-12T10:00:00.000Z'),'ORGANIZATION',id));
  for(const field of ['tenantId','organizationId','actor','membershipId','provenance','lifecycleState','validationState']){
    assert.throws(()=>createCommand({...raw,[field]:id},'2026-10-12T10:00:00.000Z'));
    assert.throws(()=>createCommand({...raw,fields:{...raw.fields,[field]:id}},'2026-10-12T10:00:00.000Z'));
  }
});
test('HTTP archive is fixed logical action with CAS and operation-local digest; active list default',()=>{
  const command=archiveCommand(id,{requestId:key,expectedRowVersion:2});assert.equal(command.action,'ARCHIVE');
  assert.throws(()=>archiveCommand(id,{requestId:key,expectedRowVersion:'2'}));
  for(const field of ['tenantId','organizationId','action','actor','membershipId'])assert.throws(()=>archiveCommand(id,{requestId:key,expectedRowVersion:2,[field]:id}));
  assert.notEqual(lifecycleIntentionDigest(command,'ORGANIZATION',id),lifecycleIntentionDigest({...command,expectedRowVersion:3},'ORGANIZATION',id));
  assert.equal(listQuery({}).filters.lifecycleState,'ACTIVE');assert.equal(listQuery({lifecycleState:'ARCHIVED'}).filters.lifecycleState,'ARCHIVED');
});
test('HTTP route discovery publishes only the C4G opportunity contract',async()=>{
  const {opportunityEndpointCatalog}=require('../src/app');
  const endpoints=opportunityEndpointCatalog();
  assert.ok(endpoints.includes('POST /api/admin/central-opportunities'));assert.ok(!endpoints.includes('POST /api/opportunities'));assert.ok(!endpoints.includes('POST /api/opportunities/:id/archive'));
  assert.ok(!endpoints.some(route=>route.startsWith('DELETE')));
  const express=require('express'),cors=require('cors'),{createApp}=require('../src/app');
  const routes={opportunities:express.Router()};
  const app=createApp({express,cors,config:{nodeEnv:'test'},pool:{query(){throw Error('No database allowed for route discovery');}},routes});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/`);assert.equal(response.status,200);
    const info=await response.json();assert.deepEqual(info.endpoints.opportunities,endpoints);assert.equal(info.endpoints.legacy_opportunities,undefined);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
