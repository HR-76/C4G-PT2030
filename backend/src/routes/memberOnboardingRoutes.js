'use strict';
const codes={ACTIVATION_INVALID:409,NOT_AUTHORIZED:403,C4G_ADMIN_REQUIRED:403,ONBOARDING_INPUT_INVALID:400,INVALID_INPUT:400,ONBOARDING_NOT_FOUND:404,RESOURCE_NOT_AVAILABLE:404,MEMBERSHIP_ALREADY_EXISTS:409,ONBOARDING_CONFLICT:409,ONBOARDING_BUSY:409,ONBOARDING_STALE:409,ONBOARDING_NOT_READY:409,INVITATION_ALREADY_OPEN:409,IDENTITY_RECONCILIATION_REQUIRED:409,PERSON_RECONCILIATION_REQUIRED:409,ONBOARDING_STEP_UNCONFIRMED:503};
function createMemberRoutes({express,service,resolveOrganization,before=async()=>{}}){
 const router=express.Router({mergeParams:true});
 const handle=fn=>async(req,res)=>{try{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  if(Object.keys(req.query).length||(req.method==='GET'&&req.body&&Object.keys(req.body).length))throw Object.assign(Error(),{code:'INVALID_INPUT'});
  const org=resolveOrganization(req);await before(req,org);
  if(!service)throw Error('Unconfigured');
  if(req.params.operationId&&(await service.get(req.params.operationId,req)).organizationId!==org)throw Object.assign(Error(),{code:'ONBOARDING_NOT_FOUND'});
  res.json(await fn(req,org));
 }catch(e){const code=Object.hasOwn(codes,e.code)?e.code:(e.code==='23505'?'MEMBERSHIP_ALREADY_EXISTS':'SERVICE_UNAVAILABLE');res.status(codes[code]||503).json({error:{code}});}};
 router.get('/',handle((req,org)=>service.list(org,req)));
 router.post('/',handle(async(req,org)=>{if(!req.body||Object.hasOwn(req.body,'organizationId'))throw Object.assign(Error(),{code:'INVALID_INPUT'});const created=await service.create({...req.body,organizationId:org},req);return service.prepare(created.id,req);}));
 router.get('/:operationId',handle(req=>service.get(req.params.operationId,req)));
 router.post('/:operationId/resume',handle(req=>service.prepare(req.params.operationId,req)));
 router.post('/:operationId/activation-email',handle(req=>service.sendEmail(req.params.operationId,req.body,req)));
 router.post('/:operationId/invitations',handle(req=>service.issue(req.params.operationId,req.body,req)));
 router.post('/:operationId/invitations/:invitationId/revoke',handle(req=>service.revoke(req.params.operationId,req.params.invitationId,req)));
 return router;
}
module.exports={createMemberRoutes};
