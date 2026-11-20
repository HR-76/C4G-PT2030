 'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const manifest=require('../../../backend/src/security/centralMigrationManifest');
const runner=require('../../../backend/scripts/runCentralMigrations');
async function run({pool,port,base}) {
 if(process.argv.includes('--user-deletion')&&process.argv.includes('--staging'))throw Error('UNREHEARSED_VARIANT_COMBINATION');
 await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
 await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
 await runner.applyCentralMigrationsWithManifest(pool,manifest.centralImportManifest,manifest.migrationSql);
 await runner.applyRegisteredBillingPdfsPackage(pool,'billing-private-documents-v1');
 await runner.applyRegisteredEmailTemplatesPackage(pool,'email-templates-v1');
 await runner.applyRegisteredCentralRuntimeReadPackage(pool,'central-runtime-read-v1');
 if(process.argv.includes('--staging')) {
  for(const login of ['c4g_central_staging_api','c4g_central_staging_worker']) {
   await pool.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-gate-only'`);
   await pool.query(`GRANT c4g_central_runtime TO ${login} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE`);
   await pool.query(`GRANT CONNECT ON DATABASE postgres TO ${login}`);
  }
  process.env.C4G_STAGING_CENTRAL_RUNTIME_LOGINS='admitted-v1';
 }
 await runner.applyRegisteredOpportunityComplementPackage(pool,'opportunity-complement-v1');
 if(process.argv.includes('--user-deletion')) {
  await pool.query(require('../../../backend/src/platformOnboarding/memberEmailSecurityPackage').load().sql);
  await require('../../../backend/scripts/staging/userDeletionRollout').rollout(pool,{mode:'apply',expectedDatabase:'postgres'});
 }
 if(process.argv.includes('--calibrate')) await pool.query(manifest.canonicalizeMigrationSql(fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates/billing_account_validation.up.sql'),'utf8')));
 else {
  await runner.applyRegisteredBillingValidationPackage(pool,'billing-account-validation-v1');
  assert.deepEqual(await runner.applyRegisteredBillingValidationPackage(pool,'billing-account-validation-v1'),[]);
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool)).currentVersion,'054_billing_account_validation');
  await require('../../../backend/src/security/authoritySecurityManifest').assertAuthoritySecurity(pool,'054_billing_account_validation');
  await require('../../../backend/src/security/catalogReaderSchema').assertCatalogReaderSchema(pool);
 }
 const schema=require('../../../backend/src/security/centralSchemaManifest');
 const security=require('../../../backend/src/security/authoritySecurityManifest');
 const pins={upChecksum:manifest.migrationChecksumPolicy(fs.readFileSync(path.resolve(__dirname,'../../../backend/database/central/candidates/billing_account_validation.up.sql'),'utf8')).checksum,schemaFingerprint:schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool,{compactAuthority:true})),authoritySecurityFingerprint:security.digest(await security.authoritySecuritySnapshot(pool))};
 fs.writeFileSync(path.join(base,'fingerprints.json'),JSON.stringify(pins,null,2));
 console.log(JSON.stringify(pins));
 const {ids,sessions}=await require('./fixtures.cjs').fixtures(pool);
 const account=randomUUID(),version=randomUUID(),nextVersion=randomUUID(),requestId=randomUUID(),key=randomUUID();
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO public.billing_account(id,organization_id) VALUES($1,$2)',[account,ids.orgA]);
  await c.query("INSERT INTO public.billing_account_version(id,billing_account_id,organization_id,version,legal_name,tax_country,tax_identifier,address_line_1,postal_code,locality,billing_email,payment_terms_days,created_by) VALUES($1,$2,$3,1,'Synthetic entity','PT','501234567','Rua teste','4000-001','Porto','billing@example.invalid',30,$4)",[version,account,ids.orgA,ids.admin]);
  await c.query('COMMIT');
 } catch(e) {await c.query('ROLLBACK');throw e} finally {c.release()}
 const runtime=new Pool({host:'127.0.0.1',port,user:'c4g_f12_admin',database:'postgres',options:'-c role=c4g_central_runtime'});
 const deliveryPool=new Pool({host:'127.0.0.1',port,user:'c4g_f12_admin',database:'postgres',options:'-c role=c4g_billing_validation_worker'});
 const claim=async()=> (await deliveryPool.query('SELECT public.billing_validation_email_claim() AS value')).rows[0].value;
 const request=(who='admin',org=ids.orgA,v=version,k=key)=>runtime.query('SELECT public.billing_validation_request($1,$2,$3,$4,$5,$6) AS id',[sessions[who],ids[who],org,v,k,requestId]);
 const confirm=(who='orgAdminA',org=ids.orgA,v=version)=>runtime.query('SELECT public.billing_validation_confirm($1,$2,$3,$4,$5) AS id',[sessions[who],ids[who],org,requestId,v]);
 try {
  await assert.rejects(()=>request('outsider'),/C4G_ADMIN_REQUIRED/);
  await assert.rejects(()=>request('orgAdminA'),/C4G_ADMIN_REQUIRED/);
  const concurrent=await Promise.all([request(),request()]);
  assert.deepEqual(concurrent.map(item=>item.rows[0].id),[requestId,requestId]);
  assert.equal((await request('admin',ids.orgA,version,randomUUID())).rows[0].id,requestId);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.billing_account_validation_email')).rows[0].n,1);
  const read=async(who,org,admin)=>(await runtime.query('SELECT public.billing_validation_read($1,$2,$3,$4) AS value',[sessions[who],ids[who],org,admin])).rows[0].value;
  const visible=await read('orgAdminA',ids.orgA,false);
  assert.equal(visible.status,'PENDING');assert.equal(visible.versionId,version);assert.equal(visible.account.notes,undefined);
  await assert.rejects(()=>read('orgAdminB',ids.orgA,false),/NOT_AUTHORIZED/);
  await assert.rejects(()=>read('contributorA',ids.orgA,false),/NOT_AUTHORIZED/);
  await assert.rejects(()=>runtime.query('SELECT public.billing_validation_email_claim()'),/permission denied/);
  const firstDelivery=await claim();assert.equal(firstDelivery.organizationId,ids.orgA);
  assert.equal(await claim(),null,'leased delivery cannot be claimed twice');
  assert.equal((await deliveryPool.query('SELECT public.billing_validation_email_finish($1,$2,false) AS ok',[firstDelivery.id,randomUUID()])).rows[0].ok,false);
  await deliveryPool.query('SELECT public.billing_validation_email_finish($1,$2,false)',[firstDelivery.id,firstDelivery.token]);
  await pool.query("UPDATE public.billing_account_validation_email SET available_at=clock_timestamp() WHERE id=$1",[firstDelivery.id]);
  const retry=await claim();assert.equal(retry.id,firstDelivery.id);assert.notEqual(retry.token,firstDelivery.token);
  await deliveryPool.query('SELECT public.billing_validation_email_finish($1,$2,true)',[retry.id,retry.token]);
  assert.equal((await read('admin',ids.orgA,true)).email.accepted,1);
  await assert.rejects(()=>confirm('orgAdminB'),/NOT_AUTHORIZED/);
  await assert.rejects(()=>confirm('contributorA'),/NOT_AUTHORIZED/);
  await assert.rejects(()=>confirm('orgAdminB',ids.orgB),/RESOURCE_NOT_AVAILABLE/);
  await assert.rejects(()=>confirm('admin'),/NOT_AUTHORIZED/);
  assert.equal((await confirm()).rows[0].id,requestId);
  await Promise.all([confirm(),confirm()]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.billing_account_validation_confirmation')).rows[0].n,1);
  assert.equal((await read('admin',ids.orgA,true)).status,'CONFIRMED');
  await assert.rejects(()=>runtime.query('DELETE FROM public.billing_account_validation_confirmation'),/permission denied/);
  await pool.query("SET session_replication_role='replica'");
  await pool.query("INSERT INTO public.billing_account_version(id,billing_account_id,organization_id,version,legal_name,tax_country,tax_identifier,address_line_1,postal_code,locality,billing_email,payment_terms_days,created_by) SELECT $1,billing_account_id,organization_id,2,legal_name,tax_country,tax_identifier,'Nova rua',postal_code,locality,billing_email,payment_terms_days,created_by FROM public.billing_account_version WHERE id=$2",[nextVersion,version]);
  await pool.query('UPDATE public.billing_account SET current_version=2,revision=2 WHERE id=$1',[account]);
  await pool.query("SET session_replication_role='origin'");
  await assert.rejects(()=>confirm(),/STALE_REVISION/);
  await assert.rejects(()=>confirm('orgAdminA',ids.orgA,nextVersion),/STALE_REVISION/);
  await assert.rejects(()=>request('admin',ids.orgA,nextVersion),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>request('admin',ids.orgA,version,randomUUID()),/STALE_REVISION/);
  assert.equal((await read('admin',ids.orgA,true)).status,'OUTDATED');
  await runtime.query('SELECT public.billing_validation_request($1,$2,$3,$4,$5,$6)',[sessions.admin,ids.admin,ids.orgA,nextVersion,randomUUID(),randomUUID()]);
  await pool.query("SET session_replication_role='replica'");
  await pool.query("UPDATE public.organization_membership SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE global_user_id=$1",[ids.orgAdminA]);
  await pool.query("SET session_replication_role='origin'");
  await assert.rejects(()=>confirm(),/NOT_AUTHORIZED/);
  assert.deepEqual(await claim(),{skipped:true},'revoked recipient is cancelled before delivery');
  assert.equal(await claim(),null);
 } finally {await runtime.end();await deliveryPool.end()}
}
module.exports={run};
