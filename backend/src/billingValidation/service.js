 'use strict';
const {randomUUID}=require('node:crypto');
const {uuid,exact,fail}=require('../platformBilling/contracts');
const codes=['C4G_ADMIN_REQUIRED','NOT_AUTHORIZED','RESOURCE_NOT_AVAILABLE','STALE_REVISION','IDEMPOTENCY_CONFLICT','BILLING_VALIDATION_NO_RECIPIENT'];
function createBillingValidationService({pool,customerService}) {
 const actor=request=>{
  if(!request.sessionID||request.authContext?.sessionId!==request.sessionID)fail('NOT_AUTHORIZED');
  return uuid(request.user?.id);
 };
 async function run(sql,params) {
  try {return (await pool.query(sql,params)).rows[0].result}
  catch(error){if(codes.includes(error.message))fail(error.message);if(['23505','40001','40P01','55P03'].includes(error.code))fail('STATE_CONFLICT');throw error}
 }
 async function context(request,organizationId,admin) {
  const id=actor(request);
  const org=admin?uuid(organizationId):(await customerService.execute('authorizePdf',{},null,request)).organizationId;
  return {id,org};
 }
 return {
  async read(request,organizationId,admin=false) {
   const {id,org}=await context(request,organizationId,admin);
   const result=await run('SELECT public.billing_validation_read($1,$2,$3,$4) AS result',[request.sessionID,id,org,admin]);
   if(!admin)await context(request,null,false);
   return result;
  },
  async request(request,organizationId,body) {
   exact(body,['versionId','requestKey']);uuid(body.versionId);uuid(body.requestKey);
   const {id,org}=await context(request,organizationId,true);
   const result=await run('SELECT public.billing_validation_request($1,$2,$3,$4,$5,$6) AS result',[request.sessionID,id,org,body.versionId,body.requestKey,randomUUID()]);
   return {requestId:result};
  },
  async confirm(request,body) {
   exact(body,['versionId','requestId']);uuid(body.versionId);uuid(body.requestId);
   const {id,org}=await context(request,null,false);
   const result=await run('SELECT public.billing_validation_confirm($1,$2,$3,$4,$5) AS result',[request.sessionID,id,org,body.requestId,body.versionId]);
   return {requestId:result};
  }
 };
}
module.exports={createBillingValidationService};
