'use strict';
const assert=require('node:assert/strict'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const express=require('../../../backend/node_modules/express'),session=require('../../../backend/node_modules/express-session');
const PgStore=require('../../../backend/node_modules/connect-pg-simple')(session),signature=require('../../../backend/node_modules/cookie-signature');
const {Pool}=require('../../../backend/node_modules/pg');
const {createReadService}=require('../../../backend/src/opportunities/catalogRead/readService');
const {createReadRouter}=require('../../../backend/src/opportunities/catalogRead/readHttp');
const {createReadRepository}=require('../../../backend/src/opportunities/catalogRead/readRepository');
const {createPgReadAuthority}=require('../../../backend/src/opportunities/catalogRead/readAuthority');
const {admitReader}=require('../../../backend/src/opportunities/catalogRead/readSchema');
const {validate}=require('../../../backend/src/opportunities/catalogRead/contractValidation');
const {buildProjection,emptyExtension}=require('../../../backend/src/opportunities/catalogRead/model');
const {contentDigestV2}=require('../../../backend/src/opportunities/v2/digests');
const {createReadRuntime}=require('../../../backend/src/opportunities/catalogRead/readRuntime');
const source=require('./snapshot-v2.json');
const policyVersion='catalog-read-isolated-policy-v1';
async function mutation(pool,actor,sql,values){
 const keys=['POLICY','SESSION:'+createHash('sha256').update(actor.sid).digest('hex'),'SUBJECT:'+actor.id,'MEMBER:'+actor.membershipId,'ORG:'+actor.organizationId].sort(),requestId=randomUUID(),c=await pool.connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(43001306,1)');
  await c.query("INSERT INTO public.authority_write_request(request_id,scope_keys,epoch,state,deadline) VALUES($1,$2,nextval('public.authority_epoch_seq'),'WAITING',clock_timestamp()+interval '30 seconds')",[requestId,keys]);
  await c.query("INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'REGISTER' FROM public.authority_write_request WHERE request_id=$1",[requestId]);
  await c.query('INSERT INTO public.authority_scope_epoch(scope_key,epoch) SELECT key,r.epoch FROM public.authority_write_request r CROSS JOIN unnest(r.scope_keys) AS key WHERE request_id=$1 ON CONFLICT(scope_key) DO UPDATE SET epoch=EXCLUDED.epoch',[requestId]);
  await c.query('DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()');
  await c.query("INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'APPLY' FROM public.authority_write_request WHERE request_id=$1",[requestId]);
  await c.query(sql,values);await c.query("UPDATE public.authority_write_request SET state='APPLIED',finished_at=clock_timestamp() WHERE request_id=$1",[requestId]);await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()');await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function seedActor(pool){const a={id:randomUUID(),organizationId:randomUUID(),membershipId:randomUUID(),sid:'read-isolated-'+randomUUID()};
 await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic read member',$2,'ACTIVE')",[a.id,a.id+'@example.invalid']);
 await pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Synthetic read institution','Synthetic read institution',$2,'UNIVERSITY','ACTIVE','EUR','OPTIONAL')",[a.organizationId,'read-'+a.organizationId]);
 await pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at,valid_from) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE','2026-01-01','2026-01-01')",[a.membershipId,a.id,a.organizationId]);
 const expires=new Date('2030-01-01');const sess={cookie:{expires:expires.toISOString(),originalMaxAge:3600000,httpOnly:true,path:'/',sameSite:'lax'},auth:{user:{id:a.id},policyVersion,revocationVersion:1,absoluteExpiresAt:expires.getTime(),identity:{issuer:'https://identity.example.invalid/isolated',subject:a.id},evidence:{policyVersion}}};
 await pool.query('INSERT INTO public.application_session_store(sid,sess,expire) VALUES($1,$2,$3)',[a.sid,sess,expires]);
 await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at,selected_organization_id,selected_membership_id,selected_membership_version) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),$3,$4,$5,1)",[a.sid,a.id,expires,a.organizationId,a.membershipId]);return a;
}
async function run({pool,settings,config,check,writer,approve,insertExt,insertProjection}){
 let now=Date.parse('2027-01-20T12:00:00.000Z');const generation=randomUUID();
 await check('READ_FIXTURE_27_APPROVED_OPPORTUNITIES',async()=>{
  await writer(c=>c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,27)',[generation,new Date(now)]));
  for(let i=0;i<27;i++){
   const s=structuredClone(source);s.description.title.value='Energia sintética '+String(i).padStart(2,'0');const opportunityId=randomUUID(),revisionId=randomUUID(),e=emptyExtension(s,{opportunityId,revisionId,extensionId:randomUUID(),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T11:00:00.000Z'}),p=buildProjection(s,e,{asOf:new Date(now).toISOString()});
   const c=await pool.connect();try{await c.query('BEGIN');await c.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,content_digest,normalization_version,quality_rule_version,current_schema_version) VALUES($1,$2,1,1,'ACTIVE','VALIDATED_MANUAL','Synthetic read',$3,'opportunity-normalization-v2','opportunity-quality-v2.0',2)",[opportunityId,revisionId,contentDigestV2(s)]);await c.query('INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,$4,$5,$6)',[revisionId,opportunityId,s,{synthetic:true},{synthetic:true},contentDigestV2(s)]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   await writer(c=>insertExt(c,e));await approve(p);await writer(async c=>{await insertProjection(c,p);await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[generation,opportunityId,revisionId,p.projectionId]);});
  }
  await writer(async c=>{await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[generation]);await c.query('UPDATE catalog_read.active_generation SET generation_id=$1',[generation]);});
 });
 const actor=await seedActor(pool),other=await seedActor(pool),login='gcni_http_reader',authorityLogin='gcni_http_authority';let readPool,authorityConnections,server,store,loadResult;
 try{
  await pool.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${config.password}'`);await pool.query(`GRANT c4g_catalog_projection_reader TO ${login} WITH INHERIT FALSE, SET TRUE`);
  readPool=new Pool({...settings,database:config.database,user:login,max:2});
  await pool.query(`CREATE ROLE ${authorityLogin} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${config.password}'`);await pool.query(`GRANT c4g_catalog_projection_membership TO ${authorityLogin} WITH INHERIT FALSE, SET TRUE`);
  authorityConnections=new Pool({...settings,database:config.database,user:authorityLogin,max:2});
  const admit=c=>admitReader(c,{authorityLogin});
  await check('READ_SCHEMA_DEDICATED_LOGIN_ADMISSION',async()=>{const c=await readPool.connect();try{await c.query('BEGIN READ ONLY');await admit(c);}finally{await c.query('ROLLBACK');c.release();}});
  await check('MEMBERSHIP_READER_HAS_NO_WRITE_OR_PROFILE_ACCESS',async()=>{
   for(const sql of ['SELECT primary_email FROM public.global_user',"UPDATE public.organization_membership SET status='SUSPENDED'",'SELECT * FROM catalog_read.revision_projection']){
    const c=await authorityConnections.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_catalog_projection_membership');await assert.rejects(c.query(sql),{code:'42501'});}finally{await c.query('ROLLBACK');c.release();}
   }
  });
  const runtime=createReadRuntime({express,catalogPool:readPool,authorityPool:authorityConnections,authorityLogin,policyVersion,key:randomBytes(32),clock:()=>now});
  const secret=randomBytes(48).toString('base64url');store=new PgStore({pool,schemaName:'public',tableName:'application_session_store',createTableIfMissing:false,pruneSessionInterval:false,disableTouch:true});
  const app=express();app.disable('etag');if(config.loadAcceptance)app.use((req,res,next)=>{const start=performance.now(),write=res.writeHead;res.writeHead=function(...args){res.setHeader('Server-Timing',`catalog;dur=${(performance.now()-start).toFixed(3)}`);return write.apply(this,args)};next()});app.use(session({secret,name:'gcni-read-test',store,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:false}}));app.use('/api/catalog-read/v1',runtime.router);
  const ui = config.uiReviewDirectory ? await require('./ui-review.cjs').prepare({app,express,pool,secret,seedActor,mutation,directory:config.uiReviewDirectory,setClock:value=>{now=value;}}) : null;
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port+'/api/catalog-read/v1';
  const get=async(path,query={},a=actor)=>{const response=await fetch(base+path+'?'+new URLSearchParams(query),{signal:AbortSignal.timeout(30000),headers:a?{cookie:'gcni-read-test='+encodeURIComponent('s:'+signature.sign(a.sid,secret))}:{}});return {status:response.status,body:await response.json(),headers:response.headers};};
  if(ui) await ui.run(server.address().port);
  let first;
  await check('HTTP_SIGNED_SESSION_MEMBERSHIP_AND_PAGE_CONTRACT',async()=>{
   assert.equal((await get('/opportunities',{},null)).status,401);first=await get('/opportunities',{sort:'title'});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.data.length,25);assert.equal(validate('ListResponse',first.body).valid,true);assert.equal(first.headers.get('cache-control'),'private, no-store');assert.equal(first.headers.get('etag'),null);
   const second=await get('/opportunities',{sort:'title',snapshot:first.body.meta.snapshot,cursor:first.body.page.nextCursor});assert.equal(second.status,200);assert.equal(second.body.data.length,2);assert.equal(new Set([...first.body.data,...second.body.data].map(r=>r.id)).size,27);
  });
  await check('HTTP_DETAIL_COLLECTIONS_OPTIONS_AND_CROSS_SCOPE_DENIAL',async()=>{
   const snapshot=first.body.meta.snapshot,id=first.body.data[0].id;assert.equal((await get('/opportunities',{snapshot},other)).status,403);
   const detail=await get('/opportunities/'+id,{snapshot});assert.equal(detail.status,200);assert.deepEqual(detail.body.data.summary,first.body.data[0]);
   for(const name of ['windows','funding','funding-rules','documents','conflicts','relationships','history','evidence'])assert.equal((await get('/opportunities/'+id+'/'+name,{snapshot})).status,200,name);
   assert.equal((await get('/options',{dimension:'programme',snapshot})).status,200);
   assert.equal((await get('/opportunities',{organizationId:other.organizationId})).status,400);
  });
  await check('HTTP_GETS_DO_NOT_MUTATE_CATALOG_OR_SESSION',async()=>{
   const before=(await pool.query('SELECT row_to_json(a) AS data FROM public.application_session a WHERE sid=$1',[actor.sid])).rows[0];
   const counts=async()=> (await pool.query('SELECT (SELECT count(*) FROM catalog_read.revision_projection)::int AS projections,(SELECT count(*) FROM catalog_read.generation)::int AS generations,(SELECT count(*) FROM public.application_session_store)::int AS sessions')).rows[0];const c=await counts();await get('/opportunities');assert.deepEqual(await counts(),c);assert.deepEqual((await pool.query('SELECT row_to_json(a) AS data FROM public.application_session a WHERE sid=$1',[actor.sid])).rows[0],before);
  });
  await check('HTTP_SNAPSHOT_RETAINS_OLD_GENERATION_AFTER_PUBLICATION',async()=>{
   const empty=randomUUID();await writer(async c=>{await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,0)',[empty,new Date(now)]);await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[empty]);await c.query('UPDATE catalog_read.active_generation SET generation_id=$1',[empty]);});
   const retained=await get('/opportunities',{sort:'title',snapshot:first.body.meta.snapshot,cursor:first.body.page.nextCursor});assert.equal(retained.status,200);assert.equal(retained.body.data.length,2);
   const fresh=await get('/opportunities');assert.equal(fresh.status,200);assert.equal(fresh.body.data.length,0);assert.equal(fresh.body.meta.generationId,empty);
  });
  await check('HTTP_ABSOLUTE_EXPIRY_AND_CURRENT_AUTHORITY_REVOCATION',async()=>{
   now+=900000;assert.equal((await get('/opportunities',{snapshot:first.body.meta.snapshot})).status,410);now-=900000;
   await mutation(pool,actor,"UPDATE public.organization_membership SET status='SUSPENDED',suspended_at=clock_timestamp(),status_reason='Isolated revocation test',membership_version=membership_version+1 WHERE id=$1",[actor.membershipId]);assert.equal((await get('/opportunities',{snapshot:first.body.meta.snapshot})).status,403);
   assert.equal((await get('/opportunities',{},other)).status,200);
  });
  await check('HTTP_SCHEMA_DRIFT_FAILS_CLOSED',async()=>{
   await pool.query('GRANT UPDATE ON catalog_read.revision_projection TO c4g_catalog_projection_reader');try{assert.equal((await get('/opportunities',{},other)).status,503);}finally{await pool.query('REVOKE UPDATE ON catalog_read.revision_projection FROM c4g_catalog_projection_reader');}
  });
  if(config.loadAcceptance)loadResult=await require('./load-proof.cjs').run({pool,get,actor:other});
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store?.close?.();if(readPool)await readPool.end();if(authorityConnections)await authorityConnections.end();await pool.query('DROP ROLE IF EXISTS '+login);await pool.query('DROP ROLE IF EXISTS '+authorityLogin);}
 return loadResult;
}
module.exports={run};
