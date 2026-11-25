'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createCentralImportUploadRuntime,configuredCentralImport}=require('../src/portugal2030/uploadRuntime');
const {MIME}=require('../src/portugal2030/planXlsxV2');
test('runtime refuses revoked session before persisting a verified upload receipt',async()=>{
 const bytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/portugal2030/PlanoAnualAvisos_download_140926-1.xlsx')),hash=createHash('sha256').update(bytes).digest('hex');
 let inserted=false,sessionChecks=0;
 const c={release(){},async query(sql){
  if(sql.includes('application_session')){sessionChecks++;return {rows:[],rowCount:0}}
  if(sql.startsWith('INSERT')){inserted=true;throw Error('must not write')}
  if(sql.includes('SELECT * FROM opportunity_catalog.pt2030_document_upload'))return {rows:[]};
  if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:[{id:randomUUID()}]};
  if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql))return {rows:[]};
  throw Error('Unexpected SQL');
 }};
 const store={async beginWrite(){return {}},async write(){},async commit(){},async abort(){},async head(){return {size:bytes.length,etag:'test',sha256:hash}},async readRange({start,end}){return [bytes.subarray(start,end+1)]},async shutdown(){}};
 const runtime=createCentralImportUploadRuntime({pool:{async connect(){return c}},store,scanner:{async scan(){return {status:'CLEAN'}}},audit:async()=>{throw Error('must not audit success')}});
 await assert.rejects(runtime.upload({userId:randomUUID(),sessionId:'revoked',requestId:randomUUID(),file:{buffer:bytes,filename:'Plano.xlsx',mime:MIME}}),{code:'C4G_ADMIN_REQUIRED'});assert.equal(inserted,false);assert.equal(sessionChecks,1);
});
test('production configuration does not activate an unconfigured central service',()=>{
 assert.equal(configuredCentralImport({env:{}}),null);assert.throws(()=>configuredCentralImport({env:{CENTRAL_PT2030_IMPORT_RUNTIME:'invalid'}}));
});

for (const version of ['049_pt2030_document_upload', '054_billing_account_validation', '055_entity_type_edit']) {
 for (const catalog of [false, true]) {
 test(`${version} retains import availability in ${catalog ? 'catalog' : 'preview'} mode`, async t => {
  const schema = require('../src/security/centralSchemaManifest');
  let checked = false;
  t.mock.method(schema, 'assertCentralSchemaForVersions', async (_client, versions) => {
   assert.equal(versions.includes(require('../src/security/centralImportMigrationPackage').CENTRAL_BASELINE), false);
   assert.equal(versions.includes('036_f12_service_authority'), false);
   assert.equal(versions.includes('999_unknown'), false);
   if (!versions.includes(version)) throw Object.assign(Error(), { code: 'CENTRAL_SCHEMA_VERSION_NOT_ADMITTED' });
   checked = true;
   return { version };
  });
  let tablesReady = true, privilegesReady = true, storageReady = true, scannerReady = true;
  const client = { release() {}, async query(sql) {
   if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return { rows: [] };
   if (sql.includes('to_regclass')) return { rows: [{ ready: tablesReady }] };
   if (sql.includes('has_table_privilege')) return { rows: [{ ready: privilegesReady }] };
   if (sql.endsWith('LIMIT 0')) return { rows: [] };
   throw Error('Unexpected SQL');
  } };
  const runtime = createCentralImportUploadRuntime({ pool: { async connect() { return client; } },
   store: { async health() { return { ready: storageReady }; } }, scanner: { async health() { return { ready: scannerReady }; } },
   ...(catalog ? { authority: { async authorize() {} } } : {}) });
  assert.deepEqual(await runtime.availability(), { available: true, mode: catalog ? 'STAGE_AND_ACCEPT' : 'PREVIEW_ONLY',
   maxBytes: require('../src/portugal2030/planXlsxV2').MAX_BYTES });
  assert.equal(checked, true);
  tablesReady = false;
  assert.deepEqual(await runtime.availability(), { available: false, code: 'CENTRAL_IMPORT_SCHEMA_REQUIRED' });
  tablesReady = true;
  privilegesReady = false;
  assert.deepEqual(await runtime.availability(), { available: false, code: 'CENTRAL_IMPORT_SCHEMA_REQUIRED' });
  privilegesReady = true;
  storageReady = false;
  assert.equal((await runtime.availability()).available, false);
  storageReady = true;
  scannerReady = false;
  assert.equal((await runtime.availability()).available, false);
  scannerReady = true;
  t.mock.method(schema, 'assertCentralSchemaForVersions', async () => { throw Error('Schema drift'); });
  assert.deepEqual(await runtime.availability(), { available: false, code: 'CENTRAL_IMPORT_DEPENDENCY_UNAVAILABLE' });
 });
 }
}
