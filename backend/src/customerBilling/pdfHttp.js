'use strict';
const {MAX_BYTES}=require('./pdfService');
const statuses={INVALID_INPUT:400,PDF_INVALID:400,PDF_REJECTED:422,STALE_REVISION:409,IDEMPOTENCY_CONFLICT:409,C4G_ADMIN_REQUIRED:403,NOT_AUTHORIZED:403,AUTHORITY_REQUIRED:401,CONTEXT_CHANGED:409,RESOURCE_NOT_AVAILABLE:404,PDF_SCAN_UNAVAILABLE:503,PDF_INTEGRITY_FAILED:503,PDF_FEATURE_UNAVAILABLE:503,PDF_BUSY:429};
let active=0;
function mountPdfRoutes(router,{express,service,customer=false}){
  const error=(err,res)=>{const code=Object.hasOwn(statuses,err?.code)?err.code:err?.type==='entity.too.large'?'PDF_INVALID':'SERVICE_UNAVAILABLE';if(!res.headersSent&&!res.destroyed)res.status(statuses[code]||503).json({error:{code}})};
  function guard(req,res,next){
    res.set('Cache-Control','no-store');
    if(!service)return error({code:'PDF_FEATURE_UNAVAILABLE'},res);
    if(req.method==='HEAD')return res.status(405).end();
    if(Object.keys(req.query).length)return error({code:'INVALID_INPUT'},res);
    if(active>=4)return error({code:'PDF_BUSY'},res);
    active++;const controller=new AbortController();req.billingPdfSignal=controller.signal;let done=false;
    const release=()=>{if(!done){done=true;active--;controller.abort()}};
    res.once('close',release);res.once('finish',release);next();
  }
  router.get('/documents/:id/pdf',guard,async(req,res)=>{try{res.json(await service.list(req,req.params.id,customer))}catch(e){error(e,res)}});
  router.get('/documents/:id/pdf/:versionId',guard,async(req,res)=>{try{
    const result=await service.download(req,req.params.id,req.params.versionId,customer,req.billingPdfSignal);
    res.set({'Content-Type':'application/pdf','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`attachment; filename="fatura.pdf"; filename*=UTF-8''${encodeURIComponent(result.filename).replace(/'/g,'%27')}`});
    res.send(result.bytes);
  }catch(e){error(e,res)}});
  if(!customer)router.put('/documents/:id/pdf',guard,
    async(req,res,next)=>{try{await service.list(req,req.params.id,false);next()}catch(e){error(e,res)}},
    (req,res,next)=>express.raw({type:'application/pdf',limit:MAX_BYTES,inflate:false})(req,res,e=>e?error(e,res):next()),
    async(req,res)=>{try{
      let filename;try{filename=decodeURIComponent(req.get('X-PDF-Filename')||'')}catch{throw Object.assign(Error(),{code:'INVALID_INPUT'})}
      if(!/^(0|[1-9]\d{0,9})$/.test(req.get('X-PDF-Revision')||''))throw Object.assign(Error(),{code:'INVALID_INPUT'});
      const input={filename,requestId:req.get('X-Request-Id'),expectedVersion:Number(req.get('X-PDF-Revision'))};
      if(!req.get('X-PDF-Revision')||!req.is('application/pdf'))throw Object.assign(Error(),{code:'INVALID_INPUT'});
      res.status(201).json(await service.upload(req,req.params.id,req.body,input,req.billingPdfSignal));
    }catch(e){error(e,res)}});
}
module.exports={mountPdfRoutes};
