'use strict';
const express=require('express');
// Deliberately not mounted by app.js/productionComposition. The future composition
// must supply the ordinary session/CSRF middleware and a server-owned transient
// activation context. No role, session ID or browser binding comes from the body.
function createPlatformOnboardingRoutes({service,requireSession,requireCsrf,requireActivationContext}){
 if(!service||[requireSession,requireCsrf,requireActivationContext].some(x=>typeof x!=='function'))throw new TypeError('Onboarding HTTP composition is incomplete.');
 const router=express.Router();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');next();});
 const statuses={C4G_ADMIN_REQUIRED:403,ONBOARDING_INPUT_INVALID:400,ACTIVATION_INVALID:400,ONBOARDING_NOT_FOUND:404,ONBOARDING_CONFLICT:409,ONBOARDING_BUSY:409,ONBOARDING_STALE:409,ONBOARDING_NOT_READY:409,INVITATION_ALREADY_OPEN:409,IDENTITY_RECONCILIATION_REQUIRED:409,MEMBERSHIP_ALREADY_EXISTS:409,ONBOARDING_STEP_UNCONFIRMED:503};
 const handle=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){const status=statuses[e.code]||503;res.status(status).json({code:statuses[e.code]?e.code:'ONBOARDING_UNAVAILABLE'});}};
 router.get('/entities',requireSession,handle(req=>service.list(req)));
 router.get('/entities/:id',requireSession,handle(req=>service.get(req.params.id,req)));
 router.post('/entities',requireSession,requireCsrf,handle(req=>service.create(req.body,req)));
 router.post('/entities/:id/resume',requireSession,requireCsrf,handle(req=>service.resume(req.params.id,req)));
 router.post('/entities/:id/invitations',requireSession,requireCsrf,handle(req=>service.issue(req.params.id,req.body,req)));
 router.post('/entities/:id/invitations/:invitationId/revoke',requireSession,requireCsrf,handle(req=>service.revoke(req.params.id,req.params.invitationId,req)));
 router.post('/activation/begin',requireActivationContext,requireCsrf,handle(req=>service.beginActivation(req.body?.secret,req.activationContext?.binding)));
 router.post('/activation/complete',requireActivationContext,requireCsrf,handle(req=>service.activate(req.body?.exchange,req.activationContext?.binding,req.body?.callback)));
 return router;
}
module.exports={createPlatformOnboardingRoutes};
