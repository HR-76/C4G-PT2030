'use strict';
const {randomUUID}=require('node:crypto');
 const statuses={CONTACTS_CENTRAL:409,FISCAL_IDENTITY_LOCKED:409,FISCAL_IDENTITY_REVIEW_REQUIRED:409,ONBOARDING_INPUT_INVALID:400,REGISTRATION_FIELDS_INVALID:400,ONBOARDING_CONFLICT:409,ONBOARDING_STALE:409,ONBOARDING_NOT_READY:409,INVALID_INPUT:400,INVALID_CURSOR:400,SESSION_REQUIRED:401,AUTHORITY_REQUIRED:401,AUTHORITY_STALE:409,AUTHORITY_WRITE_PENDING:409,NOT_AUTHORIZED:403,RESOURCE_NOT_AVAILABLE:404,
 STALE_REVISION:409,SELF_ACCESS_PROTECTED:409,STATE_CONFLICT:409,IDEMPOTENCY_CONFLICT:409,DEPENDENCY_CONFLICT:409,UNIT_UNAVAILABLE:409,MEMBERSHIP_UNAVAILABLE:409,CONTEXT_CHANGED:409,LIMIT_EXCEEDED:409};
function createDirectoryRouter({express,service,matching,membershipAccess,members,onFailure=()=>{},authenticate,organizationMiddleware}){
 const router=express.Router();
 const failure=(error,res)=>{
  try{onFailure(error);}catch{ /* Observation must not replace the public response. */ }
  const code=Object.hasOwn(statuses,error?.code)?error.code:'SERVICE_UNAVAILABLE';
  return res.status(statuses[code]||503).json({error:{code}});
 };
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()},authenticate,organizationMiddleware.requireServerSession,
  organizationMiddleware.resolveOrganizationContext,organizationMiddleware.requireOrganizationContext);
 router.use('/access/users',require('./memberOnboardingRoutes').createMemberRoutes({express,service:members,resolveOrganization:req=>req.headers['x-c4g-organization']}));
 for(const [verb,path,method] of [['get','/access','list'],['put','/memberships/:id/profile','changeProfile'],['put','/memberships/:id/billing','changeBilling']]){
  router[verb](path,async(req,res)=>{try{
   if(Object.keys(req.query).length||(verb==='get'&&req.body&&Object.keys(req.body).length))throw Object.assign(new Error(),{code:'INVALID_INPUT'});
   if(!membershipAccess)throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});
   res.json(await (method==='list'?membershipAccess.list(req):membershipAccess[method](req.params.id,req.body,req)));
  }catch(error){failure(error,res);}});
 }
 router.put('/memberships/:id/status',async(req,res)=>{try{
  if(Object.keys(req.query).length)throw Object.assign(new Error(),{code:'INVALID_INPUT'});
  if(!membershipAccess)throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});
  res.json(await membershipAccess.change(req.params.id,req.body,req));
 }catch(error){failure(error,res);}});
 router.get('/matching',async(req,res)=>{try{
  if(req.body&&Object.keys(req.body).length)throw Object.assign(new Error(),{code:'INVALID_INPUT'});
  if(!matching)throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});
  res.json(await matching.execute({...req.query},req));
 }catch(error){failure(error,res);}});
  for(const [verb,path,method] of [['put','/description','descriptionEdit'],['put','/strategy','strategyEdit'],['put','/registration','registrationProfile'],['put','/registration/contacts','registrationContacts'],['get','/','context'],['put','/','profileEdit'],['get','/units','units'],['post','/units','unitCreate'],
  ['put','/units/:id/name','unitRename'],['put','/units/:id/parent','unitMove'],['get','/me','self'],['put','/me','selfEdit'],['get','/memberships','memberships'],['get','/people/:id','person'],['put','/people/:id/profile','personProfileEdit'],['put','/people/:id/account','personLinkEdit'],['get','/people','people'],['post','/people','personCreate'],['put','/people/:id','personEdit']]){
  router[verb](path,async(req,res)=>{try{
   if((verb==='get'&&req.body&&Object.keys(req.body).length)||(verb!=='get'&&Object.keys(req.query).length))throw Object.assign(new Error(),{code:'INVALID_INPUT'});
   const value=await service.execute(method,verb==='get'?{...req.query}:req.body,req.params.id,req);
   res.status(method.endsWith('Create')?201:200).json(value);
  }catch(error){let code=String(error.code||'');if(['AUTHORITY_DENIED','AUTHORIZATION_DENIED'].includes(code))code='NOT_AUTHORIZED';
    if(!Object.hasOwn(statuses,code))code='SERVICE_UNAVAILABLE';res.status(statuses[code]||503).json({error:{code,...(code==='REGISTRATION_FIELDS_INVALID'?{fields:error.fields}:{})},correlationId:randomUUID()});}
  });
 }
 router.use((req,res)=>res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'}}));return router;
}
module.exports={createDirectoryRouter};
