'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path');
const {centralAuthorityFixture}=require('../f13/central-authority-fixture');
const {createPlatformLogs}=require('../../../backend/src/platformDirectory/logs');
const {createPlatformDirectory}=require('../../../backend/src/platformDirectory/service');
async function main(){
 const url=new URL(process.env.F13_S2_ADMIN_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5599');
 const central=await centralAuthorityFixture(url.toString()),{pool}=central,checks=[];
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name)};
 try{
  const admin=await central.user(randomUUID(),randomUUID(),randomUUID()),logs=createPlatformLogs({pool}),service=createPlatformDirectory({pool,logs});
  await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin.id]);
  await check('actual login only, sanitized failure and no session/step-up entries',async()=>{
   for(const event of ['authentication.login_succeeded','authentication.step_up_succeeded','authentication.logout','authentication.callback_failed'])logs.audit(event,{globalUserId:admin.id,password:'NEVER_STORE',reason:'NEVER_STORE',sessionId:'NEVER_STORE'});
   await logs.flush();const result=await service.logs({},admin.request);assert.equal(result.total,2);assert(result.activatedAt);assert.equal(result.items.filter(r=>r.type==='LOGIN').length,1);assert(!JSON.stringify(result).includes('NEVER_STORE'));assert(result.items.every(r=>r.email===admin.id+'@example.invalid'));
  });
  await check('HTTP final errors, unknown user and no response/body/URL capture',async()=>{
   for(const statusCode of [200,400,401,500,503]){const res=new EventEmitter();res.statusCode=statusCode;logs.middleware({path:'/private/NEVER_STORE',body:{password:'NEVER_STORE'}},res,()=>{});res.emit('finish');res.emit('finish')}
   await logs.flush();const r=await service.logs({type:'ERROR'},admin.request);assert.equal(r.total,3);assert.equal(r.items.filter(i=>i.name===null).length,2);assert(!JSON.stringify(r).includes('NEVER_STORE'));
  });
  await check('all entity profiles, anonymous and stale sessions denied',async()=>{
   assert.deepEqual(await service.importAvailability({},admin.request),{available:false,code:'CENTRAL_IMPORT_NOT_CONFIGURED'});
   await assert.rejects(()=>service.importAvailability({},{}),{code:'C4G_ADMIN_REQUIRED'});
   for(const profileCode of ['ORG_ADMIN','FUNDING_MANAGER','CONTRIBUTOR']){const other=await central.user(randomUUID(),randomUUID(),randomUUID(),null,null,{profileCode});await assert.rejects(()=>service.logs({},other.request),{code:'C4G_ADMIN_REQUIRED'});await assert.rejects(()=>service.importAvailability({},other.request),{code:'C4G_ADMIN_REQUIRED'})}
   await assert.rejects(()=>service.logs({},{}),{code:'C4G_ADMIN_REQUIRED'});await assert.rejects(()=>service.logs({},{...admin.request,sessionID:'forged'}),{code:'C4G_ADMIN_REQUIRED'});
  });
  await check('bounded query, filters and stable pagination across restart',async()=>{
   for(let i=0;i<55;i++)logs.audit('authentication.login_succeeded',{globalUserId:admin.id});await logs.flush();
   const restarted=createPlatformDirectory({pool,logs:createPlatformLogs({pool})}),a=await restarted.logs({q:admin.id,type:'LOGIN'},admin.request),b=await restarted.logs({q:admin.id,type:'LOGIN',page:'2'},admin.request),c=await restarted.logs({q:admin.id,type:'LOGIN',page:'3'},admin.request),d=await restarted.logs({q:admin.id,type:'LOGIN',page:'4'},admin.request);
   assert.equal(a.total,56);assert.equal(a.pageSize,15);assert.deepEqual([a.items.length,b.items.length,c.items.length,d.items.length],[15,15,15,11]);assert.equal(new Set([...a.items,...b.items,...c.items,...d.items].map(r=>r.id)).size,56);
   for(const input of [{page:'-1'},{type:'secret'},{q:[]},{q:'x'.repeat(151)},{sql:'x'}])await assert.rejects(()=>service.logs(input,admin.request),{code:'INVALID_INPUT'});
  });
  await check('runtime can insert but cannot change or delete history',async()=>{
   const c=await pool.connect();try{await c.query('SET ROLE c4g_central_runtime');await c.query("INSERT INTO public.platform_support_event(code) VALUES('AUTH_ERROR')");for(const sql of ['DELETE FROM public.platform_support_event','UPDATE public.platform_support_event SET code=code','TRUNCATE public.platform_support_event'])await assert.rejects(()=>c.query(sql),{code:'42501'});}finally{await c.query('RESET ROLE');c.release()}
  });
  await check('collection outage explicit without blocking login',async()=>{
   const broken=createPlatformLogs({pool:{query(){throw Error('NEVER_STORE')}},onFailure(){throw Error('observer broken')}});assert.doesNotThrow(()=>broken.audit('authentication.login_succeeded',{globalUserId:admin.id}));await broken.flush();assert.equal(broken.status().failedEvents,1);
  });
  await check('dashboard counts canonical records, isolates private data and refuses entity accounts',async()=>{
   const c=await pool.connect();try{await c.query('BEGIN');for(const state of ['ACTIVE','STALE','DRAFT','ARCHIVED']){const id=randomUUID(),revision=randomUUID();await c.query(`INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version) VALUES($1,$2,1,1,$3,'PENDING_REVIEW','Synthetic','Synthetic',0,'LOW',$4,'opportunity-normalization-v1','opportunity-quality-v1')`,[id,revision,state,'a'.repeat(64)]);await c.query(`INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,'{}','{}','{}',$3)`,[revision,id,'a'.repeat(64)])}await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
   const d=await service.dashboard({},admin.request);assert.deepEqual(d.entities,{total:4,active:4});assert.deepEqual(d.users,{total:4,active:4});assert.deepEqual(d.opportunities,{total:4,active:1,stale:1,draft:1,archived:1});assert.deepEqual(d.activity,{users30:1,logins30:56,errors24:4});assert.equal(d.recentEntities.length,4);assert(d.coverageStart);assert(d.observedAt);
   assert.equal((await createPlatformDirectory({pool}).dashboard({},admin.request)).activity,null);
   for(const request of [{},(await central.user(randomUUID(),randomUUID(),randomUUID())).request])await assert.rejects(()=>service.dashboard({},request),{code:'C4G_ADMIN_REQUIRED'});
   await assert.rejects(()=>service.dashboard({organizationId:randomUUID()},admin.request),{code:'INVALID_INPUT'});
  });
  await check('dashboard authority rechecked after metrics before returning',async()=>{
   const wrapped={async connect(){const c=await pool.connect();return{release:()=>c.release(),async query(sql,args){const result=await c.query(sql,args);if(sql.startsWith('SELECT now()'))await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin.id]);return result}}}};
   await assert.rejects(()=>createPlatformDirectory({pool:wrapped,logs}).dashboard({},admin.request),{code:'C4G_ADMIN_REQUIRED'});
   await pool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE global_user_id=$1",[admin.id]);
  });
  await check('authority rechecked after reading; revoked admin receives no rows',async()=>{
   const wrapped={async connect(){const c=await pool.connect();return{release:()=>c.release(),async query(sql,args){const result=await c.query(sql,args);if(sql.startsWith('SELECT applied_at'))await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE global_user_id=$1",[admin.id]);return result}}}};
   await assert.rejects(()=>createPlatformDirectory({pool:wrapped,logs}).logs({},admin.request),{code:'C4G_ADMIN_REQUIRED'});
  });
  const out=path.resolve(__dirname,'../../../output/playwright/c4g-logs');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'service-verification.json'),JSON.stringify({result:'PASS',checks},null,2));
 }finally{await central.close()}
}
main().catch(e=>{console.error('LOGS_GATE_FAILED',e.code||e.name,e.message);process.exitCode=1});
