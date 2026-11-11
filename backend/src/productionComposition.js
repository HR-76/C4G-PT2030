const { createApp } = require("./app");
const { loadAuthConfig } = require("./security/authConfig");
const { OidcClient } = require("./security/oidcClient");
const { createSessionSecurity } = require("./security/sessionSecurity");
const { createDatabaseReadiness } = require("./security/databaseReadiness");
const { createIdentityRepository } = require("./security/identityRepository");
const { createPgSessionRegistry } = require("./security/sessionRegistry");
const { createMembershipRepository } = require("./security/membershipRepository");
const { createOrganizationSessionService } = require("./security/organizationSession");
const { createOrganizationContextMiddleware } = require("./middlewares/organizationContext");
const { createOidcAuthController } = require("./controllers/oidcAuthController");
const { createOrganizationAuthController } = require("./controllers/organizationAuthController");
const { createOidcAuthRouter } = require("./routes/oidcAuthRoutes");
const { authenticate, configureAuthentication, createCredentialGuard } = require("./middlewares/authMiddleware");
const { validateProductionAuthorizationBootstrap } = require("./authorization/productionAuthorization");
const { validateProductionAuditBootstrap } = require("./audit/productionAudit");
const { validateProductionDocumentsBootstrap } = require("./documents/productionDocuments");
const { createProductionTelemetry } = require('./productionTelemetry');
const { createOperationalContextMiddleware } = require('./observability/middleware');
const { createOrganizationalScopeProductionComposition } = require('./organizationalScopes/productionComposition');
const { createTaxonomyRuntimeComposition } = require('./organizationalProfile/taxonomyComposition');
const { createTaxonomyTelemetry } = require('./organizationalProfile/taxonomyTelemetry');
const { createAuthorityCoordinator } = require('./security/authorityCoordinator');
const {createAuthoringRuntimeComposition}=require('./organizationalProfile/authoringComposition');
const {createAuthoringTelemetry}=require('./organizationalProfile/authoringTelemetry');
const {createCompetencyRuntimeComposition}=require('./organizationalProfile/competencyComposition');
const {createCompetencyTelemetry}=require('./organizationalProfile/competencyTelemetry');
const {createFinancialRuntimeComposition}=require('./organizationalProfile/financialComposition');
const {createFinancialTelemetry}=require('./organizationalProfile/financialTelemetry');
const {createOperationalRuntimeComposition}=require('./organizationalProfile/operationalComposition');
const {createPopulationRuntimeComposition}=require('./organizationalProfile/populationComposition');
const {createPopulationTelemetry}=require('./organizationalProfile/populationTelemetry');
const {createOperationalTelemetry}=require('./organizationalProfile/operationalTelemetry');

function loadProductionDependencies({ownResource=(resource,dispose)=>dispose}={}) {
  const centralPool = require("./config/centralDb");
  ownResource(centralPool,()=>centralPool.end());
  const authorityPool=require('./config/authorityDb');
  ownResource(authorityPool,()=>authorityPool.end());
  return {
    ownResource,
    express: require("express"), cors: require("cors"), centralPool,authorityPool,routes: {}
  };
}

function selectAuthRoutes(mode, routes, oidcAuth = null) {
  if (mode !== 'oidc') throw new TypeError('C4G runtime requires OIDC.');
  return { ...routes, oidcAuth };
}

