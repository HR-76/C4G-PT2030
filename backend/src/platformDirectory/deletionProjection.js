'use strict';
const {uuid,fail}=require('../platformOnboarding/contracts');
async function anonymizePerson(client,value){
 const org=uuid(value.organizationId),member=uuid(value.membershipId),user=uuid(value.globalUserId);
 const result=await client.query('SELECT organizational_scope.erase_account_identity($1,$2,$3,$4) AS person_id',[org,member,user,uuid(value.requestId)]);
 if(result.rows.length!==1||!result.rows[0].person_id)fail('PROJECTION_DELETION_UNCONFIRMED');
 return {organizationId:org,membershipId:member,anonymized:true};
}
function createDeletionProjection({bindings,allowedResidency=[{regionCode:'LOCAL',policyVersion:'local-development-v1'}]}){
 async function run(value,readOnly=false){
  for(const key of ['organizationId','membershipId','globalUserId','requestId'])uuid(value[key]);
  const entry=bindings.find(b=>b.organizationId===value.organizationId);if(!entry)fail('PROJECTION_DELETION_UNCONFIRMED');
  const {credentials,snapshot}=entry;
  if(snapshot.organizationId!==value.organizationId||snapshot.tenantId!==credentials.tenantId||snapshot.databaseRef!==credentials.database)fail('PROJECTION_DELETION_UNCONFIRMED');
  const runtime=require('../config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:{query(){throw Error('CENTRAL_DISABLED');},connect(){throw Error('CENTRAL_DISABLED');}},env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([credentials]),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify(allowedResidency)}});
  const pool=new (require('pg').Pool)({host:credentials.host,port:credentials.port,database:credentials.database,user:credentials.login,password:credentials.password,ssl:credentials.ssl?{rejectUnauthorized:true}:false,max:1});
  let client,begun=false;
  try{
   client=await pool.connect();
   await runtime.bindingVerifier.verify({client,snapshot,requiredCapabilities:['ACCOUNT_IDENTITY_ERASURE'],correlationId:value.requestId,phase:'PREPARATION'});
   if(readOnly)return {ready:true};
   await client.query('BEGIN');begun=true;
   await client.query("SET LOCAL statement_timeout='10s'");
   await client.query("SELECT set_config('app.organization_id',$1,true)",[value.organizationId]);
   await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
   const result=await anonymizePerson(client,value);
   await client.query('COMMIT');begun=false;return result;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client?.release();await pool.end();await runtime.poolManager.closeAll();}
 }
 return Object.freeze({anonymize:value=>run(value),async ready(){
  if(!Array.isArray(bindings)||!bindings.length)fail('DELETION_NOT_CONFIGURED');
  const placeholder='00000000-0000-4000-8000-000000000001';
  for(const entry of bindings)await run({organizationId:entry.organizationId,membershipId:placeholder,globalUserId:placeholder,requestId:placeholder},true);
  return {ready:true};
 }});
}
module.exports={createDeletionProjection,anonymizePerson};
