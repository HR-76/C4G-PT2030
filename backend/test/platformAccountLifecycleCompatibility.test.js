'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const version='058_platform_account_lifecycle';

test('account lifecycle is explicit in each registered catalog and billing readiness boundary',()=>{
 for(const file of ['security/catalogReaderSchema.js','security/catalogReaderSecurity.js','customerBilling/pdfRuntime.js','productionComposition.js']){
  assert.ok(fs.readFileSync(path.join(__dirname,'../src',file),'utf8').includes(`'${version}'`),file);
 }
 const reader=require('../src/security/catalogReaderSchema');
 const fingerprint='1'.repeat(64);
 assert.equal(reader.admittedReaderVersion(fingerprint,[{version,schemaFingerprint:fingerprint}]),version);
 assert.throws(()=>reader.admittedReaderVersion(fingerprint,[{version:'059_unregistered',schemaFingerprint:fingerprint}]),/CATALOG_READER_SCHEMA_DRIFT/);
 assert.throws(()=>reader.admittedReaderVersion('2'.repeat(64),[{version,schemaFingerprint:fingerprint}]),/CATALOG_READER_SCHEMA_DRIFT/);
});

test('account lifecycle reader retains the exact derived-table SELECT permissions and refuses drift',async t=>{
 const readerSchema=require('../src/security/catalogReaderSchema'),readerSecurity=require('../src/security/catalogReaderSecurity');
 const admission=Object.freeze({version});
 t.mock.method(readerSchema,'isReaderSchemaAdmission',value=>value===admission);
 const derived=['revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_allocation_concept_v2','revision_deadline_v2'];
 let readable,derivedChecks=0,drift=false;
 const client={async query(sql,params){
  if(sql.includes('r.rolcanlogin AND NOT'))return {rows:[{reset:true,limited:true,membership:true}]};
  if(sql.startsWith('SELECT c.relname,')){
   derivedChecks++;
   assert.deepEqual(params,[derived,'c4g_catalog_reader']);
   return {rows:derived.map(relname=>({relname,owner:'c4g_opportunity_central_owner',privilege_type:'SELECT',is_grantable:drift}))};
  }
  if(params?.[0]==='c4g_catalog_reader')readable=params[1];
  return {rows:[{excess:false}]};
 }};
 await readerSecurity.assertReaderSession(client,admission);
 assert.deepEqual(readable,['opportunity','revision','funding_identity',...derived]);
 assert.equal(derivedChecks,1);
 drift=true;
 await assert.rejects(()=>readerSecurity.assertReaderSession(client,admission),/CATALOG_READER_DERIVED_PRIVILEGES_DRIFT/);
 await assert.rejects(()=>readerSecurity.assertReaderSession(client,{version}),/CATALOG_READER_SCHEMA_ADMISSION_REQUIRED/);
});

test('billing PDF readiness admits account lifecycle before probing storage',async t=>{
 const schema=require('../src/security/centralSchemaManifest'),stop=Error('schema boundary reached');
 t.mock.method(schema,'assertCentralSchemaForVersions',async(_pool,versions)=>{
  assert.ok(versions.includes(version));throw stop;
 });
 const runtime=require('../src/customerBilling/pdfRuntime').configuredBillingPdfs({pool:{},customerService:{},env:{NODE_ENV:'development',BILLING_PDF_RUNTIME:'local-private'}});
 try{await assert.rejects(()=>runtime.ready(),error=>error===stop);}
 finally{await runtime.close();}
});
