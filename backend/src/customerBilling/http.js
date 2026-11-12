'use strict';
const statuses={INVALID_INPUT:400,AUTHORITY_REQUIRED:401,SESSION_REQUIRED:401,NOT_AUTHORIZED:403,RESOURCE_NOT_AVAILABLE:404,CONTEXT_CHANGED:409,AUTHORITY_STALE:409,AUTHORITY_WRITE_PENDING:409};
function createCustomerBillingRouter({express,service,authenticate,organizationMiddleware,pdfs=null}) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next()},authenticate,
    organizationMiddleware.requireServerSession,organizationMiddleware.resolveOrganizationContext,organizationMiddleware.requireOrganizationContext);
  router.use((req,res,next)=>req.method!=='GET'?res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'}}):next());
  require('./pdfHttp').mountPdfRoutes(router,{express,service:pdfs,customer:true});
  for(const [path,method] of [['/access','access'],['/summary','summary'],['/account','account'],['/invoices','list'],['/invoices/:id','detail']]) {
    router.get(path,async(req,res)=>{try {
      if(req.body && Object.keys(req.body).length || method!=='list' && Object.keys(req.query).length) throw Object.assign(new Error(),{code:'INVALID_INPUT'});
      res.json(await service.execute(method,req.query,req.params.id,req));
    }catch(error){const code=Object.hasOwn(statuses,error.code)?error.code:'SERVICE_UNAVAILABLE';res.status(statuses[code]||503).json({error:{code}})}});
  }
  return router;
}
module.exports={createCustomerBillingRouter};
