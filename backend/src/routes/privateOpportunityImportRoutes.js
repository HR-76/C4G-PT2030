'use strict';
const {MAX_BYTES,MIME}=require('../opportunityImports/portugal2030Xlsx');
const {codes,importError}=require('../opportunityImports/httpErrors');

const AUTHORIZATION_DENIAL_CODES=new Set(['AUTHORITY_DENIED','AUTHORIZATION_VERSION_STALE','MEMBERSHIP_INACTIVE_OR_MISMATCH',
 'PERMISSION_NOT_GRANTED','PROFILE_UNKNOWN','RESOURCE_INACTIVE','SOD_VIOLATION','SERVICE_BINDING_MISMATCH',
 'AUTH_EVIDENCE_MISSING','AUTH_EVIDENCE_EXPIRED','AUTH_POLICY_VERSION_MISMATCH','MFA_EVIDENCE_INSUFFICIENT',
 'SUPPORT_GRANT_INVALID','SUPPORT_GRANT_MISSING','SUPPORT_WINDOW_INVALID','SUPPORT_APPROVAL_INVALID','SUPPORT_SCOPE_MISMATCH']);
function httpStatusForImportError(code){const oversized=code==='LIMIT_FILE_SIZE'||code==='IMPORT_FILE_TOO_LARGE';return /AUTHORITY_REQUIRED|SESSION/.test(code)?401:AUTHORIZATION_DENIAL_CODES.has(code)||/MFA/.test(code)?403:/NOT_FOUND|NOT_AVAILABLE/.test(code)?404:/CONFLICT|ACTIVE|DIGEST|STATE/.test(code)?409:oversized?413:/INVALID|LIMIT|REQUIRED|TOO_LARGE|FORMULA|SHEET|HEADER|ROW/.test(code)?400:503;}
function failure(error,res,onFailure){
 const code=codes.has(error.code)?error.code:'IMPORT_UNAVAILABLE',status=httpStatusForImportError(code);
 if(status>=500)try{onFailure({code,component:'OPPORTUNITY_IMPORT_HTTP'});}catch{}
 if(res.headersSent||res.destroyed||res.writableEnded){if(!res.destroyed)res.destroy();return;}
 res.removeHeader('Content-Type');res.removeHeader('Content-Disposition');res.removeHeader('Content-Length');
 const safeHeaderDetails=['IMPORT_HEADER_DECISION_REQUIRED','IMPORT_HEADER_REJECTED'].includes(code)&&Array.isArray(error.details?.headers)?{headers:error.details.headers.filter(h=>typeof h==='string').slice(0,100).map(h=>h.slice(0,200))}:null;
 return res.status(status).json({error:{code,message:status===403?'A operação exige autorização e autenticação válidas.':status===404?'Importação indisponível.':status===409?'O estado da importação mudou; atualize antes de repetir.':status===413?'O ficheiro excede o limite de 10 MiB.':status===400?'Ficheiro ou pedido inválido.':'Serviço de importação indisponível.',...(safeHeaderDetails?{details:safeHeaderDetails}:{})}});
}

function createPrivateOpportunityImportRouter({express,multer,workflow,contextPort,authenticate,organizationMiddleware,onFailure=event=>require('../observability/logger').createLogger({service:'c4g-api'}).error('c4g.http.failed',{component:event.component,errorCode:event.code})}){
 if(!express||!multer||!workflow||!contextPort||typeof contextPort.resolve!=='function')throw new TypeError('F12 import router dependencies are incomplete.');
 const router=express.Router(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:1,fields:2},fileFilter(req,file,done){const accepted=file.mimetype===MIME&&/\.xlsx$/i.test(file.originalname||'');done(accepted?null:importError('IMPORT_FILE_INVALID'),accepted);}}).single('file');
 router.use(authenticate,organizationMiddleware.requireServerSession,organizationMiddleware.resolveOrganizationContext,organizationMiddleware.requireOrganizationContext);
 // Retain historical reads and cancellation, but never create another tenant opportunity.
 router.use((req,res,next)=>req.method!=='GET'&&!/^\/[^/]+\/cancel$/.test(req.path)
   ?res.status(403).json({error:{code:'OPPORTUNITY_C4G_AUTHORING_ONLY',message:'A criação de oportunidades pertence à Administração C4G.'}}):next());
 const run=(handler)=>(req,res)=>Promise.resolve().then(()=>contextPort.resolve(req)).then(context=>handler(req,res,context)).catch(error=>failure(error,res,onFailure));
 router.post('/xlsx',(req,res)=>upload(req,res,error=>{if(error)return failure(error,res,onFailure);return run(async(request,response,context)=>{if(!request.file)throw importError('IMPORT_FILE_REQUIRED');const result=await workflow.upload({context,file:{buffer:request.file.buffer,mime:request.file.mimetype,filename:request.file.originalname},requestId:request.body?.requestId});return response.status(201).json(result);})(req,res);}));
 router.get('/',run(async(req,res,context)=>res.json(await workflow.list({context}))));
 router.post('/:id/preview',run(async(req,res,context)=>res.json(await workflow.preview({context,importId:req.params.id,sheetName:req.body?.sheetName,headerDecisions:req.body?.headerDecisions}))));
 router.post('/:id/confirm',run(async(req,res,context)=>res.status(202).json(await workflow.confirm({context,importId:req.params.id}))));
 router.post('/:id/cancel',run(async(req,res,context)=>res.json(await workflow.cancel({context,importId:req.params.id}))));
 router.post('/:id/possible/:line/review',run(async(req,res,context)=>{
  const body=req.body,line=Number(req.params.line);
  if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).length!==1||!['CREATE','REJECT'].includes(body.decision)||!Number.isSafeInteger(line)||line<1)throw importError('INVALID_INPUT');
  return res.json(await workflow.review({context,importId:req.params.id,line,decision:body.decision}));
 }));
 router.get('/:id/report',run(async(req,res,context)=>{const report=await workflow.downloadReport({context,importId:req.params.id});res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="opportunity-import-${req.params.id}.csv"`);res.setHeader('Cache-Control','no-store');return ReadableResponse(report,res);}));
 router.get('/:id',run(async(req,res,context)=>res.json(await workflow.get({context,importId:req.params.id}))));
 router.use((req,res)=>res.status(405).json({error:{code:'IMPORT_OPERATION_NOT_IN_MVP',message:'Operação fora do MVP XLSX.'}}));
 return router;
}
async function ReadableResponse(value,res){
 for await(const chunk of Buffer.isBuffer(value)?[value]:value){
  if(res.destroyed||res.writableEnded)throw importError('IMPORT_UNAVAILABLE');
  if(!res.write(chunk))await new Promise((resolve,reject)=>{
   const cleanup=()=>{res.off('drain',drain);res.off('close',close);res.off('error',error);};
   const drain=()=>{cleanup();resolve();},close=()=>{cleanup();reject(importError('IMPORT_UNAVAILABLE'));},error=e=>{cleanup();reject(e);};
   res.once('drain',drain);res.once('close',close);res.once('error',error);
   if(res.destroyed)close();
  });
 }
 return res.end();
}
module.exports={createPrivateOpportunityImportRouter,httpStatusForImportError,ReadableResponse,failure};
