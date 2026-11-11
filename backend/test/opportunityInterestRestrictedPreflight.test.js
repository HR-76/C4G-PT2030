'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateFeatureCapabilities}=require('../src/security/tenantMigrationPreflight');
const entry={capabilities:['ORGANIZATIONAL_OPPORTUNITY_INTERESTS']};
const tableRows=['opportunity_interest','interest_unit','interest_change','interest_receipt','application_unit'].map(relname=>({relname,usable:true,destructive:false,mutable:false}));
function client(references){return {async query(sql){
 if(sql.includes('AS mutable_id')){
  // An API login deliberately has no USAGE on the functional schema.
  assert.match(sql,/has_column_privilege\('c4g_opportunity_tenant_runtime',c\.oid,/);
  assert.match(sql,/FROM pg_catalog\.pg_class c JOIN pg_catalog\.pg_namespace/);
  return {rows:references};
 }
 if(sql.includes('AS table_name')||sql.includes('SELECT a.attname'))return {rows:[]};
 assert(sql.includes('AS usable'));return {rows:tableRows};
}};}
test('interest metadata checks resolve relation OIDs without functional schema access',async()=>{
 await validateFeatureCapabilities(client([{mutable_id:false,mutable_revision:false}]),entry);
});
test('missing, unknown or mutable source links refuse capability evidence',async()=>{
 for(const rows of [[],[{mutable_id:null,mutable_revision:false}],[{mutable_id:false,mutable_revision:null}],[{mutable_id:true,mutable_revision:false}],[{mutable_id:false,mutable_revision:true}]])
  await assert.rejects(validateFeatureCapabilities(client(rows),entry));
});

test('unrequested capability tables are refused and absent schemas remain acceptable',async()=>{
 const empty={query:async()=>({rows:[]})};
 await validateFeatureCapabilities(empty,{capabilities:[]});
 const unexpected={query:async(sql,params)=>({rows:sql.includes('AS table_name')&&params[0]==='async_exec'?[{table_name:'inbox',rls:true}]:[]})};
 await assert.rejects(validateFeatureCapabilities(unexpected,{capabilities:[]}),{internalCode:'CAPABILITY_EVIDENCE_MISMATCH'});
});
