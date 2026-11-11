'use strict';
const {randomUUID}=require('node:crypto');
const {currentContext}=require('../observability/context');
const correlationId=()=>currentContext()?.correlationId||randomUUID();
function createPlatformDirectoryRouter({express,service,authenticate,access,members,registration,centralImports=null,multer=require('multer')}){
 const router=express.Router();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();},authenticate);
 router.use('/entities/:entityId/users',require('./memberOnboardingRoutes').createMemberRoutes({express,service:members,resolveOrganization:req=>req.params.entityId,before:(req,org)=>service.entity(org,req)}));
 router.get('/entities/:id/registration',async(req,res)=>{try{if(Object.keys(req.query).length||(req.body&&Object.keys(req.body).length))throw Object.assign(Error(),{code:'INVALID_INPUT'});await service.entity(req.params.id,req);if(!registration)throw Error('Unconfigured');res.json(await registration.profile(req.params.id));}catch(e){const statuses={C4G_ADMIN_REQUIRED:403,INVALID_INPUT:400,RESOURCE_NOT_AVAILABLE:404};const code=Object.hasOwn(statuses,e.code)?e.code:'SERVICE_UNAVAILABLE';res.status(statuses[code]||503).json({error:{code},correlationId:correlationId()});}});
 router.put('/entities/:id/registration',async(req,res)=>{try{if(Object.keys(req.query).length)throw Object.assign(Error(),{code:'INVALID_INPUT'});await service.entity(req.params.id,req);if(!registration)throw Error('Unconfigured');res.json(await registration.saveForPlatform(req.params.id,req.body,req));}catch(e){const statuses={C4G_ADMIN_REQUIRED:403,INVALID_INPUT:400,ONBOARDING_INPUT_INVALID:400,REGISTRATION_FIELDS_INVALID:400,RESOURCE_NOT_AVAILABLE:404,ONBOARDING_CONFLICT:409,ONBOARDING_STALE:409,FISCAL_IDENTITY_LOCKED:409,FISCAL_IDENTITY_REVIEW_REQUIRED:409};const code=Object.hasOwn(statuses,e.code)?e.code:'SERVICE_UNAVAILABLE';res.status(statuses[code]||503).json({error:{code,...(code==='REGISTRATION_FIELDS_INVALID'?{fields:e.fields}:{})},correlationId:correlationId()});}});
 for(const [verb,path,kind] of [['get','/entities/:id/access','list'],['put','/entities/:id/memberships/:membershipId/profile','profile'],['put','/entities/:id/memberships/:membershipId/status','status']])router[verb](path,async(req,res)=>{try{
  if(Object.keys(req.query).length||(verb==='get'&&req.body&&Object.keys(req.body).length))throw Object.assign(Error(),{code:'INVALID_INPUT'});
  if(!access){await service.entity(req.params.id,req);throw Error('Unconfigured');}
  res.json(await(kind==='list'?access.list(req.params.id,req):access.change(req.params.id,req.params.membershipId,req.body,req,kind)));
 }catch(e){const statuses={C4G_ADMIN_REQUIRED:403,MFA_REQUIRED:403,ONBOARDING_INPUT_INVALID:400,INVALID_INPUT:400,RESOURCE_NOT_AVAILABLE:404,STALE_REVISION:409,SELF_ACCESS_PROTECTED:409,MEMBERSHIP_UNAVAILABLE:409};const code=Object.hasOwn(statuses,e.code)?e.code:'SERVICE_UNAVAILABLE';res.status(statuses[code]||503).json({error:{code},correlationId:correlationId()});}});
 const handle=work=>async(req,res)=>{try{
  if(req.body&&Object.keys(req.body).length)throw Object.assign(Error(),{code:'INVALID_INPUT'});
  res.json(await work(req));
 }catch(e){const statuses={C4G_ADMIN_REQUIRED:403,INVALID_INPUT:400,RESOURCE_NOT_AVAILABLE:404};const code=Object.hasOwn(statuses,e.code)?e.code:'SERVICE_UNAVAILABLE';res.status(statuses[code]||503).json({error:{code},correlationId:correlationId()});}};
 router.get('/entities',handle(req=>service.entities(req.query,req)));
 router.get('/entities/:id',handle(req=>{if(Object.keys(req.query).length)throw Object.assign(Error(),{code:'INVALID_INPUT'});return service.entity(req.params.id,req);}));
 router.get('/users',handle(req=>service.users(req.query,req)));
 router.get('/logs',handle(req=>service.logs(req.query,req)));
 router.get('/dashboard',handle(req=>service.dashboard(req.query,req)));
 router.use('/imports/portugal2030',require('../portugal2030/uploadHttp').createCentralImportRouter({express,multer,runtime:centralImports,authorize:req=>service.importAvailability({},req)}));
 router.use((req,res)=>res.status(405).json({error:{code:'OPERATION_NOT_AVAILABLE'},correlationId:correlationId()}));
 return router;
}
module.exports={createPlatformDirectoryRouter};
