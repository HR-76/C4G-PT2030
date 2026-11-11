'use strict';
const {randomUUID}=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {currentContext}=require('../observability/context');
const requestCorrelation=()=>currentContext()?.correlationId||randomUUID();
const statuses={UNIT_UNAVAILABLE:409,STALE_OPPORTUNITY_REVISION:409,INVALID_INPUT:400,SCHEMA_UPGRADE_REQUIRED:409,INVALID_CURSOR:400,SESSION_REQUIRED:401,NOT_AUTHORIZED:403,RESOURCE_NOT_AVAILABLE:404,DOCUMENT_NOT_AVAILABLE:404,RESPONSIBLE_UNAVAILABLE:409,REVIEWER_NOT_ELIGIBLE:409,STALE_REPORT:409,STALE_REVISION:409,STATE_CONFLICT:409,IDEMPOTENCY_CONFLICT:409,LIMIT_EXCEEDED:409,DOCUMENT_QUOTA_EXCEEDED:409,REPORT_EXPORT_BUSY:429};
function publicApplicationError(error,fallback='SERVICE_UNAVAILABLE'){
 let code=String(error?.code||'');
 if(code==='AUTHORITY_REQUIRED'){
  if(error.authorityFailure==='SESSION_INVALID')code='SESSION_REQUIRED';
  else if(error.authorityFailure==='MEMBERSHIP_INVALID')code='NOT_AUTHORIZED';
 }
 if(code==='AUTHORITY_DENIED'||code==='AUTHORIZATION_DENIED')code='RESOURCE_NOT_AVAILABLE';
 if(!Object.hasOwn(statuses,code))code=fallback;
 return Object.freeze({code,status:statuses[code]||503});
}
function respondError(res,error,correlationId,fallback){const value=publicApplicationError(error,fallback);return res.status(value.status).json({error:{code:value.code},correlationId})}
function requireApplicationOrganizationContext(organizationMiddleware){return(req,res,next)=>{
 if(req.organizationContextState==='INVALID')return res.status(403).json({error:{code:'NOT_AUTHORIZED'}});
 return organizationMiddleware.requireOrganizationContext(req,res,next);
}}
function createApplicationSliceRouter({express,service,authenticate,organizationMiddleware,documentAccessPort=null,onFailure=()=>{}}){
 const router=express.Router();
 const observeFailure=(error,correlationId,fallback='SERVICE_UNAVAILABLE')=>{
  const value=publicApplicationError(error,fallback);
  if(value.status>=500)try{onFailure({code:value.code,component:'APPLICATION_HTTP',correlationId});}catch{ /* Observation must not change the response. */ }
 };
 const failure=(res,error,correlationId,fallback)=>{observeFailure(error,correlationId,fallback);return respondError(res,error,correlationId,fallback);};
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()},authenticate,organizationMiddleware.requireServerSession,
  organizationMiddleware.resolveOrganizationContext,requireApplicationOrganizationContext(organizationMiddleware));
 router.get('/:id/documents/versions/:versionId/download',async(req,res)=>{
  res.set('Referrer-Policy','no-referrer');
  const correlationId=requestCorrelation(),controller=new AbortController();let content,source;
  const abort=()=>{if(!res.writableFinished)controller.abort()};
  req.once('aborted',abort);res.once('close',abort);
  const timer=setTimeout(()=>controller.abort(),120000);
  try{
   if(!documentAccessPort||typeof documentAccessPort.download!=='function')throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});
   const allowed=await service.execute('documentDownload',{versionId:req.params.versionId},req.params.id,req);
    if(req.headers.range)return res.status(416).set('Accept-Ranges','none').json({error:{code:'DOCUMENT_RANGE_UNSUPPORTED'},correlationId});
    const revalidate=async()=>{
     controller.signal.throwIfAborted();
     const current=await service.execute('documentDownload',{versionId:req.params.versionId},req.params.id,req);
     if(current.organizationId!==allowed.organizationId||current.versionId!==allowed.versionId)throw Object.assign(new Error(),{code:'DOCUMENT_NOT_AVAILABLE'});
    };
    content=await documentAccessPort.download({organizationId:allowed.organizationId,versionId:allowed.versionId,signal:controller.signal,revalidate});
    if(typeof content?.open!=='function'||typeof content.dispose!=='function')throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});
    source=content.open();
    await new Promise((resolve,reject)=>{source.once('open',resolve);source.once('error',reject)});
    controller.signal.throwIfAborted();
    for(const [name,value] of Object.entries(content.headers||{}))res.set(name,value);
    res.status(200);
    await pipeline(source,res,{signal:controller.signal});
  }catch(error){observeFailure(error,correlationId);if(!res.headersSent&&!res.destroyed){res.removeHeader('Content-Length');res.removeHeader('Content-Disposition');respondError(res,error,correlationId,'SERVICE_UNAVAILABLE')}else if(!res.destroyed)res.destroy();}
  finally{
   clearTimeout(timer);req.removeListener('aborted',abort);res.removeListener('close',abort);
   if(source&&!source.closed)await new Promise(resolve=>{source.once('close',resolve);source.destroy()});
   await content?.dispose();
  }
 });
  router.delete('/:id/documents/:documentId/versions/:versionId',async(req,res)=>{const correlationId=requestCorrelation();try{if(!documentAccessPort||typeof documentAccessPort.deleteDocument!=='function')throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});const result=await documentAccessPort.deleteDocument({request:req,applicationId:req.params.id,documentId:req.params.documentId,versionId:req.params.versionId});res.status(200).json(result)}catch(error){failure(res,error,correlationId,'SERVICE_UNAVAILABLE')}});
  router.post('/:id/documents/upload-intents',async(req,res)=>{const correlationId=requestCorrelation();try{if(!documentAccessPort||typeof documentAccessPort.createIntent!=='function')throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});const result=await documentAccessPort.createIntent({request:req,applicationId:req.params.id,input:req.body});res.status(201).json(result)}catch(error){const raw=String(error.code||'');failure(res,error,correlationId,raw==='DOCUMENT_INTENT_INVALID'?'INVALID_INPUT':'SERVICE_UNAVAILABLE')}});
  router.put('/:id/documents/uploads/:versionId',async(req,res)=>{const correlationId=requestCorrelation();try{if(!documentAccessPort||typeof documentAccessPort.upload!=='function')throw Object.assign(new Error(),{code:'SERVICE_UNAVAILABLE'});const token=req.get('X-C4G-Upload-Capability');if(typeof token!=='string'||!token||req.get('Content-Encoding'))throw Object.assign(new Error(),{code:'INVALID_INPUT'});const result=await documentAccessPort.upload({request:req,applicationId:req.params.id,versionId:req.params.versionId,token,source:req});res.status(202).json(result)}catch(error){const raw=String(error.code||error.message||'');failure(res,error,correlationId,/INVALID|LIMIT|MISMATCH|UNKNOWN/.test(raw)?'INVALID_INPUT':'SERVICE_UNAVAILABLE')}});
 const entries=[['get','/my-work','workMine'],['get','/calendar','calendar'],['get','/report','report'],['get','/report.xlsx','reportExport'],['get','/partners','partnersBrowse'],['get','/:id/partners','partnersGet'],['get','/:id/partners/history','partnersHistory'],['post','/:id/partners','partnerCreate'],['put','/:id/partners','partnerEdit'],['post','/:id/partners/remove','partnerRemove'],['get','/units','unitOptions'],['get','/browse','browse'],['get','/browse-page','browsePage'],['get','/responsibles','responsibles'],['get','/opportunity-summaries','opportunitySummaries'],['get','/','list'],['post','/','create'],['get','/:id/work','workGet'],['get','/:id/work/history','workHistory'],
  ['post','/:id/work/participants','participantAdd'],['post','/:id/work/participants/remove','participantRemove'],
  ['get','/:id/work/chat','chatGet'],['post','/:id/work/chat','chatSend'],
  ['post','/:id/work/tasks','taskCreate'],['put','/:id/work/tasks','taskEdit'],['post','/:id/work/tasks/complete','taskComplete'],['post','/:id/work/tasks/cancel','taskCancel'],['post','/:id/work/tasks/delete','taskDelete'],['get','/:id/history','history'],
  ['get','/:id/documents/candidates','documentCandidates'],['get','/:id/documents/history','documentHistory'],['get','/:id/documents','documentGet'],
  ['post','/:id/documents/links','documentLink'],['post','/:id/documents/remove','documentRemove'],
  ['get','/assigned-reviews','reviewMine'],['get','/:id/documents/reviewers','reviewReviewers'],
  ['post','/:id/documents/reviews','reviewRequest'],['post','/:id/documents/reviews/decide','reviewDecide'],
  ['post','/:id/transitions','transition'],['get','/:id','get'],['put','/:id','edit']];
 for(const [verb,path,method] of entries)router[verb](path,async(req,res)=>{
  const correlationId=requestCorrelation();
  try{
   if((verb==='get'&&req.body&&Object.keys(req.body).length)||(verb!=='get'&&Object.keys(req.query).length))throw Object.assign(new Error(),{code:'INVALID_INPUT'});
   const result=await service.execute(method,verb==='get'?{...req.query}:req.body,req.params.id,req);
   if(method==='reportExport'){
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition','attachment; filename=relatorio-candidaturas-c4g.xlsx');
    return res.status(200).send(result.content);
   }
   res.status(method==='create'?201:200).json(result);
   }catch(error){failure(res,error,correlationId,'SERVICE_UNAVAILABLE')}
 });
 router.use((req,res)=>res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'}}));
 return router;
}
module.exports={createApplicationSliceRouter,publicApplicationError,requireApplicationOrganizationContext};
