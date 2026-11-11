'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {args,readonly,acceptedRecord,assertTenantIdentity}=require('../scripts/localPlatform/prepareOpportunityV2');
test('real preview has no apply mode and refuses arbitrary targets',()=>{args(['--preview-real']);for(const value of [[],['--apply'],['--preview-real','--database=other']])assert.throws(()=>args(value));});
test('real preview checks database and read-only transaction before touching business data',async()=>{
 for(const row of [{database:'wrong',read_only:'on'},{database:'central',read_only:'off'}]){let touched=false,released=false;const queries=[];const client={query:async sql=>{queries.push(sql);return {rows:[row]};},release:()=>{released=true;}};await assert.rejects(()=>readonly({connect:async()=>client},'central',async()=>{touched=true;}));assert.equal(touched,false);assert.equal(released,true);assert.equal(queries.at(-1),'ROLLBACK');}
});
test('real preview rolls back and releases even when a read fails',async()=>{
 const queries=[];let released=false;const client={query:async sql=>{queries.push(sql);return {rows:[{database:'central',read_only:'on',server_version_num:'180006',observed_at:new Date('2026-10-31T00:00:00Z')}]};},release:()=>{released=true;}};
 await assert.rejects(()=>readonly({connect:async()=>client},'central',async()=>{throw Error('read failed');}));assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,true);
});
test('legacy source identity and protected decisions are preserved without inventing mappings',()=>{
 const record=acceptedRecord({opportunity_id:'o',current_revision_id:'r',row_version:'3',external_identifier:'POCTEP:2021-2027:CALL:10',snapshot:{schemaVersion:1},corrections:{title:'reviewed'},resolutions:[{decision_digest:'d'}]});
 assert.deepEqual(record.identities,[{namespace:'POCTEP',externalId:'POCTEP:2021-2027:CALL:10'}]);assert.equal(record.mappingDigest,null);assert.equal(record.resolutions.length,1);assert.deepEqual(record.corrections,{title:'reviewed'});assert.deepEqual(record.privateReferences,[]);
});
test('real preview refuses wrong physical tenant identity before private inspection',async()=>{
 const expected={tenantId:'tenant-a',generationId:'generation-a'};
 const valid={product_code:'C4G',database_role:'TENANT',marker_format_version:1,tenant_id:'tenant-a',database_generation_id:'generation-a',identity_revision:'1'};
 for(const rows of [[],[valid,valid],[{...valid,tenant_id:'tenant-b'}],[{...valid,database_generation_id:'generation-b'}],[{...valid,product_code:'OTHER'}]])await assert.rejects(async()=>assertTenantIdentity({query:async()=>({rows})},expected),/OPPORTUNITY_PREVIEW_TENANT_IDENTITY/);
 await assertTenantIdentity({query:async()=>({rows:[valid]})},expected);
});
test('legacy and canonical identities are compared as namespace and external identifier pairs',()=>{
 const row={opportunity_id:'o',current_revision_id:'r',row_version:'1',snapshot:{schemaVersion:1},external_identifier:'CASCADE:11145',identities:[{namespace:'OTHER_SOURCE',externalId:'CASCADE:11145'}]};
 const value=acceptedRecord(row);assert.equal(value.identities.length,2);assert.ok(value.identities.some(i=>i.namespace==='EU_FUNDING_TENDERS'));
});
