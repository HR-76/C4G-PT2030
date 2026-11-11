"use strict";
const {randomUUID}=require('node:crypto');
const errors={F13_RESOURCE_NOT_AVAILABLE:404,F13_REFERENCE_INCOMPATIBLE:409,INVALID_INPUT:400,INVALID_CURSOR:400,SESSION_REQUIRED:401,NOT_AUTHORIZED:403,AUTHORITY_DENIED:403,RESOURCE_NOT_AVAILABLE:404,F13_APPROVAL_STALE:409,STALE_DECISION:409,EVALUATION_NOT_CURRENT:409,STALE_ACTIVATION:409,STALE_INPUTS:409,CRITERIA_UNAVAILABLE:409,IDEMPOTENCY_CONFLICT:409,CONCURRENCY_TOKEN_INVALID:409,CONCURRENCY_TOKEN_EXPIRED:409,REFERENCE_INCOMPATIBLE:409,TUPLE_INCOMPATIBLE:409,LIMIT_EXCEEDED:409,ACTIVATION_REQUIRED:409,EVIDENCE_EXPIRED:409};
function createPq1ActivationRouter({express,service,authenticate,organizationMiddleware,consumer=false}){
 const router=express.Router();router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 router.use(authenticate,organizationMiddleware.requireServerSession,organizationMiddleware.resolveOrganizationContext,organizationMiddleware.requireOrganizationContext);
 const routes=consumer?[['post','/:opportunityId/prequalifications','evaluate'],['get','/prequalifications/:id','read'],['post','/prequalifications/:id/decisions','decide'],['get','/prequalifications/:id/decisions','decisions']]:[
  ['get','/context','context'],['post','/preview','preview'],['post','/activate','activate'],['get','/active','active'],['get','/snapshots/:id','snapshot'],['get','/activations','activations'],['post','/intentions/lookup','lookup']];
 for(const [verb,path,method] of routes)router[verb](path,async(req,res)=>{
  const correlationId=randomUUID();try{
   if(!service)return res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'},correlationId});
   if((verb!=='get'&&Object.keys(req.query).length)||(verb==='get'&&req.body&&Object.keys(req.body).length))throw {code:'INVALID_INPUT'};
   let input=verb==='get'?{...req.query}:req.body;
   if(['context','activations'].includes(method))input={cursor:null,...input};
   if(['snapshot','read'].includes(method)){if(Object.keys(input).length)throw {code:'INVALID_INPUT'};input=method==='snapshot'?{snapshotId:req.params.id}:{evaluationId:req.params.id};}
   if(method==='decisions'){if(Object.keys(input).some(k=>k!=='cursor'))throw {code:'INVALID_INPUT'};input={evaluationId:req.params.id,cursor:null,...input};}
   if(method==='decide'){if(!input||Object.hasOwn(input,'evaluationId'))throw {code:'INVALID_INPUT'};input={...input,evaluationId:req.params.id};}
   if(method==='evaluate'){if(!input||Object.hasOwn(input,'opportunityId'))throw {code:'INVALID_INPUT'};input={...input,opportunityId:req.params.opportunityId};}
   const result=await service.execute(method,input,req);
   res.status(result?.status==='UNKNOWN'?202:method==='evaluate'?201:200).json({...result,...(method==='context'?{mfa:{category:service.mfaCategory,stepUpPath:'/api/auth/step-up'}}:{})});
  }catch(e){const code=Object.hasOwn(errors,e.code)?e.code:'SERVICE_UNAVAILABLE';res.status(errors[code]||503).json({error:{code},correlationId});}
 });return router;
}
module.exports={createPq1ActivationRouter};