function createProductionComposition({ dependencies, env, logger = null, isolatedCatalogAdmission = null, isolatedSessionReadConcurrency = false, observeSessionTiming = null, isolatedSessionTouchCoalescing = false }) {
  if(isolatedSessionTouchCoalescing&&!require('./opportunities/catalogRead/isolatedAdmission').isIsolatedAdmission(isolatedCatalogAdmission))throw new TypeError('Isolated admission required for session touch coalescing');
  const { express, cors, centralPool, routes = {} } = dependencies;
  let closeBillingPdfs=async()=>{},readyBillingPdfs=async()=>{};
  let closeReceiptRecovery = async () => {}, readyReceiptRecovery = async () => {};
  const authConfig = loadAuthConfig(env);
  require('./security/secretFormat').requireProductionSecret(env, 'AUTHORITY_COMMIT_PERMIT_SECRET');
  if (authConfig.mode !== 'oidc') throw new TypeError('C4G runtime requires OIDC.');
  const documentsRuntime=env.DOCUMENTS_RUNTIME||'disabled';
  if(!['disabled','f11-r2'].includes(documentsRuntime)||(documentsRuntime==='f11-r2'&&authConfig.mode!=='oidc'))
    throw new TypeError('Document runtime selection requires F12 and OIDC.');
  const editorialRuntime=env.PROFILE_EDITORIAL_RUNTIME||'disabled';
  if(!['disabled','f13-editorial'].includes(editorialRuntime)||(editorialRuntime==='f13-editorial'&&authConfig.mode!=='oidc'))throw new TypeError('Editorial runtime requires explicit selection and OIDC.');
  if(env.PQ1_ACTIVATION_RUNTIME&&env.PQ1_ACTIVATION_RUNTIME!=='disabled'&&(env.PQ1_ACTIVATION_RUNTIME!=='f13-f14-pq1'||editorialRuntime!=='f13-editorial'))throw new TypeError('PQ1 activation requires the integrated F13/F14 runtime.');
  const importsRuntime=env.OPPORTUNITY_IMPORTS_RUNTIME||'disabled';
  const activationEnabled=require('./opportunities/v2/activationHttp').runtimeEnabled(env);
  const executor11145Enabled=require('./opportunities/v2/activationHttp').executor11145Enabled(env);
  const euWriterV2=require('./fundingTenders/euWriterConfig').configuredEuWriter(env);
  if(!['disabled','f12-xlsx'].includes(importsRuntime))throw new TypeError('C4G imports runtime must be disabled or f12-xlsx.');
  const authorizationCatalogs = validateProductionAuthorizationBootstrap();
  const auditBootstrap = validateProductionAuditBootstrap();
  let documentBootstrap = validateProductionDocumentsBootstrap();
  const telemetry = createProductionTelemetry(logger);
  const { observability, featureTelemetry, httpFailureObserver } = telemetry;
  const organizationalScopes = createOrganizationalScopeProductionComposition({ authorizationCatalogs,
    telemetry: featureTelemetry });
  logger = telemetry.logger;
  if (!centralPool) throw new TypeError("C4G runtime requires a centralPool.");
  if(authConfig.oidcEnabled&&(!dependencies.authorityPool||dependencies.authorityPool===centralPool))
    throw new TypeError('Separate authority pool required.');
  const authorityCoordinator=authConfig.oidcEnabled?createAuthorityCoordinator({pool:dependencies.authorityPool,
    permitSecret:env.AUTHORITY_COMMIT_PERMIT_SECRET,isolatedCatalogAdmission,isolatedSessionReadConcurrency,observeTiming:observeSessionTiming}):null;
  const security = createSessionSecurity({ config: authConfig, pool: authorityCoordinator?.pool||centralPool,authorityCoordinator,observeSessionTiming,coalesceSessionTouches:isolatedSessionTouchCoalescing });
  const admissionService=dependencies.admissionService||dependencies.createAdmission?.({authorityCoordinator,authConfig});
  const registrationService=authConfig.oidcEnabled&&dependencies.enableRegistration!==false?require('./entityAdmission/registrationService').createRegistrationService({coordinator:authorityCoordinator,organizationReader:async id=>{
    const row=(await centralPool.query('SELECT id,legal_name,display_name,type_code,status,reporting_currency FROM public.organization WHERE id=$1',[id])).rows[0];
    return row&&{id:row.id,legalName:row.legal_name,name:row.display_name,typeCode:row.type_code,status:row.status,currency:row.reporting_currency};
  }}):null;
  const databaseReadiness = dependencies.databaseReadiness || createDatabaseReadiness({ centralPool, admissionRequired:Boolean(admissionService||registrationService) });
  observability.health.register({code:'database',criticality:'REQUIRED',check:async()=>{try{const result=await databaseReadiness.check();return result.ready===true;}catch{return false;}}});
  const sessionRegistry = security ? createPgSessionRegistry(centralPool,authorityCoordinator) : null;
  const taxonomies = security ? createTaxonomyRuntimeComposition({ sessionStore: security.sessionStore, sessionRegistry,
    authorityCoordinator,authorizationCatalogs, featureTelemetry, telemetry: createTaxonomyTelemetry({ metrics: observability.metrics }),
    assurancePolicyVersion: authConfig.policyVersion,
    recentMfaRequirement: authConfig.assurancePolicy[authConfig.privilegedLoginCategory] }) : null;
  const profileAuthoring=security?createAuthoringRuntimeComposition({sessionStore:security.sessionStore,sessionRegistry,
    authorityCoordinator,authorizationCatalogs,featureTelemetry,telemetry:createAuthoringTelemetry({metrics:observability.metrics}),
    assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]}):null;
  const profileCompetencies=security?createCompetencyRuntimeComposition({sessionStore:security.sessionStore,sessionRegistry,
    authorityCoordinator,authorizationCatalogs,featureTelemetry,telemetry:createCompetencyTelemetry({metrics:observability.metrics}),
    assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]}):null;
  configureAuthentication({ ...authConfig, sessionRegistry });
  const profileFinancial=security?createFinancialRuntimeComposition({sessionStore:security.sessionStore,sessionRegistry,
    authorityCoordinator,authorizationCatalogs,featureTelemetry,telemetry:createFinancialTelemetry({metrics:observability.metrics}),
    assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]}):null;
  const profileOperational=security?createOperationalRuntimeComposition({sessionStore:security.sessionStore,sessionRegistry,
    authorityCoordinator,authorizationCatalogs,featureTelemetry,telemetry:createOperationalTelemetry({metrics:observability.metrics}),
    assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]}):null;
  const profilePopulations=security?createPopulationRuntimeComposition({sessionStore:security.sessionStore,sessionRegistry,
    authorityCoordinator,authorizationCatalogs,featureTelemetry,telemetry:createPopulationTelemetry({metrics:observability.metrics}),
    assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]}):null;
  let composedRoutes = selectAuthRoutes(authConfig.mode, routes);
  let ownedOpportunityPoolManager = null;
  let catalogReader = null;
  let opportunityActivation = null;
  let documentInfrastructure = null;
  let closeDocumentInfrastructure = async()=>{};
  let closeCentralImport = async()=>{};
  let closeCatalogReader = async()=>{};
  let closeOwnedTenantPools = async()=>{};
  let functionalRuntimeDependencies = null;
  const memberOnboarding=security&&dependencies.createMemberOnboarding?.({authorityCoordinator,authConfig});
  if (security) {
    security.credentialGuard = createCredentialGuard();
    const oidcClient = new OidcClient(authConfig);
    const membershipRepository = createMembershipRepository(centralPool,authorityCoordinator);
    const organizationSession = createOrganizationSessionService({ membershipRepository, sessionRegistry });
    const organizationMiddleware = createOrganizationContextMiddleware({ organizationSession });
    const controller = createOidcAuthController({
      config: authConfig,
      oidcClient,
      identityRepository: createIdentityRepository(authorityCoordinator),
      membershipRepository,
      sessionRegistry,
      audit: (event,details) => { dependencies.platformLogs?.audit(event,details); }
    });
    const organizationController = createOrganizationAuthController({
      organizationSession,
      generateCsrfToken: security.generateCsrfToken
    });
    const oidcAuth = createOidcAuthRouter({
      express,
      controller,
      organizationController,
      resolveOrganizationContext: organizationMiddleware.resolveOrganizationContext,
      requireServerSession: organizationMiddleware.requireServerSession,
      authenticate,
      generateCsrfToken: security.generateCsrfToken
    });
    composedRoutes = selectAuthRoutes(authConfig.mode, routes, oidcAuth);
    const centralImports=dependencies.centralImportRuntime||require('./portugal2030/uploadRuntime').configuredCentralImport({pool:centralPool,env});
    if(centralImports)closeCentralImport=dependencies.ownResource?.(centralImports,()=>centralImports.close())||(()=>centralImports.close());
    composedRoutes.platformDirectory=require('./routes/platformDirectoryRoutes').createPlatformDirectoryRouter({express,authenticate,registration:registrationService,centralImports,
      members:memberOnboarding,
      access:env.PLATFORM_ACCESS_RUNTIME==='central'?require('./platformDirectory/access').createPlatformAccess({coordinator:authorityCoordinator,policyVersion:authConfig.policyVersion,assuranceRequirements:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],recentMfaRequirement:authConfig.assurancePolicy['recent-mfa']}):null,
      service:require('./platformDirectory/service').createPlatformDirectory({pool:centralPool,logs:dependencies.platformLogs,health:observability.health})});
    const platformBillingService=require('./platformBilling/service').createPlatformBillingService({
      coordinator:authorityCoordinator,centralPool
    });
    const customerBillingService=require('./customerBilling/service').createCustomerBillingComposition({
      sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,centralPool,
      assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]
    });
    const billingPdfs=require('./customerBilling/pdfRuntime').configuredBillingPdfs({pool:centralPool,customerService:customerBillingService,env});
    if(billingPdfs)readyBillingPdfs=()=>billingPdfs.ready();
    if(billingPdfs)closeBillingPdfs=dependencies.ownResource?.(billingPdfs,()=>billingPdfs.close())||(()=>billingPdfs.close());
    composedRoutes.platformBilling=require('./platformBilling/http').createPlatformBillingRouter({
      express,service:platformBillingService,authenticate,pdfs:billingPdfs?.service
    });
    composedRoutes.customerBilling=require('./customerBilling/http').createCustomerBillingRouter({
      express,authenticate,organizationMiddleware,service:customerBillingService,pdfs:billingPdfs?.service
    });
    if(activationEnabled){
      opportunityActivation=require('./opportunities/v2/activationHttp').createOpportunityActivationHttpRuntime({
        express,pool:centralPool,authenticate,requireServerSession:organizationMiddleware.requireServerSession,
        originProtection:security.originProtection,csrfProtection:security.csrfProtection,
        policyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
        executorMode:executor11145Enabled?'bounded-v2':'disabled',euWriterCapability:euWriterV2,workerHealth:dependencies.fundingWorkerHealth
      });
      composedRoutes.opportunityActivation=opportunityActivation.router;
    }
    if(env.FUNDING_TENDERS_RUNTIME==='central') {
      catalogReader=require('./fundingTenders/catalogReader').createCatalogReader({env});
      closeCatalogReader=dependencies.ownResource?.(catalogReader,()=>catalogReader.close())||(()=>catalogReader.close());
      observability.health.register({code:'catalog-reader',criticality:'REQUIRED',check:async()=>{try{await catalogReader.ready();return true;}catch{return false;}}});
      const funding=require('./fundingTenders/http').createFundingRouters({express,pool:centralPool,catalogReader,authenticate,organizationMiddleware,sessionRegistry,
        sourceMode:env.FUNDING_TENDERS_SOURCE||'fixture', sourceApproval:env.FUNDING_TENDERS_REHEARSAL_APPROVED,workerHealth:dependencies.fundingWorkerHealth,
        coverage:dependencies.fundingCoverage,euSourceControlEnabled:activationEnabled,euWriterV2,
        policyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]});
      composedRoutes={...composedRoutes,fundingAdmin:funding.admin,centralOpportunities:funding.catalog,platformCentralOpportunities:funding.platformCatalog};
    }
    {
      const runtimeDependencies=dependencies.opportunityRuntimeDependencies || require('./config/opportunityRuntime')
        .createConfiguredOpportunityRuntime({centralPool,authorityCoordinator,env,editorialEnabled:editorialRuntime==='f13-editorial',documentsEnabled:env.DOCUMENTS_RUNTIME==='f11-r2'});
      functionalRuntimeDependencies=runtimeDependencies;
      authorityCoordinator.registerRuntimeRecovery(require('./security/tenantAuthorityRecovery').createTenantAuthorityRecovery(runtimeDependencies));
      if (env.F12_RECEIPT_RECOVERY_DATABASE_URL) {
        const { Pool } = require('pg');
        const central = new Pool({ connectionString: env.F12_RECEIPT_RECOVERY_DATABASE_URL,
          max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
        const recovery = require('./config/f12ReceiptRecoveryService').createF12ReceiptRecoveryService({
          central, tenantRuntimeDependencies: runtimeDependencies,
          onUnavailable: () => logger.warn('c4g.f12.receipt_recovery.unavailable', { component: 'f12', outcome: 'degraded' })
        });
        const close = async () => { try { await recovery.close(); } finally { await central.end(); } };
        closeReceiptRecovery = dependencies.ownResource?.(recovery, close) || close;
        readyReceiptRecovery = () => recovery.ready();
      }
      if (!dependencies.opportunityRuntimeDependencies) {
        ownedOpportunityPoolManager=runtimeDependencies.poolManager;
        closeOwnedTenantPools=dependencies.ownResource?.(ownedOpportunityPoolManager,()=>ownedOpportunityPoolManager.closeAll())||(()=>ownedOpportunityPoolManager.closeAll());
      }
      const opportunityService=require('./opportunities/httpComposition').createOpportunityHttpComposition({
        sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,centralPool,authorizationCatalogs,
        assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
        tenantRuntimeDependencies:runtimeDependencies,authorizationAuditPort:dependencies.opportunityAuthorizationAuditPort,
        onFailure:dependencies.opportunityFailureObserver,
        telemetry:require('./opportunities/telemetry').createOpportunityTelemetry({metrics:observability.metrics})});
      const applicationService=require('./applications/composition').createApplicationComposition({
        sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,centralPool,authorizationCatalogs,
        assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
        tenantRuntimeDependencies:runtimeDependencies,
        tokenKeys:{session:require('node:crypto').createHmac('sha256',authConfig.sessionSecret).update('application-first-slice-cursor-v1').digest('hex')},tokenKeyId:'session',
        onFailure:dependencies.applicationFailureObserver,centralOrigin:catalogReader?.revision||null,centralCurrent:catalogReader?.get||null});
      const interestService=require('./opportunityInterests/composition').createOpportunityInterestComposition({
        sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,
        assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
        tenantRuntimeDependencies:runtimeDependencies,
        tokenKeys:{session:require('node:crypto').createHmac('sha256',authConfig.sessionSecret).update('opportunity-interest-cursor-v1').digest('hex')},tokenKeyId:'session',
        centralOrigin:catalogReader?.revision||null,centralCurrent:catalogReader?.get||null,onFailure:dependencies.applicationFailureObserver});
      composedRoutes={...composedRoutes,opportunityInterests:require('./routes/opportunityInterestRoutes').createOpportunityInterestRouter({express,service:interestService,authenticate,organizationMiddleware})};
      const directoryService=require('./organizationDirectory/composition').createDirectoryComposition({
        registrationService,
        sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,centralPool,authorizationCatalogs,
        assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
        tenantRuntimeDependencies:runtimeDependencies,
        tokenKeys:{session:require('node:crypto').createHmac('sha256',authConfig.sessionSecret).update('organization-directory-cursor-v1').digest('hex')},tokenKeyId:'session',
        onFailure:dependencies.directoryFailureObserver});
      composedRoutes={...composedRoutes,organizationDashboard:require('./routes/organizationDashboardRoutes').createOrganizationDashboardRouter({express,applications:applicationService,opportunities:opportunityService,central:catalogReader,authenticate,organizationMiddleware})};
      composedRoutes={...composedRoutes,organizationDirectory:require('./routes/organizationDirectoryRoutes').createDirectoryRouter({express,service:directoryService,members:memberOnboarding,onFailure:dependencies.directoryFailureObserver,membershipAccess:require('./organizationDirectory/membershipAccess').createMembershipAccess({sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]}),matching:require('./organizationDirectory/matching').createOrganizationMatching({directory:directoryService,opportunities:opportunityService,central:catalogReader}),authenticate,organizationMiddleware})};
      let applicationDocumentAccessPort=null;
      if(documentsRuntime==='f11-r2'){
        if(authConfig.mode!=='oidc')throw new TypeError('Document runtime requires OIDC.');
        const injected=dependencies.applicationDocumentInfrastructure||dependencies.createApplicationDocumentInfrastructure;
        const configuration=injected?require('./config/applicationDocuments').loadApplicationDocumentConfiguration(env):null;
        const infrastructure=dependencies.applicationDocumentInfrastructure||dependencies.createApplicationDocumentInfrastructure?.({configuration,runtimeDependencies,authorityCoordinator,authorizationCatalogs})||require('./config/documentApiInfrastructure').createDocumentApiInfrastructure({env,runtimeDependencies});
        if(!injected){documentInfrastructure=infrastructure;closeDocumentInfrastructure=dependencies.ownResource?.(infrastructure,()=>infrastructure.close())||(()=>infrastructure.close());observability.health.register({code:'document-runtime',criticality:'REQUIRED',check:()=>infrastructure.check()});}
        applicationDocumentAccessPort=require('./documents/productionDocuments').createProductionDocumentRuntime({applicationService,infrastructure});
        documentBootstrap=injected?validateProductionDocumentsBootstrap({r2:configuration.r2,migrationReady:infrastructure.migrationReady===true,scannerReady:infrastructure.scannerReady===true,reconciliationLagSeconds:infrastructure.reconciliationLagSeconds,runtime:applicationDocumentAccessPort}):Object.freeze({get ready(){return infrastructure.snapshot().ready;},runtime:applicationDocumentAccessPort,handlers:Object.freeze([])});
        if(injected&&!documentBootstrap.ready)throw new TypeError(`Document runtime readiness failed: ${documentBootstrap.reasons.join(',')}`);
      }
      composedRoutes={...composedRoutes,notifications:require('./routes/applicationAlertRoutes').createApplicationAlertRouter({express,service:applicationService,authenticate,organizationMiddleware}),applications:require('./routes/applicationSliceRoutes').createApplicationSliceRouter({
        express,service:applicationService,authenticate,organizationMiddleware,
        documentAccessPort:applicationDocumentAccessPort,onFailure:httpFailureObserver}),opportunities:require('./routes/privateOpportunityRoutes').createPrivateOpportunityRouter({
        express,service:opportunityService,onFailure:httpFailureObserver,criteriaService:editorialRuntime==='f13-editorial'?require('./opportunityCriteria/composition').createCriteriaComposition({onFailure:dependencies.criteriaFailureObserver,sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],tenantRuntimeDependencies:runtimeDependencies,...require('./config/editorialUi').editorialUiConfiguration(env)}):null,authenticate,organizationMiddleware})};
      if(importsRuntime==='f12-xlsx'){
        if(!dependencies.opportunityImportInfrastructure)throw new TypeError('F12 XLSX imports require explicit productive F4/F5/F11 infrastructure.');
        const importData=require('./authorization/authorityDataRepository').createAuthorityDataRepository({coordinator:authorityCoordinator,
          policyVersion:authConfig.policyVersion,catalogs:authorizationCatalogs,
          recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory]});
        const importAuthority=require('./security/authenticatedAuthority').createTaxonomySessionAuthority({sessionStore:security.sessionStore,
          sessionRegistry,authorityCoordinator,membershipPort:importData.membershipPort,authorizationDataPort:importData.authorizationDataPort,
          policyVersion:authConfig.policyVersion});
        const requestContextPort=Object.freeze({async resolve(request){const handle=await importAuthority.captureAuthenticatedRequest(request);return importAuthority.resolve(handle);}});
        const workerContextPort=require('./opportunityImports/authorityPorts').createOpportunityImportWorkerContextPort({
          membershipPort:importData.membershipPort,authorizationDataPort:importData.authorizationDataPort});
        const importComposition=require('./opportunityImports/productionComposition').createOpportunityImportProductionComposition({
          ...dependencies.opportunityImportInfrastructure,requestContextPort,workerContextPort,tenantDirectory:runtimeDependencies.directoryRepository,
          telemetry:dependencies.opportunityImportTelemetry||require('./opportunityImports/telemetry').createOpportunityImportTelemetry({metrics:observability.metrics})});
        composedRoutes={...composedRoutes,imports:require('./routes/privateOpportunityImportRoutes').createPrivateOpportunityImportRouter({express,multer:require('multer'),workflow:importComposition.workflow,contextPort:importComposition.contextPort,authenticate,organizationMiddleware})};
      }else{
        const disabled=express.Router();disabled.use((req,res)=>res.status(503).json({error:{code:'OPPORTUNITY_IMPORT_NOT_CONFIGURED',message:'A importação privada não está configurada neste runtime.'}}));composedRoutes={...composedRoutes,imports:disabled};
      }
    }
  }
  if(editorialRuntime==='f13-editorial'){
    if(!functionalRuntimeDependencies){
      functionalRuntimeDependencies=dependencies.opportunityRuntimeDependencies||require('./config/opportunityRuntime')
        .createConfiguredOpportunityRuntime({centralPool,authorityCoordinator,env,editorialEnabled:true});
      if(!dependencies.opportunityRuntimeDependencies){
        ownedOpportunityPoolManager=functionalRuntimeDependencies.poolManager;
        closeOwnedTenantPools=dependencies.ownResource?.(ownedOpportunityPoolManager,()=>ownedOpportunityPoolManager.closeAll())||(()=>ownedOpportunityPoolManager.closeAll());
      }
    }
    const organizationSession=createOrganizationSessionService({membershipRepository:createMembershipRepository(centralPool,authorityCoordinator),sessionRegistry});
    const organizationMiddleware=createOrganizationContextMiddleware({organizationSession});
    const editorialService=require('./organizationalProfile/editorialComposition').createEditorialHttpComposition({
      sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,
      assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
      tenantRuntimeDependencies:functionalRuntimeDependencies,
      telemetry:require('./organizationalProfile/editorialTelemetry').createEditorialTelemetry({metrics:observability.metrics})});
    const uiConfiguration=require('./config/editorialUi').editorialUiConfiguration(env);
    const editorialUiService=require('./organizationalProfile/editorialUiComposition').createEditorialUiComposition({
      sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,
      assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
      tenantRuntimeDependencies:functionalRuntimeDependencies,mfaCategory:authConfig.privilegedLoginCategory,
      onFailure:dependencies.editorialUiFailureObserver,...uiConfiguration});
    composedRoutes={...composedRoutes,profileEditorialUi:require('./routes/editorialUiRoutes').createEditorialUiRouter({
      express,service:editorialUiService,authenticate,organizationMiddleware})};
    const pq1Service=require('./organizationalProfile/pq1UiComposition').createPq1UiComposition({
      sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,
      assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
      tenantRuntimeDependencies:functionalRuntimeDependencies,mfaCategory:authConfig.privilegedLoginCategory,
      onFailure:dependencies.pq1FailureObserver,...uiConfiguration});
    composedRoutes={...composedRoutes,profilePq1:require('./routes/pq1UiRoutes').createPq1UiRouter({
      express,service:pq1Service,authenticate,organizationMiddleware})};
    if(env.PQ1_ACTIVATION_RUNTIME==='f13-f14-pq1'){
      const effective=require('./prequalification/composition').createPrequalificationComposition({requirePreview:true,
        sessionStore:security.sessionStore,sessionRegistry,authorityCoordinator,authorizationCatalogs,
        assurancePolicyVersion:authConfig.policyVersion,recentMfaRequirement:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],
        tenantRuntimeDependencies:functionalRuntimeDependencies,mfaCategory:authConfig.privilegedLoginCategory,...uiConfiguration});
      const router=require('./routes/pq1ActivationRoutes').createPq1ActivationRouter;
      composedRoutes={...composedRoutes,pq1Activation:router({express,service:effective,authenticate,organizationMiddleware}),
        pq1Consumer:router({express,service:effective,authenticate,organizationMiddleware,consumer:true})};
    }
    composedRoutes={...composedRoutes,profileEditorial:require('./routes/editorialProfileRoutes').createEditorialProfileRouter({
      express,service:editorialService,authenticate,organizationMiddleware})};
  }
  const catalogReadConnection=require('./opportunities/catalogRead/functionalConnection').createCatalogReadConnection({
    mode:env.CATALOG_READ_RUNTIME,createRuntime:dependencies.createCatalogReadRuntime
  });
  const closeCatalogReadConnection=dependencies.ownResource?.(catalogReadConnection,()=>catalogReadConnection.close())||(()=>catalogReadConnection.close());
  if(env.CATALOG_READ_RUNTIME==='controlled')observability.health.register({code:'catalog-unified-read',criticality:'REQUIRED',check:()=>catalogReadConnection.ready()});
  const app = createApp({
    express,
    cors,
    config: { corsOrigin: env.CORS_ORIGIN, nodeEnv: env.NODE_ENV, trustProxyHops: require('./app').parseTrustProxyHops(env.TRUST_PROXY_HOPS), rateLimit: require('./security/rateLimit').loadRateLimitConfig(env) },
    pool: centralPool,
    databaseReadiness,
    routes: {...composedRoutes,catalogRead:catalogReadConnection.router},
    platformLogs: dependencies.platformLogs,
    security,
    ...(admissionService?{
      admissionBoundary:require('./entityAdmission/http').createAdmissionBoundary({service:admissionService,authenticate}),
      admissionRoutes:require('./entityAdmission/http').createAdmissionRoutes({express,service:admissionService,authenticate})
    }:{}),
    reportError: (error) => logger.error('c4g.http.failed', { error, component:'http', operation:'http.request', outcome:'error' }),
    observability:{...observability,contextMiddleware:createOperationalContextMiddleware({service:'c4g-api'})}
  });
  return {
    app, authMode: authConfig.mode, importsRuntime,authorizationCatalogs, auditBootstrap, documentBootstrap,
    closeOpportunityRuntime:async()=>{try{await closeCatalogReadConnection();}finally{await closeReceiptRecovery();await closeCentralImport();await closeBillingPdfs();await closeDocumentInfrastructure();await closeCatalogReader();await closeOwnedTenantPools();}},
    organizationalScopes, taxonomies, profileAuthoring,profileCompetencies,profileFinancial,profileOperational,profilePopulations,observability, featureTelemetry, logger, port: env.PORT || 5000,
    assertDatabaseReadiness:async()=>{await databaseReadiness.assertReady();await readyBillingPdfs();await catalogReader?.ready();await documentInfrastructure?.assertReady();await opportunityActivation?.assertReady();await catalogReadConnection.ready();await readyReceiptRecovery();},
    logFrontendUrlHealth: () => logFrontendUrlHealth(env, logger)
  };
}

