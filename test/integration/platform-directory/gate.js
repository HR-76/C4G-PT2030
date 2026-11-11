'use strict';
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {centralAuthorityFixture}=require('../f13/central-authority-fixture');
const {createPlatformDirectory}=require('../../../backend/src/platformDirectory/service');
async function main(){
 const url=new URL(process.env.PLATFORM_DIRECTORY_TEST_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5594');
 const central=await centralAuthorityFixture(url.toString()),checks=[];let server;
 const check=name=>{checks.push(name);console.log('PASS '+name);};
 try{
  const adminId=randomUUID(),sid=randomUUID(),assignment=randomUUID();
  await central.pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Platform Admin','admin@example.invalid','ACTIVE')",[adminId]);
  await central.pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[assignment,adminId]);
  await central.registry.rotateSession({sid,globalUserId:adminId,revocationVersion:1,expiresAt:Date.now()+3600000});
  const request={sessionID:sid,authContext:{sessionId:sid},user:{id:adminId}};
  const a=randomUUID(),b=randomUUID(),person=randomUUID(),other=randomUUID();
  const member=await central.user(a,person,randomUUID(),null,null,{profileCode:'ORG_ADMIN',displayName:'Ana Shared'});
  const technician=await central.user(b,other,randomUUID(),null,null,{profileCode:'CONTRIBUTOR',displayName:'Technician'});
  const manager=await central.user(b,randomUUID(),randomUUID(),null,null,{profileCode:'FUNDING_MANAGER'});
  await central.pool.query("UPDATE public.organization SET display_name=CASE WHEN id=$1 THEN 'Alpha' ELSE 'Beta' END",[a]);
  await central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at,valid_from) VALUES($1,$2,$3,'VIEWER','ACTIVE',clock_timestamp(),clock_timestamp()+interval '1 day')",[randomUUID(),person,b]);
  const service=createPlatformDirectory({pool:central.pool});
  const before=async()=>{let rows=[];for(const t of ['organization','global_user','organization_membership','authority_f5_state'])rows.push((await central.pool.query(`SELECT to_jsonb(t)::text row FROM public.${t} t ORDER BY to_jsonb(t)::text`)).rows);return createHash('sha256').update(JSON.stringify(rows)).digest('hex');};
  const digest=await before();
  const entities=await service.entities({},request);assert.equal(entities.total,2);assert.equal(entities.items.find(o=>o.id===a).activeAccounts,1);assert.equal(entities.items.find(o=>o.id===b).activeAccounts,2);
  assert.equal((await service.entities({q:'ALPHA'},request)).items[0].id,a);assert.equal((await service.entity(a,request)).name,'Alpha');
  const people=await service.users({q:'ana'},request);assert.equal(people.total,1);assert.equal(people.items[0].memberships.length,2);assert.equal(people.items[0].memberships.find(m=>m.organizationId===b).effective,false);
  const admins=await service.users({q:'admin@example.invalid'},request);assert.deepEqual(admins.items[0].memberships,[]);assert.deepEqual(admins.items[0].platformRoles,['C4G_ADMIN']);
  assert.equal((await service.users({organizationId:a},request)).total,1);assert.equal(await before(),digest);check('real Central entities, shared accounts, effective access, search and no writes');
  for(const r of [member.request,technician.request,manager.request,{...member.request,user:{id:person,platformRoles:['C4G_ADMIN']}}])await assert.rejects(()=>service.users({},r),e=>e.code==='C4G_ADMIN_REQUIRED');check('entity admin manager technician and forged platform claim denied');
  for(const [sessionStatus,version,expires] of [['REVOKED',1,Date.now()+60000],['ACTIVE',2,Date.now()+60000],['ACTIVE',1,Date.now()-60000]]){
   const invalidSid=randomUUID();await central.pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at,revoked_at) VALUES($1,$2,$3,$4,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours',$5,CASE WHEN $3='REVOKED' THEN clock_timestamp() ELSE NULL END)",[invalidSid,adminId,sessionStatus,version,new Date(expires)]);
   await assert.rejects(()=>service.entities({},{...request,sessionID:invalidSid,authContext:{sessionId:invalidSid}}),e=>e.code==='C4G_ADMIN_REQUIRED');
  }check('revoked expired and stale-version sessions denied');
  let revoked=false;const pool={async connect(){const c=await central.pool.connect();return {release:()=>c.release(),async query(sql,values){const result=await c.query(sql,values);if(sql.includes('ORDER BY o.display_name,o.id LIMIT')&&!revoked){revoked=true;await central.pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE id=$1",[assignment]);}return result;}};}};
  await assert.rejects(()=>createPlatformDirectory({pool}).entities({},request),e=>e.code==='C4G_ADMIN_REQUIRED');await central.pool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE id=$1",[assignment]);check('C4G revocation during a read prevents returning the result');
  const express=require('../../../backend/node_modules/express'),app=express();app.use(express.json());
  app.use('/directory',require('../../../backend/src/routes/platformDirectoryRoutes').createPlatformDirectoryRouter({express,service,authenticate:(req,res,next)=>{const r={admin:request,member:member.request}[req.get('X-Test-Session')];if(!r)return res.sendStatus(401);Object.assign(req,r);next();}}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
  const http=(route,session='admin',method='GET')=>fetch(origin+'/directory'+route,{method,headers:{'X-Test-Session':session}});
  assert.equal((await http('/entities','none')).status,401);assert.equal((await http('/users','member')).status,403);assert.equal((await http('/users?q[x]=a')).status,400);assert.equal((await http('/entities','admin','POST')).status,405);
  const response=await http('/users');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const text=JSON.stringify(await response.json());for(const key of ['password','subject','issuer','session','credential','database'])assert(!text.includes('"'+key+'"'));check('HTTP session boundary, closed filters, no-store and safe projections');
  for(let n=0;n<55;n++)await central.pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE')",[randomUUID(),'Paged '+String(n).padStart(2,'0'),'paged'+n+'@example.invalid']);
  const first=await service.users({q:'Paged'},request),second=await service.users({q:'Paged',page:'2'},request);assert.equal(first.items.length,50);assert.equal(second.items.length,5);assert.equal(new Set([...first.items,...second.items].map(u=>u.id)).size,55);check('stable bounded pagination without duplicate users');
  const out=path.resolve(__dirname,'../../../output/playwright/c4g-platform-directory');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'backend-verification.json'),JSON.stringify({result:'PASS',checks,fixtureSessions:true,realPostgres:true},null,2));
 }finally{if(server)await new Promise(r=>server.close(r));await central.close();}
}
main().catch(e=>{console.error(e.code||e.name,(e.message||'').slice(0,250));process.exitCode=1;});
