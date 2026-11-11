'use strict';
const {randomUUID}=require('node:crypto');
const {errorResponse,fail}=require('./readErrors');
// Mount only after the existing GCNI server session middleware. No new login,
// bearer token, organization selector or connection configuration is accepted.
function createReadRouter({express,service,observe=null}){
 const router=express.Router();
 router.use(async(req,res)=>{
  const started=performance.now();let errorCode=null;
  if(observe)res.once('finish',()=>{try{observe({path:req.path,method:req.method,status:res.statusCode,errorCode,durationMs:performance.now()-started});}catch{/* Observation must not cause an unhandled post-response error. */}});
  const requestId=randomUUID();res.set('Cache-Control','private, no-store');res.set('Content-Type','application/json; charset=utf-8');
  try{
   const auth=req.session?.auth;
   const principal=auth?{sid:req.sessionID,userId:auth.user?.id,revocationVersion:auth.revocationVersion,policyVersion:auth.policyVersion}:null;
   if(req.method!=='GET')fail('INVALID_QUERY');
   if(req.originalUrl.length>16384||/%(?![a-f0-9]{2})/i.test(req.originalUrl))fail('INVALID_QUERY');
   const pairs=[...new URL(req.originalUrl,'http://isolated.invalid').searchParams];
   const response=await service.request({principal,path:req.path,pairs,requestId});
   // Express can otherwise generate ETags and freshness-based 304 responses.
   res.status(200);res.end(JSON.stringify(response));
  }catch(error){const result=errorResponse(error,requestId);errorCode=result.body.error.code;res.status(result.status);res.end(JSON.stringify(result.body));}
 });
 return router;
}
module.exports={createReadRouter};
