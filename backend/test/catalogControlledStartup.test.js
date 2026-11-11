'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {admitControlledTarget,matchesTarget,matchesAdmin}=require('../src/opportunities/catalogRead/controlledTarget');
const {createPgPolicyStore}=require('../src/opportunities/catalogRead/pgPolicyStore');
const {createAdminOnlyRehearsalControl}=require('../src/opportunities/catalogRead/adminOnlyRehearsalControl');
const {catalogReadRuntimeEnvironment}=require('../scripts/localPlatform/catalogReadRuntime');
const organizationId='11111111-1111-4111-a111-111111111111',userId='22222222-2222-4222-a222-222222222222';
test('JSON flags cannot forge controlled admission or enable a runtime',()=>{
 const forged={target:{host:'localhost',port:5432,database:'c4g_central_dev'},organizationId,userId};
 assert.equal(matchesTarget(forged,forged.target),false);
 assert.throws(()=>createPgPolicyStore({controlledAdmission:forged,pool:{connect(){}},login:'gcni_catalog_policy'}));
 assert.throws(()=>createAdminOnlyRehearsalControl({controlledAdmission:forged,organizationId,userId,store:{durable:true}}));
 assert.throws(()=>catalogReadRuntimeEnvironment({catalogRead:{mode:'controlled',firstAccess:'organization-administrator'}},forged));
});
test('a different database identity or revoked admin cannot admit controlled startup',async()=>{
 const target={host:'localhost',port:5432,database:'c4g_central_dev'},expected={databaseOid:'42',clusterIdentityHash:createHash('sha256').update('cluster').digest('hex')};
 for(const fault of ['database','source','member',null]){
  const client={async query(sql){if(sql.includes('current_database() AS'))return {rows:[{database:target.database,oid:fault==='database'?'43':'42',cluster:'cluster',primary:true}]};if(sql.includes('eu_source_control'))return {rows:[{state:fault==='source'?'RUNNING':'QUIESCED'}]};if(sql.includes('organization_membership'))return {rowCount:fault==='member'?0:1};return {};},release(){}};
  const pool={options:target,connect:async()=>client};
  if(fault)await assert.rejects(()=>admitControlledTarget({pool,target,expected,organizationId,userId}),/NOT_ADMITTED/);
  else {const cap=await admitControlledTarget({pool,target,expected,organizationId,userId});assert(matchesTarget(cap,target));assert(!matchesTarget(cap,{...target,port:5433}));assert(matchesAdmin(cap,{organizationId,userId}));assert(!matchesAdmin(cap,{organizationId,userId:organizationId}));}
 }
});

test('habitual controlled launcher never starts the source worker',()=>{const {buildServices}=require('../../scripts/start-local.cjs');assert.deepEqual(buildServices({funding:{source:'live-local'},catalogRead:{mode:'controlled'}}).map(s=>s.name),['api','web']);});

test('explicit controlled entry excludes source configuration without mutating stored state',()=>{const {sourceFreeState}=require('../scripts/startCatalogControlled');const original={catalogRead:{mode:'controlled',firstAccess:'organization-administrator'},funding:{source:'live-local'},opportunityEuWriter:{},organizationId};const safe=sourceFreeState(original);assert.equal(safe.funding,undefined);assert.equal(safe.opportunityEuWriter,undefined);assert(original.funding);assert.equal(safe.organizationId,organizationId);assert.throws(()=>sourceFreeState({}));});
