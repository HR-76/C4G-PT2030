'use strict';
const {CODES}=require('../opportunities/errors');
function createPrivateOpportunityRouter({express,service,criteriaService,authenticate,organizationMiddleware,onFailure=()=>{}}) {
  const router=express.Router();
  router.use(authenticate,organizationMiddleware.requireServerSession,
    organizationMiddleware.resolveOrganizationContext,organizationMiddleware.requireOrganizationContext);
  const failure=(error,res)=>{
    const code=CODES.includes(error?.code)?error.code:'OPPORTUNITY_UNAVAILABLE';
    const status=code==='OPPORTUNITY_AUTHORIZATION_REQUIRED'?401:code==='OPPORTUNITY_NOT_FOUND'?404:
      /STALE|CONFLICT|DIGEST/.test(code)?409:/INVALID|UNKNOWN_FIELD|LIMIT|CURSOR/.test(code)?400:503;
    if(status>=500)try{onFailure({code,component:'OPPORTUNITY_HTTP'});}catch{ /* Observation must not change the response. */ }
    return res.status(status).json({error:{code,message:status===409?'A revisão mudou ou a intenção conflita. Recarregue antes de editar.':
      status===404?'Oportunidade indisponível.':status===400?'Pedido inválido.':'Acesso indisponível.'}});
  };
  router.use('/:id/criteria',require('./opportunityCriteriaRoutes').createCriteriaRouter({express,service:criteriaService}));
  router.get('/',async(req,res)=>{try{res.json({...await service.list({...req.query},req),permissions:{create:false}});}catch(error){failure(error,res);}});
  const readOnly=(_req,res)=>res.status(403).json({error:{code:'OPPORTUNITY_C4G_AUTHORING_ONLY',message:'A gestão de oportunidades pertence à Administração C4G.'}});
  router.post('/',readOnly);
  router.post('/:id/archive',readOnly);
  router.get('/:id',async(req,res)=>{try{
    if(Object.keys(req.query).length)return failure({code:'OPPORTUNITY_INVALID_INPUT'},res);
    res.json({...await service.get(req.params.id,req),permissions:{edit:false,archive:false},capabilities:{evidencedCriteria:Boolean(criteriaService)}});
  }catch(error){failure(error,res);}});
  router.put('/:id',readOnly);
  // Reject unsupported subroutes so they cannot act on F12 UUIDs.
  router.use((req,res)=>res.status(405).json({error:{code:'OPPORTUNITY_OPERATION_NOT_IN_VERTICAL',message:'Operação fora deste fluxo.'}}));
  return router;
}
module.exports={createPrivateOpportunityRouter};
