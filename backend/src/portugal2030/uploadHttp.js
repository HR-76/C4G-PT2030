'use strict';
const {MIME,MAX_BYTES}=require('./planXlsxV2');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function createCentralImportRouter({express,multer,runtime,authorize}){
 const router=express.Router();let receiving=0;
 const fail=code=>{throw Object.assign(Error(),{code})};
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:1,fields:1,fieldSize:100,parts:2},fileFilter(req,file,done){done(file.mimetype===MIME&&/\.xlsx$/i.test(file.originalname)?null:Object.assign(Error(),{code:'PT2030_UPLOAD_INVALID'}),file.mimetype===MIME)}}).single('file');
 function failure(error,res){
  const raw=error.code||'',known=/^PT2030_(RECENT_|UPLOAD_|DOCUMENT_|SCAN_|PLAN_|IMPORT_|PREVIEW_|BATCH_|IDEMPOTENCY_|CANDIDATE_|ACCEPT_)/.test(raw);
  const code=raw==='OPPORTUNITY_V2_AUTHORITY_DENIED'?'PT2030_RECENT_AUTHENTICATION_REQUIRED':raw==='C4G_ADMIN_REQUIRED'||raw==='FUNDING_FORBIDDEN'?'C4G_ADMIN_REQUIRED':raw==='LIMIT_FILE_SIZE'?'PT2030_UPLOAD_TOO_LARGE':raw==='INVALID_INPUT'||raw.startsWith('LIMIT_')?'INVALID_INPUT':known?raw:'CENTRAL_IMPORT_UNAVAILABLE';
  const status=code==='C4G_ADMIN_REQUIRED'||code==='PT2030_RECENT_AUTHENTICATION_REQUIRED'?403:code.includes('TOO_LARGE')?413:code.includes('NOT_FOUND')?404:/BUSY|CONFLICT|CHANGED|DIGEST_MISMATCH|STALE/.test(code)?409:/INVALID|REJECTED|REQUIRED|FORBIDDEN|LIMIT|EMPTY|UNSUPPORTED|NOT_FOUND/.test(code)&&!code.includes('UNAVAILABLE')?400:503;
  res.status(status).json({error:{code}});
 }
 const run=work=>async(req,res)=>{try{await authorize(req);await work(req,res)}catch(error){failure(error,res)}};
 router.get('/',run(async(req,res)=>{if(Object.keys(req.query).length)fail('INVALID_INPUT');const value=runtime?await runtime.availability():{available:false,code:'CENTRAL_IMPORT_NOT_CONFIGURED'};await authorize(req);res.json(value)}));
 router.post('/xlsx',run(async(req,res)=>{
  if(Object.keys(req.query).length)fail('INVALID_INPUT');
  if(!runtime||!(await runtime.availability()).available)fail('CENTRAL_IMPORT_UNAVAILABLE');
  if(receiving>=2)fail('PT2030_UPLOAD_BUSY');receiving++;
  try{
   await new Promise((resolve,reject)=>upload(req,res,error=>error?reject(error):resolve()));
   if(!req.file||Object.keys(req.body||{}).join(',')!=='requestId'||!UUID.test(req.body.requestId))fail('INVALID_INPUT');
   await authorize(req);
   const result=await runtime.upload({userId:req.user.id,sessionId:req.authContext?.sessionId,requestId:req.body.requestId,file:{buffer:req.file.buffer,filename:req.file.originalname,mime:req.file.mimetype}});
   await authorize(req);res.status(201).json(result);
  }finally{receiving--;}
 }));
 router.get('/:id',run(async(req,res)=>{if(!UUID.test(req.params.id)||Object.keys(req.query).length)fail('INVALID_INPUT');if(!runtime)fail('CENTRAL_IMPORT_UNAVAILABLE');const result=await runtime.get({userId:req.user.id,requestId:req.params.id});await authorize(req);res.json(result)}));
 router.post('/:id/preview',run(async(req,res)=>{
  if(!UUID.test(req.params.id)||Object.keys(req.query).length||!req.body||Object.keys(req.body).sort().join(',')!=='requestId,sheetName'||!UUID.test(req.body.requestId)||typeof req.body.sheetName!=='string'||!req.body.sheetName.trim()||req.body.sheetName.length>31)fail('INVALID_INPUT');
  if(!runtime)fail('CENTRAL_IMPORT_UNAVAILABLE');
  const result=await runtime.preview({userId:req.user.id,sessionId:req.authContext?.sessionId,requestId:req.params.id,sheetName:req.body.sheetName,previewRequestId:req.body.requestId});await authorize(req);res.json(result);
 }));
 // Save the candidates of a previewed sheet. The digest is the one the preview returned to the administrator.
 router.post('/:id/stage',run(async(req,res)=>{
  const SHA=/^[a-f0-9]{64}$/;
  if(!UUID.test(req.params.id)||Object.keys(req.query).length||!req.body||Object.keys(req.body).sort().join(',')!=='previewDigest,requestId,sheetName'||!UUID.test(req.body.requestId)||!SHA.test(req.body.previewDigest)||typeof req.body.sheetName!=='string'||!req.body.sheetName.trim()||req.body.sheetName.length>31)fail('INVALID_INPUT');
  if(!runtime)fail('CENTRAL_IMPORT_UNAVAILABLE');
  const result=await runtime.stage({userId:req.user.id,sessionId:req.authContext?.sessionId,requestId:req.params.id,sheetName:req.body.sheetName,stageRequestId:req.body.requestId,previewDigest:req.body.previewDigest});await authorize(req);res.status(201).json(result);
 }));
 // Review what a staged import would add to the catalogue, and accept the new ones with the digest the review returned.
 router.get('/staged/:importId',run(async(req,res)=>{
  if(!UUID.test(req.params.importId)||Object.keys(req.query).length)fail('INVALID_INPUT');if(!runtime)fail('CENTRAL_IMPORT_UNAVAILABLE');
  const result=await runtime.review({userId:req.user.id,sessionId:req.authContext?.sessionId,importId:req.params.importId});await authorize(req);res.json(result);
 }));
 router.post('/staged/:importId/accept',run(async(req,res)=>{
  if(!UUID.test(req.params.importId)||Object.keys(req.query).length||!req.body||Object.keys(req.body).join(',')!=='batchDigest'||!/^[a-f0-9]{64}$/.test(req.body.batchDigest))fail('INVALID_INPUT');if(!runtime)fail('CENTRAL_IMPORT_UNAVAILABLE');
  const result=await runtime.accept({userId:req.user.id,sessionId:req.authContext?.sessionId,importId:req.params.importId,batchDigest:req.body.batchDigest});await authorize(req);res.json(result);
 }));
 router.use(run(async(req,res)=>res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'}})));
 return router;
}
module.exports={createCentralImportRouter};
