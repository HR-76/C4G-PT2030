'use strict';
const { evaluateAssurance } = require('../security/assurance');
const { createFundingRepository } = require('./repository');
const { catalogQuery } = require('./catalogQuery');
const { collectionPolicy } = require('./programmes');
const messages = { FUNDING_BUSY: 'Existe outra recolha em curso. Aguarde a sua conclusão.', IDEMPOTENCY_CONFLICT: 'Este pedido já foi usado com outro conteúdo.', FUNDING_FORBIDDEN: 'Sem permissão de administração da plataforma.', MFA_REQUIRED: 'Confirme a autenticação reforçada para atualizar a fonte.', INVALID_INPUT: 'Pedido inválido.', RESOURCE_NOT_AVAILABLE: 'Oportunidade indisponível.' };
messages.FUNDING_WORKER_UNAVAILABLE = 'O serviço de recolha está indisponível. Consulte o estado antes de criar um novo pedido.';
messages.FUNDING_WORKER_UPGRADE_REQUIRED = 'O serviço de recolha precisa de ser atualizado antes de iniciar ciclos completos.';
messages.FUNDING_EU_V2_WRITER_REQUIRED = 'A recolha EU exige o escritor v2 para preservar a fidelidade dos dados. Consulte o estado da integração.';
messages.OPPORTUNITY_READ_LIMIT_EXCEEDED = 'A resposta excede o limite de leitura. Restrinja os filtros ou consulte a ficha individual.';
messages.OPPORTUNITY_VERSION_UNSUPPORTED = 'Esta revisão usa uma versão de dados não suportada pelo leitor.';
messages.OPPORTUNITY_V2_EU_SUSPENDED = 'A recolha EU está suspensa. Consulte o estado da fonte antes de iniciar novos pedidos.';
messages.OPPORTUNITY_V2_SOURCE_FENCE_STALE = 'O estado da fonte EU mudou. Atualize o estado antes de repetir o pedido.';
function createFundingRouters({ express, pool, catalogReader, authenticate, organizationMiddleware, sessionRegistry, policyVersion, recentMfaRequirement, sourceMode = 'fixture', sourceApproval, workerHealth, coverage = {supported:false,enabled:false}, euSourceControlEnabled = false, euWriterV2 = null }) {
  if(!catalogReader||!['list','get','revision'].every(key=>typeof catalogReader[key]==='function'))throw new TypeError('CATALOG_READER_REQUIRED');
  const collection = collectionPolicy(sourceMode, sourceApproval);
  if(coverage.enabled&&!coverage.supported)throw Error('FUNDING_COVERAGE_SCHEMA_REQUIRED');
  if(coverage.enabled)collection.coverage='durable-v1';
  const repository = createFundingRepository({ pool, workerHealth,coverageEnabled:coverage.supported,startCoverage:coverage.enabled,refreshEnabled:coverage.temporalSupported===true,resolutionEnabled:coverage.resolutionSupported===true,enrichmentEnabled:coverage.enrichmentEnabled===true,euSourceControlEnabled,euWriterV2 });
  const manual = require('./manualAuthoring').createCentralManualAuthoring({pool,repository});
  const admin = express.Router(), catalog = express.Router(), platformCatalog = express.Router();
  function handle(work) { return async (req, res) => { try { res.setHeader('Cache-Control', 'no-store'); await work(req, res); } catch (error) { const status = ['FUNDING_FORBIDDEN', 'MFA_REQUIRED'].includes(error.code) ? 403 : ['FUNDING_BUSY','IDEMPOTENCY_CONFLICT','OPPORTUNITY_V2_EU_SUSPENDED','OPPORTUNITY_V2_SOURCE_FENCE_STALE'].includes(error.code) ? 409 : error.code === 'INVALID_INPUT' ? 400 : error.code === 'RESOURCE_NOT_AVAILABLE' ? 404 : 503; res.status(status).json({ error: { code: messages[error.code] ? error.code : 'SERVICE_UNAVAILABLE', message: messages[error.code] || 'Não foi possível concluir o pedido. Consulte o estado antes de tentar novamente.' } }); } }; }
  admin.use(authenticate);
  admin.get('/funding-tenders', handle(async (req, res) => {
    const status=await repository.status(req.user.id);
    let worker;
    if(workerHealth){try{worker=await workerHealth();}catch{worker={state:'UNKNOWN',ready:false,lastHeartbeatAt:null,lastPollAt:null};}}
    if(worker?.ready&&(coverage.enabled&&!worker.coverageSupported||coverage.temporalSupported&&!worker.refreshSupported||coverage.resolutionSupported&&!worker.resolutionSupported||coverage.enrichmentEnabled&&(!worker.enrichmentSupported||!worker.discoveryDetailSupported)))worker={...worker,state:'UPGRADE_REQUIRED',ready:false};
    if(worker?.ready&&euWriterV2&&(worker.euWriterSupported!==true||worker.euWriterPolicyVersion!==euWriterV2.policyVersion||worker.euWriterMappingDigest!==euWriterV2.mappingDigest))worker={...worker,state:'UPGRADE_REQUIRED',ready:false};
    res.json({ ...status, sourceMode, collection,...(worker?{worker}:{} ) });
  }));
  admin.post('/funding-tenders', handle(async (req, res) => {
    if (!req.authContext || !req.body || Array.isArray(req.body) || !Object.hasOwn(req.body,'requestId') || Object.keys(req.body).some(key => !['requestId','source'].includes(key))) throw Object.assign(new Error(), { code: 'INVALID_INPUT' });
    const source = req.body.source === undefined ? 'EU_FUNDING_TENDERS' : req.body.source;
    if (!collection.sources.includes(source)) throw Object.assign(new Error(), { code: 'INVALID_INPUT' });
    if (!evaluateAssurance({ evidence: req.authContext.evidence, requirement: recentMfaRequirement, nowSeconds: Date.now() / 1000, expectedPolicyVersion: policyVersion }).allowed) throw Object.assign(new Error(), { code: 'MFA_REQUIRED' });
    if (sourceMode === 'unconfigured') {
      await repository.status(req.user.id);
      return res.status(503).json({ error: { code: 'SOURCE_NOT_CONFIGURED', message: 'A recolha de oportunidades ainda não está configurada neste ambiente local.' } });
    }
    res.status(202).json(await repository.enqueue(req.user.id, req.body.requestId, source));
  }));
  catalog.use(authenticate, organizationMiddleware.requireServerSession, organizationMiddleware.resolveOrganizationContext);
  catalog.use(handle(async (req, res) => {
    const context = await sessionRegistry.resolveOrganizationContext({ sid: req.sessionID, globalUserId: req.user.id, now: Date.now() });
    if (context?.state !== 'VALID') throw Object.assign(new Error(), { code: 'RESOURCE_NOT_AVAILABLE' });
    if (req.method !== 'GET') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    if (req.path === '/') return res.json({ ...await catalogReader.list(catalogQuery(req.query)), sourceMode });
    if (/^\/[a-f0-9-]+$/i.test(req.path)) return res.json({ ...await catalogReader.get(req.path.slice(1)), sourceMode });
    res.status(404).json({ error: { code: 'RESOURCE_NOT_AVAILABLE' } });
  }));
  // Explicit platform read authority; never bypass organization middleware on client routes.
  platformCatalog.use(authenticate, organizationMiddleware.requireServerSession);
  platformCatalog.post('/', handle(async (req,res) => {
    if (Object.keys(req.query).length) throw Object.assign(new Error(),{code:'INVALID_INPUT'});
    if (!req.authContext || !evaluateAssurance({evidence:req.authContext.evidence,requirement:recentMfaRequirement,
      nowSeconds:Date.now()/1000,expectedPolicyVersion:policyVersion}).allowed)
      throw Object.assign(new Error(),{code:'MFA_REQUIRED'});
    try { res.status(201).json(await manual.create(req.user.id,req.body)); }
    catch(error) {
      if (['OPPORTUNITY_INVALID_INPUT','OPPORTUNITY_UNKNOWN_FIELD','OPPORTUNITY_LIMIT_EXCEEDED'].includes(error.code)) error.code='INVALID_INPUT';
      if (error.code==='OPPORTUNITY_DIGEST_MISMATCH') error.code='IDEMPOTENCY_CONFLICT';
      throw error;
    }
  }));
  platformCatalog.use(handle(async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    if (req.path === '/') return res.json({ ...await repository.platformList(req.user.id, catalogQuery(req.query)), sourceMode });
    if (/^\/[a-f0-9-]+$/i.test(req.path)) return res.json({ ...await repository.platformGet(req.user.id, req.path.slice(1)), sourceMode });
    res.status(404).json({ error: { code: 'RESOURCE_NOT_AVAILABLE' } });
  }));
  return { admin, catalog, platformCatalog };
}
module.exports = { createFundingRouters };
