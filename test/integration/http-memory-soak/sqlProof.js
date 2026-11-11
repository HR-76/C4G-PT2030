'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const options=c=>({host:c.host,port:c.port,database:c.database,user:c.login,password:c.password,max:1});
async function roles(a,b,central,check,report){
 for(const tenant of [a,b]){
  const c=tenant.credentials,pool=new Pool(options(c)),foreign=new Pool({...options(c),database:(tenant===a?b:a).credentials.database});
  try{
   const flags=(await pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication,rolinherit FROM pg_roles WHERE rolname=session_user')).rows[0];assert(Object.values(flags).every(v=>v===false));
   await assert.rejects(()=>foreign.query('SELECT 1'),e=>e.code==='42501');
   await assert.rejects(()=>pool.query('SELECT * FROM opportunity_catalog.application'),e=>e.code==='42501');
   for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_worker_capabilities'])await assert.rejects(()=>pool.query('SET ROLE '+role),e=>e.code==='42501');
   const flagsRls=(await pool.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='opportunity_catalog' AND c.relname IN ('application','application_change','application_participant','opportunity')) OR (n.nspname='organizational_scope' AND c.relname IN ('person','person_profile')) ORDER BY relname")).rows;
   assert.equal(flagsRls.length,6);assert(flagsRls.every(r=>r.relrowsecurity));
   // The existing private catalog uses ENABLE RLS with a non-owner runtime;
   // application and directory tables additionally require FORCE RLS.
   assert(flagsRls.filter(r=>r.relname!=='opportunity').every(r=>r.relforcerowsecurity));
   const client=await pool.connect();
   try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
    await client.query("SELECT set_config('app.organization_id',$1,true)",[tenant.organizationId]);
    assert.equal((await client.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n,1);
    await client.query("SELECT set_config('app.organization_id',$1,true)",[(tenant===a?b:a).organizationId]);
    assert.equal((await client.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n,0);
    await assert.rejects(()=>client.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,created_by) VALUES($1,$2,$3,'RLS must reject',$4,'2027-01-01',$5)`,[tenant.organizationId,randomUUID(),tenant.opportunityId,tenant.owner.membershipId,tenant.owner.id]),e=>e.code==='42501');
    await client.query('ROLLBACK');assert.equal((await client.query('SELECT current_user=session_user reset')).rows[0].reset,true);
   }finally{await client.query('ROLLBACK');client.release();}
   report.roles ||= [];report.roles.push({tenant:tenant===a?'A':'B',flags,rls:flagsRls});
  }finally{await pool.end();await foreign.end();}
 }
 await assert.rejects(()=>central.authorityPool.query('SELECT * FROM public.global_user'),e=>e.code==='42501');
 check('real API logins cannot bypass RLS, change to owner/worker, connect across tenants or read without functional role');
 check('FORCE RLS hides foreign rows and rejects mismatched writes; transaction restores SQL role');
 check('authority runtime cannot read central tables outside closed protocol');
}
async function seed(tenant,size,people){
 const {pool,organizationId:org,owner,opportunityId}=tenant;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  const existing=(await client.query('SELECT count(*)::int n FROM opportunity_catalog.application WHERE organization_id=$1',[org])).rows[0].n;
  if(size>existing){
   await client.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,created_by,total_budget,organization_budget)
    SELECT $1,gen_random_uuid(),$2,'Synthetic application '||lpad(n::text,6,'0'),$3,'2027-12-31',$4,100.01,50.01 FROM generate_series($5::int,$6::int) n`,[org,opportunityId,owner.membershipId,owner.id,existing+1,size]);
   await client.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,to_status,title,responsible_membership_id,deadline,actor_subject_id,total_budget,organization_budget)
    SELECT organization_id,application_id,revision,'CREATE',status,title,responsible_membership_id,deadline,created_by,total_budget,organization_budget FROM opportunity_catalog.application a WHERE a.organization_id=$1
    AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.application_change c WHERE c.organization_id=a.organization_id AND c.application_id=a.application_id)`,[org]);
  }
  const count=(await client.query('SELECT count(*)::int n FROM organizational_scope.person WHERE organization_id=$1',[org])).rows[0].n;
  if(people>count)await client.query(`INSERT INTO organizational_scope.person(organization_id,person_id,name,email,created_by,updated_by) SELECT $1,gen_random_uuid(),'Synthetic person '||n,'person'||n||'@example.invalid',$2,$2 FROM generate_series($3::int,$4::int) n`,[org,owner.id,count+1,people]);
  const areas=require('../../../backend/src/organizationDirectory/thematicAreas').classify({title:'Artificial intelligence and computer science research'}).map(x=>x.id);
  assert(areas.length>0,'fixture matches actual deterministic classifier');
  await client.query(`INSERT INTO organizational_scope.person_profile(organization_id,person_id,area_ids,updated_by) SELECT organization_id,person_id,$2,$3 FROM organizational_scope.person p WHERE organization_id=$1 AND NOT EXISTS(SELECT 1 FROM organizational_scope.person_profile f WHERE f.organization_id=p.organization_id AND f.person_id=p.person_id)`,[org,areas,owner.id]);
  await client.query('UPDATE organizational_scope.person_profile SET area_ids=$2,revision=revision+1,updated_at=transaction_timestamp() WHERE organization_id=$1 AND area_ids<>$2',[org,areas]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 await pool.query('ANALYZE opportunity_catalog.application');await pool.query('ANALYZE opportunity_catalog.application_change');await pool.query('ANALYZE organizational_scope.person');
}
module.exports={roles,seed};
