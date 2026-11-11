'use strict';
// Execute only after the user authorizes the source, cap and disposable target.
const {Pool}=require('../../../backend/node_modules/pg'),{randomUUID}=require('node:crypto');
async function main(){
 const target=new URL(process.env.CENTRAL_DATABASE_URL);
 if(process.env.FUNDING_TENDERS_REHEARSAL_APPROVED!=='five-public-records'||target.hostname!=='127.0.0.1'||target.port!=='5560'||target.pathname!=='/funding_live_rehearsal')throw Error('REHEARSAL_AUTHORIZATION_REQUIRED');
 const pool=new Pool({connectionString:target.toString()});let runtime;
 try{
  for(const role of ['c4g_central_owner','c4g_central_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrations(pool);
  const admin=randomUUID();await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Local rehearsal administrator','rehearsal@example.invalid','ACTIVE')",[admin]);
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin]);
  const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');const installer=new PgBoss({connectionString:target.toString(),supervise:false,schedule:false});await installer.start();try{await installer.createQueue('funding-tenders-refresh',{retryLimit:0})}finally{await installer.stop()}
  const repository=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool});
  runtime=await require('../../../backend/src/config/fundingTendersWorker').loadFundingTendersWorker();
  await repository.enqueue(admin,randomUUID());await runtime.runOnce();
  const run=(await repository.status(admin)).lastRun,listing=await repository.list();
  if(listing.items.length>5)throw Error('REHEARSAL_LIMIT_EXCEEDED');
  for(const item of listing.items)await repository.get(item.opportunityId);
  console.log(JSON.stringify({source:'EU_FUNDING_TENDERS',destination:'localhost:5560/funding_live_rehearsal',status:run.status,created:run.created,updated:run.updated,failed:run.failed,listed:listing.items.length,errorCode:run.errorCode}));
  if(run.status!=='SUCCESS')throw Error('REHEARSAL_NOT_SUCCESSFUL');
 }finally{await runtime?.shutdown();await pool.end()}
}
main().catch(()=>{console.error('Funding rehearsal did not complete. Inspect sanitized counters; credentials are never printed.');process.exitCode=1});
