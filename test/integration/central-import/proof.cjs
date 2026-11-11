'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const m=require('../../../backend/src/security/centralMigrationManifest'),r=require('../../../backend/scripts/runCentralMigrations');
const pkg=require('../../../backend/src/security/centralImportMigrationPackage');
module.exports=async({pool,report,check,connection})=>{
 const apply=p=>r.applyRegisteredCentralImportPackage(p,pkg.PACKAGE_ID);
 const count=async table=>(await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
 const c=await pool.connect();try{await c.query('BEGIN');await c.query(m.migrationSql(pkg.entry.version,'up').sql);
 for(const [file,method] of [['euWriterSecurityManifest','euWriterSecuritySnapshot'],['euRunReconciliationSecurityManifest','euRunReconciliationSecuritySnapshot'],['euLegacyPrearchiveSecurityManifest','snapshot']]){const security=require('../../../backend/src/security/'+file);report[file]=security.digest(await security[method](c));}
 }finally{await c.query('ROLLBACK');c.release();}
 const before=await count('public.c4g_schema_migration');
 await check('FAILURE_ROLLS_BACK_SCHEMA_AND_LEDGER',async()=>{
  const failing={async connect(){const c=await pool.connect();return {release:()=>c.release(),query(sql,params){if(sql.includes('INSERT INTO public.c4g_schema_migration')&&params?.[0]===pkg.entry.version)throw Error('INJECTED_LEDGER_FAILURE');return c.query(sql,params)}}}};
  await assert.rejects(apply(failing),/INJECTED_LEDGER_FAILURE/);
  assert.equal((await pool.query("SELECT to_regclass('opportunity_catalog.pt2030_document_upload') value")).rows[0].value,null);
  assert.equal(await count('public.c4g_schema_migration'),before);
 });
 await check('REGISTERED_INSTALL_REPLAY_AND_NORMAL_ADMISSION',async()=>{
  await apply(pool);assert.equal(await count('public.c4g_schema_migration'),before+1);
  await apply(pool);assert.equal(await count('public.c4g_schema_migration'),before+1);
  await assert.rejects(r.applyRegisteredCatalogReadPackage(pool,'catalog-read-v1'),/baseline mismatch/);
  const admitted=await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool);assert.equal(admitted.currentVersion,pkg.entry.version);
  assert.equal(await require('../../../backend/src/security/catalogReaderSchema').assertCatalogReaderSchema(pool),pkg.entry.version);
  require('../../../backend/src/opportunities/catalogRead/ledgerContract').assertLedgerRows((await pool.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration')).rows);
  assert.equal(await require('../../../backend/src/opportunities/catalogRead/readSchema').fingerprint(pool),pkg.entry.readFingerprint);
  report.version=pkg.entry.version;report.schemaFingerprint=pkg.entry.schemaFingerprint;report.checksum=pkg.entry.upChecksum;
 });
 await check('PERMISSION_DRIFT_REJECTED',async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('GRANT SELECT ON opportunity_catalog.pt2030_document_upload TO c4g_catalog_reader');
   await assert.rejects(require('../../../backend/src/security/centralImportSecurity').assertCentralImportSecurity(c),/CENTRAL_IMPORT_PERMISSION_DRIFT/);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 const userId=randomUUID(),sessionId=randomUUID();
 await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Isolated import fixture',$2,'ACTIVE')",[userId,userId+'@example.invalid']);
 await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),userId]);
 await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) SELECT $1,id,'ACTIVE',session_revocation_version,now(),now(),now()+interval '1 hour' FROM public.global_user WHERE id=$2",[sessionId,userId]);
 const bytes=fs.readFileSync(path.resolve(__dirname,'../../../backend/test/fixtures/portugal2030/PlanoAnualAvisos_download_140926-1.xlsx'));
 const objects=new Map();
 const store={async beginWrite({objectId}){return {objectId}},async write(h,stream){const chunks=[];for await(const c of stream)chunks.push(c);objects.set(h.objectId,Buffer.concat(chunks))},async commit(){},async abort(){},async head({objectId}){return {size:objects.get(objectId).length,etag:'isolated'}},async readRange({objectId,start,end}){return [objects.get(objectId).subarray(start,end+1)]},async health(){return {ready:true}},async shutdown(){}};
 const runtime=require('../../../backend/src/portugal2030/uploadRuntime').createCentralImportUploadRuntime({pool,store,scanner:{async scan(){return {status:'CLEAN'}},async health(){return {ready:true}}}});
 report.limitations=['Object storage and antivirus use explicit test doubles; this does not certify R2/ClamAV connectivity.','Synthetic Super Admin session; no browser/OIDC or habitual environment activation.'];
 let receipt,preview;
 const requestId=randomUUID(),previewRequestId=randomUUID();
 const input={userId,sessionId,requestId,file:{buffer:bytes,filename:'Plano.xlsx',mime:require('../../../backend/src/portugal2030/planXlsxV2').MIME}};
 await check('UPLOAD_REAL_SQL_AND_IDEMPOTENT_RECEIPT',async()=>{
  assert.equal((await runtime.availability()).available,true);
  receipt=await runtime.upload(input);assert.deepEqual(await runtime.upload(input),receipt);
  assert.equal(await count('opportunity_catalog.pt2030_document_upload'),1);
 });
 await check('PREVIEW_REAL_SQL_AND_IDEMPOTENT_RECEIPT',async()=>{
  const command={userId,sessionId,requestId,previewRequestId,sheetName:receipt.sheets[0]};
  preview=await runtime.preview(command);const replay=await runtime.preview(command);
  assert.equal(replay.replayed,true);assert.deepEqual(replay,{...preview,replayed:true});assert.equal(preview.rows.length,177);
  assert.equal(await count('opportunity_catalog.pt2030_plan_preview'),1);
  assert.equal(await count('opportunity_catalog.pt2030_plan_import'),0);
  assert.equal(await count('opportunity_catalog.opportunity'),0);
  report.previewRows=preview.rows.length;
 });
 await check('IMMUTABILITY_AND_READER_ISOLATION',async()=>{
  for(const table of ['pt2030_document_upload','pt2030_plan_preview']){
   for(const sql of [`DELETE FROM opportunity_catalog.${table}`,`TRUNCATE opportunity_catalog.${table}`,`UPDATE opportunity_catalog.${table} SET requested_by=requested_by`])await assert.rejects(pool.query(sql));
   const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_catalog_reader');await assert.rejects(c.query(`SELECT * FROM opportunity_catalog.${table}`),{code:'42501'});}finally{await c.query('ROLLBACK');c.release();}
  }
 });
 await check('REVOKED_SESSION_CANNOT_CREATE_PREVIEW',async()=>{
  const revokedSession=randomUUID();
  await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at,revoked_at) SELECT $1,id,'REVOKED',session_revocation_version,now(),now(),now()+interval '1 hour',now() FROM public.global_user WHERE id=$2",[revokedSession,userId]);
  await assert.rejects(runtime.preview({userId,sessionId:revokedSession,requestId,previewRequestId:randomUUID(),sheetName:receipt.sheets[0]}),{code:'C4G_ADMIN_REQUIRED'});
  assert.equal(await count('opportunity_catalog.pt2030_plan_preview'),1);
 });
 await check('CATALOG_READ_NORMAL_LOGIN_AFTER_049',async()=>{
  await pool.query(`CREATE ROLE gcni_import_gate_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${connection.password}'`);
  await pool.query('GRANT c4g_catalog_projection_reader TO gcni_import_gate_reader WITH INHERIT FALSE,SET TRUE');
  const reader=new (require('../../../backend/node_modules/pg').Pool)({...connection,database:'central_import_gate',user:'gcni_import_gate_reader',max:1});
  const c=await reader.connect();try{
   await c.query('BEGIN READ ONLY');
   await require('../../../backend/src/opportunities/catalogRead/readSchema').admitReader(c);
   await c.query('SET LOCAL ROLE c4g_catalog_projection_reader');
   await c.query('SELECT * FROM catalog_read.current_generation');
   await assert.rejects(c.query('SELECT * FROM opportunity_catalog.pt2030_document_upload'),{code:'42501'});
  }finally{await c.query('ROLLBACK');c.release();await reader.end();}
 });

};
