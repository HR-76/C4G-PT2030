'use strict';
const allowed = new Map([
  ['/api/auth/session',['GET']], ['/api/auth/me',['GET']], ['/api/auth/csrf',['GET']],
  ['/api/auth/logout',['POST']], ['/api/auth/account',['GET']], ['/api/auth/account-security',['GET']],
  ['/api/auth/account-security/email',['POST']],
  ['/api/auth/oidc/login',['GET']], ['/api/auth/oidc/callback',['GET']],
  ['/api/admissions/mine',['GET']]
]);
// Mount after the ordinary OIDC session, origin and CSRF middleware, before
// every API router. Unknown/new endpoints remain denied for admission-only users.
function createAdmissionBoundary({service,authenticate}) {
  // Session validation and the admission context share one authority
  // transaction when the service offers it; both still run on every request.
  const together=typeof service.together==='function'?work=>service.together(work):work=>work();
  return async (req,res,next)=>{
    if(['/api/auth/logout','/api/auth/csrf','/api/auth/oidc/login','/api/auth/oidc/callback'].includes(req.path))return next();
    if (!req.session?.auth) return next(); // Existing unauthenticated guards remain authoritative.
    let authenticated=false,context;
    try {
      await together(async()=>{
        await authenticate(req,res,()=>{authenticated=true;});
        if(authenticated)context=await service.context(req);
      });
    }catch{
      if(!res.headersSent)res.status(503).set('Cache-Control','no-store').json({error:{code:'ADMISSION_CONTEXT_UNAVAILABLE'}});
      return;
    }
    // Without authentication the session guard has already answered.
    if(!authenticated)return;
    {
      try {
        req.admissionContext=context;
        const draft=/^\/api\/admissions\/[0-9a-f-]{36}\/draft$/.test(req.path)&&['GET','PUT'].includes(req.method);
        const validate=/^\/api\/admissions\/[0-9a-f-]{36}\/validate$/.test(req.path)&&req.method==='POST';
        const completion=Boolean(service.submit)&&((/^\/api\/admissions\/[0-9a-f-]{36}\/submit$/.test(req.path)&&req.method==='POST')||(/^\/api\/admissions\/[0-9a-f-]{36}\/status$/.test(req.path)&&req.method==='GET'));
        if(context.limited&&!allowed.get(req.path)?.includes(req.method)&&!draft&&!validate&&!completion)return res.status(403).set('Cache-Control','no-store').json({error:{code:'ADMISSION_REQUIRED'}});
        next();
      }catch{res.status(503).set('Cache-Control','no-store').json({error:{code:'ADMISSION_CONTEXT_UNAVAILABLE'}});}
    }
  };
}
function createAdmissionRoutes({express,service,authenticate}) {
  const router=express.Router();router.use(['/admissions','/admin/directory/admissions'],authenticate);
  const handle=(fn,allowQuery=false)=>async(req,res)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    try {
      if(!allowQuery&&Object.keys(req.query).length)throw Object.assign(Error(),{code:'ONBOARDING_INPUT_INVALID'});
      res.json(await fn(req));
    }catch(e){const codes={FISCAL_IDENTITY_REVIEW_REQUIRED:409,REGISTRATION_FIELDS_INVALID:400,NOT_AUTHORIZED:403,ONBOARDING_INPUT_INVALID:400,ONBOARDING_NOT_FOUND:404,ONBOARDING_CONFLICT:409,ONBOARDING_NOT_READY:409,INVITATION_ALREADY_OPEN:409,IDENTITY_RECONCILIATION_REQUIRED:409,MEMBERSHIP_ALREADY_EXISTS:409,ONBOARDING_STALE:409};const code=Object.hasOwn(codes,e.code)?e.code:(e.code==='23505'&&e.constraint==='organization_membership_single_entity_uidx'?'MEMBERSHIP_ALREADY_EXISTS':e.code==='23505'?'ONBOARDING_CONFLICT':'SERVICE_UNAVAILABLE');res.status(codes[code]||503).json({error:{code,...(code==='REGISTRATION_FIELDS_INVALID'?{fields:e.fields}:{})}});}
  };
  router.get('/admissions/mine',handle(req=>service.context(req)));
  if(service.list)router.get('/admin/directory/admissions',handle(req=>service.list(req.query,req),true));
  if(service.submit){router.post('/admissions/:id/submit',handle(req=>service.submit(req.params.id,req.body,req)));router.get('/admissions/:id/status',handle(req=>service.status(req.params.id,req)))}
  router.get('/admissions/:id/draft',handle(req=>service.draft(req.params.id,req)));
  router.put('/admissions/:id/draft',handle(req=>service.saveDraft(req.params.id,req.body,req)));
  router.post('/admissions/:id/validate',handle(req=>service.validateDraft(req.params.id,req.body,req)));
  router.post('/admin/directory/admissions',handle(req=>service.create(req.body,req)));
  router.get('/admin/directory/admissions/:id',handle(req=>service.get(req.params.id,req)));
  const empty=req=>{if(!req.body||Object.keys(req.body).length)throw Object.assign(Error(),{code:'ONBOARDING_INPUT_INVALID'});};
  router.post('/admin/directory/admissions/:id/resume',handle(req=>{empty(req);return service.resume(req.params.id,req);}));
  router.post('/admin/directory/admissions/:id/invitations',handle(req=>service.issue(req.params.id,req.body,req)));
  router.post('/admin/directory/admissions/:id/cancel',handle(req=>{empty(req);return service.cancel(req.params.id,req);}));
  return router;
}
module.exports={createAdmissionBoundary,createAdmissionRoutes};
