'use strict';
const {randomUUID}=require('node:crypto');
const {currentContext}=require('../observability/context');
const statuses={INVALID_INPUT:400,INVALID_CURSOR:400,SESSION_REQUIRED:401,NOT_AUTHORIZED:403,RESOURCE_NOT_AVAILABLE:404,
 STALE_REVISION:409,STALE_OPPORTUNITY_REVISION:409,STATE_CONFLICT:409,UNIT_UNAVAILABLE:409,IDEMPOTENCY_CONFLICT:409,LIMIT_EXCEEDED:409};
function publicInterestError(error){
 let code=String(error?.code||'');
 if(code==='OPPORTUNITY_READ_LIMIT_EXCEEDED')code='LIMIT_EXCEEDED';
 if(code==='AUTHORITY_REQUIRED')code=error.authorityFailure==='SESSION_INVALID'?'SESSION_REQUIRED':error.authorityFailure==='MEMBERSHIP_INVALID'?'NOT_AUTHORIZED':code;
 if(['AUTHORITY_DENIED','AUTHORIZATION_DENIED'].includes(code))code='RESOURCE_NOT_AVAILABLE';
 if(!Object.hasOwn(statuses,code))code='SERVICE_UNAVAILABLE';
 return {status:statuses[code]||503,code};
}
function createOpportunityInterestRouter({express,service,authenticate,organizationMiddleware,onFailure=()=>{}}){
 const router=express.Router();
 router.use(authenticate,organizationMiddleware.requireServerSession,organizationMiddleware.resolveOrganizationContext);
 router.use((req,res,next)=>req.organizationContextState==='INVALID'?res.status(403).json({error:{code:'NOT_AUTHORIZED'}}):organizationMiddleware.requireOrganizationContext(req,res,next));
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const routes=[['get','/context','context'],['get','/units','units'],['get','/summaries','summaries'],['get','/','list'],['post','/','register'],
  ['get','/:id/history','history'],['post','/:id/archive','archive'],['get','/:id','get'],['put','/:id','edit']];
 for(const [verb,path,method] of routes)router[verb](path,async(req,res)=>{
  const correlationId=currentContext()?.correlationId||randomUUID();
  try{
   if(verb==='get'?req.body&&Object.keys(req.body).length:Object.keys(req.query||{}).length)throw Object.assign(new Error(),{code:'INVALID_INPUT'});
   const result=await service.execute(method,verb==='get'?{...req.query}:req.body,req.params.id,req);
   res.status(method==='register'?201:200).json(result);
  }catch(error){
   try{onFailure(error,correlationId);}catch{ /* Observation must not replace the public response. */ }
   const failure=publicInterestError(error);res.status(failure.status).json({error:{code:failure.code},correlationId});
  }
 });
 router.use((_req,res)=>res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'}}));
 return router;
}
module.exports={createOpportunityInterestRouter,publicInterestError};
