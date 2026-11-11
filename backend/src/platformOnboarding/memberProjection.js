'use strict';
const {Pool}=require('pg');
const {uuid,hash,fail}=require('./contracts');
function createMemberProjection({bindings}){
 return {async ensure(x){
  for(const key of ['operationId','organizationId','globalUserId','membershipId'])uuid(x[key]);
  const entry=bindings.find(b=>b.organizationId===x.organizationId);if(!entry)fail('ONBOARDING_NOT_READY');
  const {credentials,snapshot}=entry;
  if(snapshot.organizationId!==x.organizationId||snapshot.tenantId!==credentials.tenantId||snapshot.databaseRef!==credentials.database)fail('ONBOARDING_NOT_READY');
  const runtime=require('../config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:{query(){throw Error('CENTRAL_DISABLED');},connect(){throw Error('CENTRAL_DISABLED');}},env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([credentials]),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:'LOCAL',policyVersion:'local-development-v1'}])}});
  const pool=new Pool({host:credentials.host,port:credentials.port,database:credentials.database,user:credentials.login,password:credentials.password,ssl:credentials.ssl?{rejectUnauthorized:true}:false,max:1});
  const c=await pool.connect();let begun=false;
  try{
   await runtime.bindingVerifier.verify({client:c,snapshot,requiredCapabilities:[],correlationId:x.operationId,phase:'PREPARATION'});
   await c.query('BEGIN');begun=true;await c.query("SELECT set_config('app.organization_id',$1,true)",[x.organizationId]);await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
   const digest=hash(JSON.stringify({organizationId:x.organizationId,membershipId:x.membershipId,name:x.input.adminName,email:x.input.adminEmail}));
   const prior=(await c.query('SELECT * FROM organizational_scope.directory_receipt WHERE organization_id=$1 AND idempotency_key=$2',[x.organizationId,x.operationId])).rows[0];
   if(prior){if(prior.intention_digest!==digest)fail('PROVISIONING_INTENT_CONFLICT');}
   else{
    // Existing people must be associated explicitly, never adopted just by email.
    if((await c.query('SELECT person_id FROM organizational_scope.person WHERE organization_id=$1 AND lower(email)=lower($2)',[x.organizationId,x.input.adminEmail])).rowCount)fail('PERSON_RECONCILIATION_REQUIRED');
    await c.query('INSERT INTO organizational_scope.person(organization_id,person_id,name,email,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)',[x.organizationId,x.membershipId,x.input.adminName,x.input.adminEmail,x.globalUserId]);
    await c.query('INSERT INTO organizational_scope.person_profile(organization_id,person_id,membership_id,updated_by) VALUES($1,$2,$2,$3)',[x.organizationId,x.membershipId,x.globalUserId]);
    await c.query("INSERT INTO organizational_scope.directory_receipt(organization_id,idempotency_key,subject_id,operation,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,'PERSON_CREATE',$4,$5,$6)",[x.organizationId,x.operationId,x.globalUserId,x.membershipId,digest,JSON.stringify({personId:x.membershipId,membershipId:x.membershipId})]);
   }
   await c.query('COMMIT');begun=false;return {operationId:x.operationId,organizationId:x.organizationId,globalUserId:x.globalUserId,membershipId:x.membershipId,projected:true};
  }catch(e){if(begun)await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();await pool.end();await runtime.poolManager.closeAll();}
 }};
}
module.exports={createMemberProjection};
