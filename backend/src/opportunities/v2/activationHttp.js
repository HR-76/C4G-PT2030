'use strict';
const {cloneData,deepFreeze}=require('./data');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const STATUS=Object.freeze({
 OPPORTUNITY_V2_ACTIVATION_INVALID:400,OPPORTUNITY_V2_INVALID_INPUT:400,OPPORTUNITY_V2_INVALID_COMMAND:400,
 OPPORTUNITY_V2_AUTHORITY_DENIED:403,OPPORTUNITY_V2_SESSION_REQUIRED:401,OPPORTUNITY_V2_PLAN_NOT_FOUND:404,
 OPPORTUNITY_V2_APPROVAL_STALE:409,OPPORTUNITY_V2_PLAN_NOT_APPROVED:409,OPPORTUNITY_V2_PLAN_NOT_APPROVABLE:409,
 OPPORTUNITY_V2_RECONCILIATION_BLOCKED:409,OPPORTUNITY_V2_STALE_REVISION:409,OPPORTUNITY_V2_IDENTITY_CONFLICT:409,
 OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT:409,OPPORTUNITY_V2_ACTIVATION_CONFLICT:409,OPPORTUNITY_V2_SOURCE_RUN_NOT_COMPLETE:409,
 OPPORTUNITY_V2_PLAN_ARCHIVE_CHANGED:409,OPPORTUNITY_V2_DOCUMENT_PIPELINE_REQUIRED:409,
 OPPORTUNITY_V2_READ_LIMIT_EXCEEDED:413,OPPORTUNITY_V2_NOT_CONFIGURED:503,
 OPPORTUNITY_V2_11145_SCOPE_INVALID:409,OPPORTUNITY_V2_11145_INVALID:400,
 OPPORTUNITY_V2_11145_UNAVAILABLE:503,OPPORTUNITY_V2_11145_CONFLICT:409,
 OPPORTUNITY_V2_11145_RUN_INVALID:409,OPPORTUNITY_V2_11145_IDENTITY_REQUIRED:409,
 OPPORTUNITY_V2_11145_SOURCE_INVALID:409
 ,OPPORTUNITY_V2_SOURCE_FENCE_STALE:409,OPPORTUNITY_V2_EU_SUSPENDED:409,OPPORTUNITY_V2_EU_NOT_QUIESCENT:409,
 OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED:409,OPPORTUNITY_V2_SOURCE_CONTROL_INVALID:400,OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE:503,
 OPPORTUNITY_V2_EU_WRITER_CONFIGURATION_INVALID:409,OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED:403,
 OPPORTUNITY_V2_EU_WRITER_REQUIRED:409,OPPORTUNITY_V2_EU_WRITER_UNAVAILABLE:503,
 OPPORTUNITY_V2_WINDOW_INVALID:400,OPPORTUNITY_V2_WINDOW_EXPIRED:409,OPPORTUNITY_V2_WINDOW_CHANGED:409,
 OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID:409,OPPORTUNITY_V2_WINDOW_STATE_CHANGED:409,OPPORTUNITY_V2_WINDOW_BASELINE_CHANGED:409,OPPORTUNITY_V2_WINDOW_UNAVAILABLE:503,
 OPPORTUNITY_V2_RECONCILIATION_INVALID:400,OPPORTUNITY_V2_RECONCILIATION_CHANGED:409,OPPORTUNITY_V2_RECONCILIATION_EXPIRED:409,
 OPPORTUNITY_V2_RECONCILIATION_BASELINE_CHANGED:409,OPPORTUNITY_V2_RECONCILIATION_STATE_CHANGED:409,
 OPPORTUNITY_V2_RECONCILIATION_APPROVAL_REQUIRED:409,OPPORTUNITY_V2_RECONCILIATION_UNAVAILABLE:503,
 OPPORTUNITY_V2_LEGACY_PREAPPROVAL_INVALID:400,OPPORTUNITY_V2_LEGACY_PREAPPROVAL_EXPIRED:409,
 OPPORTUNITY_V2_LEGACY_PREAPPROVAL_CHANGED:409,OPPORTUNITY_V2_LEGACY_PREAPPROVAL_UNAVAILABLE:503
});
function fail(code='OPPORTUNITY_V2_ACTIVATION_INVALID'){throw Object.assign(new Error(code),{code});}
function runtimeEnabled(env){const value=env.OPPORTUNITY_ACTIVATION_RUNTIME||'disabled';if(!['disabled','authenticated-v2'].includes(value))throw new TypeError('Opportunity activation runtime selection is invalid.');return value==='authenticated-v2';}
function executor11145Enabled(env){const value=env.OPPORTUNITY_11145_EXECUTOR||'disabled';if(!['disabled','bounded-v2'].includes(value)||value==='bounded-v2'&&!runtimeEnabled(env))throw new TypeError('The bounded 11145 executor requires authenticated activation.');return value==='bounded-v2';}
function publicError(error){return Object.hasOwn(STATUS,error?.code)?{status:STATUS[error.code],code:error.code}:{status:503,code:'SERVICE_UNAVAILABLE'};}
function context(request){
 const id=request.user?.id,sid=request.sessionID;
 if(!request.session?.auth||typeof sid!=='string'||request.authContext?.sessionId!==sid||!UUID.test(id||'')||request.session.auth.user?.id!==id)fail('OPPORTUNITY_V2_SESSION_REQUIRED');
 return deepFreeze({actor:{type:'HUMAN',id},sessionId:sid});
}
function body(request,keys){
 let value;try{value=cloneData(request.body,{maxBytes:8192});}catch{fail();}
 if(!value||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))
  ||typeof value.requestId!=='string'||!/^[A-Za-z0-9:_.-]{8,128}$/.test(value.requestId)
  ||['planDigest','previewDigest','approvalEventHash'].some(key=>Object.hasOwn(value,key)&&!SHA.test(value[key]))
  ||['expectedFence','expectedSourceFence','fence','sourceFence'].some(key=>Object.hasOwn(value,key)&&(!Number.isSafeInteger(value[key])||value[key]<1))
  ||['runId','approvalEventId'].some(key=>Object.hasOwn(value,key)&&!UUID.test(value[key])))fail();
 return value;
}
function createOpportunityActivationRouter({express,service,reads,sourceControl,executor11145=null,writerReviews=null,writerWindow=null,reconciliation=null,legacyPreapproval=null,legacyAcceptance=null,authenticate,requireServerSession,originProtection,csrfProtection,assertReady}){
 if(!express?.Router||![authenticate,requireServerSession,originProtection,csrfProtection,assertReady].every(v=>typeof v==='function')
  ||!['prepare','approve','revoke'].every(k=>typeof service?.[k]==='function')||!['list','get'].every(k=>typeof reads?.[k]==='function')
  ||!['status','suspend','acknowledgeQuiesced','resume'].every(k=>typeof sourceControl?.[k]==='function')
  ||executor11145!==null&&!['collect','prepare','accept'].every(k=>typeof executor11145?.[k]==='function')
  ||reconciliation!==null&&!['get','approve','execute'].every(k=>typeof reconciliation?.[k]==='function')
  ||legacyPreapproval!==null&&!['list','get','approve'].every(k=>typeof legacyPreapproval?.[k]==='function')
  ||legacyAcceptance!==null&&!['list','get','prepare','approve','accept'].every(k=>typeof legacyAcceptance?.[k]==='function'))throw new TypeError('Authenticated activation HTTP dependencies are incomplete.');
 const router=express.Router();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();},authenticate,requireServerSession,originProtection,csrfProtection,express.json({limit:'16kb'}));
 const handle=(status,write,work)=>async(req,res)=>{try{
  if(req.method==='HEAD')return res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'}});
  if((write&&Object.keys(req.query||{}).length)||(!write&&req.body!==undefined&&(!req.body||Array.isArray(req.body)||Object.keys(req.body).length)))fail();
  const actor=context(req);await assertReady();return res.status(status).json(await work(req,actor));
 }catch(error){const e=publicError(error);return res.status(e.status).json({error:{code:e.code}});}};
 router.get('/plans',handle(200,false,(req,ctx)=>{const query=Object.fromEntries(Object.entries(req.query||{}));if(Object.keys(query).some(k=>k!=='cursor')||query.cursor!==undefined&&!UUID.test(query.cursor))fail();return reads.list(query,ctx);}));
 router.post('/plans',handle(201,true,(req,ctx)=>service.prepare(body(req,['requestId','archive','expected']),ctx)));
 router.get('/plans/:planId',handle(200,false,(req,ctx)=>{if(Object.keys(req.query||{}).length||!UUID.test(req.params.planId))fail();return reads.get(req.params.planId,ctx);}));
 for(const decision of ['approve','revoke'])router.post('/plans/:planId/'+decision,handle(200,true,(req,ctx)=>{if(!UUID.test(req.params.planId))fail();return service[decision]({...body(req,['requestId','planDigest']),planId:req.params.planId},ctx);}));
 router.get('/sources/eu',handle(200,false,(req,ctx)=>{if(Object.keys(req.query||{}).length)fail();return sourceControl.status(ctx);}));
 for(const [route,method]of [['suspend','suspend'],['quiesce','acknowledgeQuiesced'],['resume','resume']])router.post('/sources/eu/'+route,handle(200,true,(req,ctx)=>sourceControl[method](body(req,['requestId','expectedFence']),ctx)));
 router.post('/sources/eu/writer',handle(200,true,(req,ctx)=>{if(typeof sourceControl.configureWriter!=='function')fail('OPPORTUNITY_V2_NOT_CONFIGURED');return sourceControl.configureWriter(body(req,['requestId','expectedFence']),ctx);}));
 router.get('/eu-writer/reviews',handle(200,false,(req,ctx)=>{if(!writerReviews)fail('OPPORTUNITY_V2_NOT_CONFIGURED');const query=Object.fromEntries(Object.entries(req.query||{}));if(Object.keys(query).some(k=>k!=='cursor')||query.cursor!==undefined&&typeof query.cursor!=='string')fail();return writerReviews.list(query,ctx);}));
 router.get('/eu-writer/windows/:windowId',handle(200,false,(req,ctx)=>{if(!writerWindow)fail('OPPORTUNITY_V2_NOT_CONFIGURED');if(Object.keys(req.query||{}).length||!UUID.test(req.params.windowId))fail();return writerWindow.get(req.params.windowId,ctx);}));
 router.post('/eu-writer/windows/:windowId/approve',handle(200,true,(req,ctx)=>{if(!writerWindow)fail('OPPORTUNITY_V2_NOT_CONFIGURED');if(!UUID.test(req.params.windowId))fail();return writerWindow.approve({...body(req,['requestId','planDigest']),windowId:req.params.windowId},ctx);}));
 router.get('/eu-writer/reconciliations/:planId',handle(200,false,(req,ctx)=>{if(!reconciliation)fail('OPPORTUNITY_V2_NOT_CONFIGURED');if(Object.keys(req.query||{}).length||!UUID.test(req.params.planId))fail();return reconciliation.get(req.params.planId,ctx);}));
 for(const action of ['approve','execute'])router.post('/eu-writer/reconciliations/:planId/'+action,handle(200,true,(req,ctx)=>{
  if(!reconciliation)fail('OPPORTUNITY_V2_NOT_CONFIGURED');if(!UUID.test(req.params.planId))fail();
  const keys=['requestId','previewDigest',...(action==='execute'?['approvalEventId','approvalEventHash']:[])];
  return reconciliation[action]({...body(req,keys),planId:req.params.planId},ctx);
 }));
 router.get('/eu-legacy/preapprovals/:packageId',handle(200,false,(req,ctx)=>{
  if(!legacyPreapproval)fail('OPPORTUNITY_V2_NOT_CONFIGURED');
  if(Object.keys(req.query||{}).length||!UUID.test(req.params.packageId))fail();
  return legacyPreapproval.list(req.params.packageId,ctx);
 }));
 router.get('/eu-legacy/preapprovals/:packageId/:itemDigest',handle(200,false,(req,ctx)=>{
  if(!legacyPreapproval)fail('OPPORTUNITY_V2_NOT_CONFIGURED');
  if(Object.keys(req.query||{}).length||!UUID.test(req.params.packageId)||!SHA.test(req.params.itemDigest))fail();
  return legacyPreapproval.get(req.params.packageId,req.params.itemDigest,ctx);
 }));
 router.post('/eu-legacy/preapprovals/:packageId/:itemDigest/approve',handle(200,true,(req,ctx)=>{
  if(!legacyPreapproval)fail('OPPORTUNITY_V2_NOT_CONFIGURED');
  if(!UUID.test(req.params.packageId)||!SHA.test(req.params.itemDigest))fail();
  return legacyPreapproval.approve({...body(req,['requestId','bindingDigest']),
    packageId:req.params.packageId,itemDigest:req.params.itemDigest},ctx);
 }));
 router.get('/eu-legacy/acceptance/:packageId',handle(200,false,(req,ctx)=>{
  if(!legacyAcceptance)fail('OPPORTUNITY_V2_NOT_CONFIGURED');
  if(Object.keys(req.query||{}).length||!UUID.test(req.params.packageId))fail();
  return legacyAcceptance.list(req.params.packageId,ctx);
 }));
 router.get('/eu-legacy/acceptance/:packageId/:itemDigest',handle(200,false,(req,ctx)=>{
  if(!legacyAcceptance)fail('OPPORTUNITY_V2_NOT_CONFIGURED');
  if(Object.keys(req.query||{}).length||!UUID.test(req.params.packageId)||!SHA.test(req.params.itemDigest))fail();
  return legacyAcceptance.get(req.params.packageId,req.params.itemDigest,ctx);
 }));
 for(const action of ['prepare','approve','accept'])router.post('/eu-legacy/acceptance/:packageId/:itemDigest/'+action,
  handle(action==='prepare'?201:200,true,(req,ctx)=>{
   if(!legacyAcceptance)fail('OPPORTUNITY_V2_NOT_CONFIGURED');
   if(!UUID.test(req.params.packageId)||!SHA.test(req.params.itemDigest))fail();
   const keys=action==='prepare'?['requestId']:action==='approve'?['requestId','planId','planDigest']:
    ['requestId','planId','planDigest','fence'];
   return legacyAcceptance[action]({...body(req,keys),packageId:req.params.packageId,
    itemDigest:req.params.itemDigest},ctx);
  }));
 const boundedExecutor=()=>{if(!executor11145)fail('OPPORTUNITY_V2_NOT_CONFIGURED');return executor11145;};
 router.post('/calls/11145/collect',handle(201,true,(req,ctx)=>{const input=body(req,['requestId','expectedSourceFence']);if(!UUID.test(input.requestId))fail();return boundedExecutor().collect(input,ctx);}));
 router.post('/calls/11145/plans',handle(201,true,(req,ctx)=>boundedExecutor().prepare(body(req,['requestId','runId']),ctx)));
 router.post('/calls/11145/plans/:planId/accept',handle(200,true,(req,ctx)=>{if(!UUID.test(req.params.planId))fail();return boundedExecutor().accept({...body(req,['requestId','planDigest','fence','sourceFence']),planId:req.params.planId},ctx);}));
 router.use((req,res)=>res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'}}));
 router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const bad=error.type==='entity.parse.failed'||error.type==='entity.too.large';return res.status(bad?(error.type==='entity.too.large'?413:400):error.code==='CSRF_INVALID'?403:503).json({error:{code:bad?'INVALID_INPUT':error.code==='CSRF_INVALID'?'CSRF_INVALID':'SERVICE_UNAVAILABLE'}});});
 return router;
}
async function assertActivationHttpCapability(pool){
 const row=(await pool.query(`SELECT
  to_regclass('opportunity_catalog.activation_plan_v2') IS NOT NULL AND to_regclass('opportunity_catalog.activation_decision_v2') IS NOT NULL
  AND to_regclass('opportunity_catalog.accepted_receipt_v2') IS NOT NULL AND to_regclass('opportunity_catalog.eu_source_control_v2') IS NOT NULL
  AND to_regprocedure('authority_api.opportunity_v2_administrator(text,uuid)') IS NOT NULL
  AND to_regprocedure('opportunity_catalog.eu_source_state_v2()') IS NOT NULL
  AND to_regprocedure('opportunity_catalog.assert_eu_quiescent_v2(integer)') IS NOT NULL AS ready`)).rows[0];
 if(row?.ready!==true)fail('OPPORTUNITY_V2_NOT_CONFIGURED');return true;
}
function createOpportunityActivationHttpRuntime({express,pool,policyVersion,recentMfaRequirement,authenticate,requireServerSession,originProtection,csrfProtection,executorMode='disabled',executorFetchImpl=globalThis.fetch,euWriterCapability=null,workerHealth,writerWindowWorkspaceRoot,reconciliationWorkspaceRoot,legacyPreapprovalWorkspaceRoot}){
 if(!['disabled','bounded-v2'].includes(executorMode))throw new TypeError('Bounded executor selection is invalid.');
 const options={pool,policyVersion,recentMfaRequirement};
 const service=require('./activationComposition').createOpportunityActivationV2(options),reads=require('./activationRead').createActivationReadV2(options);
 const sourceControl=require('./euSourceControl').createEuSourceControlV2({...options,euWriterCapability,workerHealth});
 const writerReviews=euWriterCapability?require('./euWriterRead').createEuWriterReadV2(options):null;
 const writerWindow=require('./writerWindowApproval').createEuWriterWindowApproval({...options,...(writerWindowWorkspaceRoot?{workspaceRoot:writerWindowWorkspaceRoot}:{})});
 const reconciliation=euWriterCapability?require('./euRunReconciliation').createEuRunReconciliation({...options,...(reconciliationWorkspaceRoot?{workspaceRoot:reconciliationWorkspaceRoot}:{})}):null;
 const legacyAcceptance=euWriterCapability?require('./euLegacyAcceptance').createEuLegacyAcceptance({...options,...(legacyPreapprovalWorkspaceRoot?{workspaceRoot:legacyPreapprovalWorkspaceRoot}:{})}):null;
 const legacyPreapproval=euWriterCapability?require('./euLegacyPreapproval').createEuLegacyPreapproval({...options,...(legacyPreapprovalWorkspaceRoot?{workspaceRoot:legacyPreapprovalWorkspaceRoot}:{})}):null;
 const executor11145=executorMode==='bounded-v2'?require('./executor11145').createExecutor11145({...options,fetchImpl:executorFetchImpl}):null;
 const assertReady=async()=>{await assertActivationHttpCapability(pool);if(executor11145)await require('./collector11145').assertCollector11145Package(pool);if(euWriterCapability){const ready=await require('../../security/centralMigrationPreflight').preflightCentral(pool);await require('../../fundingTenders/euWriterConfig').assertEuWriterCapability(pool,ready.currentVersion);}return true;};
 return Object.freeze({assertReady,router:createOpportunityActivationRouter({express,service,reads,sourceControl,executor11145,writerReviews,writerWindow,reconciliation,legacyPreapproval,legacyAcceptance,authenticate,requireServerSession,originProtection,csrfProtection,assertReady})});
}
module.exports={createOpportunityActivationRouter,createOpportunityActivationHttpRuntime,assertActivationHttpCapability,runtimeEnabled,executor11145Enabled,publicError};
