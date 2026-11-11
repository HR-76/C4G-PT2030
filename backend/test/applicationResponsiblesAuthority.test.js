'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createResponsibleAuthority,validateResponsibleRows}=require('../src/applications/responsibleAuthority');
const {createAuthorityCoordinator}=require('../src/security/authorityCoordinator');
const protocol=require('../src/security/authorityProtocolQueries');
const queries=require('../src/applications/responsibleQueries');
test('responsibles refuse generic pools and authorization precedes every protected observation',async()=>{
 assert.throws(()=>createResponsibleAuthority({coordinator:{pool:{query(){}}},organizationId:randomUUID(),assertAuthorized(){}}),/authority and guard/);
 let calls=0,guards=0;const coordinator=createAuthorityCoordinator({pool:{query(){calls++;throw Error('unexpected');},async connect(){calls++;throw Error('unexpected');}},permitSecret:'synthetic-local-test-only-secret-32'});
 const port=createResponsibleAuthority({coordinator,organizationId:randomUUID(),assertAuthorized(){guards++;throw Error('AUTHORITY_DENIED');}});
 for(const action of [()=>port.list(),()=>port.validate(randomUUID()),()=>port.names([randomUUID()])])await assert.rejects(action,/AUTHORITY_DENIED/);
 assert.equal(calls,0);assert.equal(guards,3);
});
test('malformed authority results fail closed instead of becoming empty eligibility',()=>{
 const id=randomUUID(),valid={membership_id:id,display_name:'Synthetic'};
 assert.deepEqual(validateResponsibleRows({rows:[valid],rowCount:1},26,true),[valid]);
 for(const result of [null,{}, {rows:[],rowCount:1},{rows:[valid],rowCount:'1'}, {rows:[{...valid,email:'not-returned'}],rowCount:1}, {rows:[{...valid,display_name:null}],rowCount:1},{rows:[valid,valid],rowCount:2}])assert.throws(()=>validateResponsibleRows(result,26,true),/RESULT_INVALID/);
 assert.throws(()=>validateResponsibleRows({rows:[valid],rowCount:1},0,true),/RESULT_INVALID/);
});
test('exact responsible operations are in the signed catalog and migration; arbitrary membership SQL denied',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const sql=fs.readFileSync(path.join(__dirname,'../database/central/migrations/030_application_responsibles.up.sql'),'utf8');
 for(const query of Object.values(queries)){
  assert(protocol.queries.includes(query));assert(sql.includes(createHash('sha256').update(query).digest('hex')));
  assert(sql.includes(query.replaceAll("'","''")));
 }
 let calls=0;
 await assert.rejects(()=>protocol.execute({query(){calls++;}},'SELECT * FROM public.organization_membership'),e=>e.code==='42501');assert.equal(calls,0);
});
test('catalog reader accepts only explicitly compatible exact fingerprints, never a future or unknown revision',()=>{
 const {admittedReaderVersion}=require('../src/security/catalogReaderSchema');
 const {manifest}=require('../src/security/centralMigrationManifest');
 for(const version of ['029_catalog_reader','030_application_responsibles','031_tenant_directory_resolution','032_single_organization_membership'])assert.equal(admittedReaderVersion(manifest.find(e=>e.version===version).schemaFingerprint,manifest),version);
 assert.throws(()=>admittedReaderVersion('unknown',manifest),/DRIFT/);
 assert.throws(()=>admittedReaderVersion('future',[...manifest,{version:'031_unknown',schemaFingerprint:'future'}]),/DRIFT/);
 assert.throws(()=>admittedReaderVersion(manifest[28].schemaFingerprint,manifest),/DRIFT/);
});
test('authority transport failure propagates, never an empty responsible list',async()=>{
 const coordinator=createAuthorityCoordinator({pool:{query(){throw Error('unused');},async connect(){throw Error('SYNTHETIC_AUTHORITY_UNAVAILABLE');}},permitSecret:'synthetic-local-test-only-secret-32'});
 const port=createResponsibleAuthority({coordinator,organizationId:randomUUID(),assertAuthorized(){}});
 await assert.rejects(()=>port.list(),/SYNTHETIC_AUTHORITY_UNAVAILABLE/);
});
test('create revalidates a selected responsible before any write; revocation or foreign membership refuses creation',async()=>{
 const {createApplicationRepository}=require('../src/applications/repository');
 const org=randomUUID(),member=randomUUID(),input={origin:'CENTRAL',opportunityId:randomUUID(),centralRevisionId:randomUUID(),evaluationId:null,
  title:'Synthetic',responsibleMembershipId:member,deadline:'2027-12-01',idempotencyKey:randomUUID()};
 for(const reason of ['revoked-after-list','foreign-membership']){
  const steps=[];let writes=0;
  const repo=createApplicationRepository({organizationId:org,actor:{id:randomUUID()},
   protect:async()=>steps.push('authorized'),centralOrigin:async()=>({title:'Synthetic',lifecycleState:'ACTIVE'}),
   verifyResponsible:async id=>{assert.equal(id,member);steps.push(reason);return false;},audit(){throw Error('unexpected audit write');}});
  const client={async query(sql){if(/^(INSERT|UPDATE|DELETE)/.test(sql))writes++;if(sql.startsWith('SELECT * FROM opportunity_catalog.application_receipt'))return {rows:[]};throw Error('unexpected query');}};
  await assert.rejects(()=>repo.create(client,input),e=>e.code==='RESPONSIBLE_UNAVAILABLE');
  assert.deepEqual(steps,['authorized',reason]);assert.equal(writes,0);
 }
});
test('editing also revalidates the exact target under the existing revision check before mutation',async()=>{
 const {createApplicationRepository}=require('../src/applications/repository');
 const org=randomUUID(),id=randomUUID(),member=randomUUID(),steps=[];
 const repo=createApplicationRepository({organizationId:org,actor:{id:randomUUID()},protect:async()=>steps.push('authorized'),
  verifyResponsible:async value=>{assert.equal(value,member);steps.push('validate');return false;}});
 const client={async query(sql){
  if(sql.startsWith('SELECT a.*'))return {rows:[{application_id:id,opportunity_id:randomUUID(),evaluation_id:null,revision:2,status:'IDENTIFIED',notes:null}]};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.application_receipt'))return {rows:[]};
  throw Error('unexpected query or write');
 }};
 await assert.rejects(()=>repo.edit(client,id,{title:'Synthetic',responsibleMembershipId:member,deadline:'2027-12-01',expectedRevision:2,idempotencyKey:randomUUID()}),e=>e.code==='RESPONSIBLE_UNAVAILABLE');
 assert.deepEqual(steps,['authorized','validate']);
});
