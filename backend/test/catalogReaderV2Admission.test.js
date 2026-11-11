'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCatalogReader}=require('../src/fundingTenders/catalogReader');
const {assertReaderSession}=require('../src/security/catalogReaderSecurity');
const schema=require('../src/security/centralSchemaManifest');
const BASE=['opportunity','revision','funding_identity'];
const DERIVED=['revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_allocation_concept_v2','revision_deadline_v2'];
function fixture({version='042_opportunity_eu_source_control_v2',grants=[...BASE,...DERIVED],mutateAcl,write=false,definer=false,loginGrant=false}={}){
 const calls=[],acl=DERIVED.map(relname=>({relname,owner:'c4g_opportunity_central_owner',privilege_type:'SELECT',is_grantable:false}));mutateAcl?.(acl);
 const client={release(){},async query(sql,values){calls.push({sql,values});
  if(sql.includes('session_user=current_user'))return {rows:[{reset:true,limited:true,membership:true}]};
  if(sql.includes('p.prosecdef')){const allowed=values?.[1]||BASE;return {rows:[{excess:write||definer||grants.some(name=>!allowed.includes(name))}]};}
  if(sql.includes(' AS excess'))return {rows:[{excess:loginGrant}]};
  if(sql.includes('a.is_grantable'))return {rows:acl};
  throw Error('Unexpected reader query');
 }};
 class Pool{connect(){return Promise.resolve(client);}end(){return Promise.resolve();}}
 return {client,calls,version,reader:createCatalogReader({env:{CATALOG_DATABASE_URL:'postgres://reader:synthetic@localhost/disposable'},Pool})};
}
async function withSchema(f,work){const original=schema.assertCentralSchemaForVersions;schema.assertCentralSchemaForVersions=async(_client,versions)=>{assert(versions.includes(f.version));return {version:f.version,fingerprint:'measured'};};try{return await work();}finally{schema.assertCentralSchemaForVersions=original;await f.reader.close();}}
test('reader admits exactly the five projected SELECT grants after verified schema042 admission',async()=>{
 const f=fixture();await withSchema(f,()=>f.reader.ready());
 const check=f.calls.find(c=>c.sql.includes('p.prosecdef'));assert.deepEqual(check.values[1],[...BASE,...DERIVED]);
});
test('baseline reader still refuses v2 grants and unverified callers cannot assert schema042',async()=>{
 const f=fixture({version:'035_funding_source_resolution'});await withSchema(f,()=>assert.rejects(f.reader.ready(),/CATALOG_READER_ROLE_EXCESS_PRIVILEGES/));
 await assert.rejects(assertReaderSession(f.client,{version:'042_opportunity_eu_source_control_v2'}),/CATALOG_READER_SCHEMA_ADMISSION_REQUIRED/);
 const old=fixture({version:'035_funding_source_resolution',grants:BASE});await withSchema(old,()=>old.reader.ready());
});
test('v2 admission preserves rejection of writes, extra tables, definer execution and direct login grants',async()=>{
 for(const options of [{write:true},{grants:[...BASE,...DERIVED,'activation_plan_v2']},{definer:true},{loginGrant:true}]){const f=fixture(options);await withSchema(f,()=>assert.rejects(f.reader.ready(),/CATALOG_READER_(ROLE_)?EXCESS_PRIVILEGES/));}
});
test('derived reader grants must be complete non-grantable SELECT owned by the central catalog owner',async()=>{
 for(const mutateAcl of [rows=>rows.pop(),rows=>{rows[0].is_grantable=true;},rows=>{rows[0].owner='other_owner';},rows=>{rows[0].privilege_type='UPDATE';},rows=>rows.push({...rows[0]})]){
  const f=fixture({mutateAcl});await withSchema(f,()=>assert.rejects(f.reader.ready(),/CATALOG_READER_DERIVED_PRIVILEGES_DRIFT/));
 }
});

test('schema048 retains the exact v2 reader grants without accepting writes or new tables',async()=>{for(const options of [{},{write:true},{grants:[...BASE,...DERIVED,'activation_plan_v2']}]){const f=fixture({version:'048_catalog_read_service_v1',...options});await withSchema(f,()=>Object.keys(options).length?assert.rejects(f.reader.ready(),/CATALOG_READER_ROLE_EXCESS_PRIVILEGES/):f.reader.ready());}});
