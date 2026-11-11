'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
async function verify({pool,port}){
 const org=randomUUID(),actor=randomUUID(),outsider=randomUUID(),document=randomUUID(),cycle=randomUUID(),account=randomUUID(),version=randomUUID(),sid=randomUUID();
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const id of [actor,outsider])await c.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic billing test',$2,'ACTIVE')",[id,id+'@example.invalid']);
  await c.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'PDF test','PDF test','pdf-test','COMPANY','ACTIVE','EUR','OPTIONAL')",[org]);
  await c.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),actor]);
  await c.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')",[sid,actor]);
  await c.query('INSERT INTO public.billing_account(id,organization_id) VALUES($1,$2)',[account,org]);
  await c.query("INSERT INTO public.billing_account_version(id,billing_account_id,organization_id,version,legal_name,tax_country,tax_identifier,address_line_1,postal_code,locality,billing_email,payment_terms_days,created_by) VALUES($1,$2,$3,1,'PDF test','PT','123456789','Rua teste','1000-001','Lisboa','billing@example.invalid',30,$4)",[version,account,org,actor]);
  await c.query("INSERT INTO public.billing_cycle(id,organization_id,account_version_id,period_start,period_end,service_description,currency,amount,due_date,state,created_by,updated_by) VALUES($1,$2,$3,'2026-01-01','2026-12-31','Synthetic service','EUR',100,'2026-11-01','ISSUED',$4,$4)",[cycle,org,version,actor]);
  await c.query("INSERT INTO public.billing_fiscal_document(id,billing_cycle_id,organization_id,source_code,issuer_reference,document_type,document_number,issue_date,due_date,currency,subtotal,tax_total,total,created_by,updated_by) VALUES($1,$2,$3,'OTHER','SYNTHETIC','INVOICE','TEST/1','2026-10-01','2026-11-01','EUR',100,0,100,$4,$4)",[document,cycle,org,actor]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 const runtime=new Pool({host:'127.0.0.1',port,user:'c4g_f12_admin',database:'postgres',options:'-c role=c4g_central_runtime'});
 try{
  const repository=require('../../../backend/src/customerBilling/pdfRepository').createPdfRepository(runtime);
  const request={sessionID:sid,authContext:{sessionId:sid},user:{id:actor}};
  assert.equal(await repository.admin(request,document),org);
  await assert.rejects(()=>repository.admin({...request,user:{id:outsider}},document),{code:'C4G_ADMIN_REQUIRED'});
  const first={objectId:randomUUID(),filename:'original.pdf',size:200,sha256:'a'.repeat(64),requestId:randomUUID(),expectedVersion:0};
  const v1=await repository.save(request,document,first);assert.equal(v1.organization_id,org);assert.equal(v1.version,1);
  assert.equal((await repository.save(request,document,{...first,objectId:randomUUID()})).id,v1.id);
  await assert.rejects(()=>repository.save(request,document,{...first,sha256:'b'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(()=>repository.save({...request,user:{id:outsider}},document,{...first,requestId:randomUUID()}),{code:'C4G_ADMIN_REQUIRED'});
  const attempts=await Promise.allSettled([1,2].map(()=>repository.save(request,document,{...first,objectId:randomUUID(),requestId:randomUUID(),expectedVersion:1})));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'STALE_REVISION');
  assert.equal((await repository.versions(org,document)).length,2);assert.equal((await repository.versions(randomUUID(),document)).length,0);
  await assert.rejects(()=>repository.customerDocument(randomUUID(),document),{code:'RESOURCE_NOT_AVAILABLE'});
  await assert.rejects(()=>runtime.query('UPDATE public.billing_document_file SET filename=$1 WHERE id=$2',['changed.pdf',v1.id]),{code:'42501'});
  await assert.rejects(()=>pool.query('UPDATE public.billing_document_file SET filename=$1 WHERE id=$2',['changed.pdf',v1.id]));
  await assert.rejects(()=>pool.query('TRUNCATE public.billing_document_file'));
  await require('./access.cjs').verify({pool,port,org});
  console.log('PDF_SQL_AUTHORIZATION_IDEMPOTENCY_CONCURRENCY_IMMUTABILITY_PASS');
 }finally{await runtime.end()}
}
module.exports={verify};