function parseUrlList(value) {
  if (!value) return [];
  return String(value).split(",").map(item => item.trim()).filter(Boolean).filter(item => /^https?:\/\//i.test(item));
}

function logFrontendUrlHealth(env, logger) {
  const frontendCandidates = parseUrlList([env.PUBLIC_APP_URL, env.APP_URL, env.FRONTEND_PUBLIC_URL, env.FRONTEND_URL,
    env.RENDER_EXTERNAL_HOSTNAME ? `https://${env.RENDER_EXTERNAL_HOSTNAME}` : null]);
  const corsCandidates = parseUrlList(env.CORS_ORIGIN);
  if (env.NODE_ENV !== "production" && frontendCandidates.length === 0) {
    logger.warn('c4g.config.warning',{component:'frontend_url',operation:'api.start',outcome:'degraded'}); return;
  }
  if (frontendCandidates.length === 0) {
    logger.warn('c4g.config.warning',{component:'frontend_url',operation:'api.start',outcome:'degraded'}); return;
  }
  const isLocalhost = url => /^https?:\/\/(localhost|127\.0\.0\.1):\d+/i.test(url);
  const localFrontends = frontendCandidates.filter(isLocalhost);
  const remoteFront = frontendCandidates.some(value => !isLocalhost(value));
  if (!remoteFront && env.NODE_ENV === "production") logger.warn('c4g.config.warning',{component:'frontend_url',operation:'api.start',outcome:'degraded'});
  if (corsCandidates.length > 0 && remoteFront && localFrontends.length > 0) {
    const firstCors = corsCandidates[0];
    const firstFrontend = frontendCandidates.find(value => !isLocalhost(value)) || frontendCandidates[0];
    try {
      if (new URL(firstCors).host.split(":")[0] !== new URL(firstFrontend).host.split(":")[0]) {
        logger.warn('c4g.config.warning',{component:'frontend_url',operation:'api.start',outcome:'degraded'});
      }
    } catch { /* Best-effort startup warning only. */ }
  }
}

module.exports = { createProductionComposition, loadProductionDependencies, selectAuthRoutes };
