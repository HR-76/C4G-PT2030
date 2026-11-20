 'use strict';
const statuses={INVALID_INPUT:400,NOT_AUTHORIZED:403,C4G_ADMIN_REQUIRED:403,RESOURCE_NOT_AVAILABLE:404,STALE_REVISION:409,IDEMPOTENCY_CONFLICT:409,STATE_CONFLICT:409,CONTEXT_CHANGED:409,AUTHORITY_REQUIRED:401,AUTHORITY_STALE:409,AUTHORITY_WRITE_PENDING:409,BILLING_VALIDATION_NO_RECIPIENT:409};
function mountValidationRoutes(router,{service,admin=false}) {
 const root=admin?'/organizations/:organizationId/account/validation':'/account/validation';
 const handle=write=>async(req,res)=>{
  try {
   if(Object.keys(req.query||{}).length||(!write&&req.body&&Object.keys(req.body).length))throw Object.assign(new Error(),{code:'INVALID_INPUT'});
   if(!service){if(write)return res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'}});return res.json({enabled:false})}
   const result=write?(admin?await service.request(req,req.params.organizationId,req.body):await service.confirm(req,req.body)):await service.read(req,req.params.organizationId,admin);
   return res.json(result);
  }catch(error){const code=Object.hasOwn(statuses,error.code)?error.code:'SERVICE_UNAVAILABLE';return res.status(statuses[code]||503).json({error:{code}})}
 };
 router.get(root,handle(false));
 router.post(root,handle(true));
}
module.exports={mountValidationRoutes};
