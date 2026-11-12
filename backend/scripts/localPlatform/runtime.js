'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { Pool } = require('pg');
const { root, folder, readConfig, connection, connectionUrl, assertTarget } = require('./config');
const { identityConfig } = require('./identity');
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../src/security/authConfig');
const { supportsCentralVersion } = require('./centralVersions');

// Optional daily collection (state.funding.schedule = {userId, sources?, at?}); only defined keys are exported.
function fundingScheduleEnvironment(schedule) {
  if (!schedule) return {};
  return { FUNDING_TENDERS_SCHEDULE: 'daily-v1', FUNDING_TENDERS_SCHEDULE_USER_ID: schedule.userId,
    ...(schedule.sources ? { FUNDING_TENDERS_SCHEDULE_SOURCES: schedule.sources.join(',') } : {}),
    ...(schedule.at ? { FUNDING_TENDERS_SCHEDULE_AT: schedule.at } : {}) };
}
function runtimeEnvironment(config, state, controlledAdmission) {
  assertTarget(config);
  if (state.phase !== 'READY' || state.target.centralDatabase !== config.centralDatabase
      || state.target.tenantDatabase !== config.tenantDatabase || state.target.port !== config.port
      || state.target.host !== config.host) throw Error('LOCAL_PLATFORM_SETUP_REQUIRED');
  if (state.credentials?.host !== config.host || state.credentials?.port !== config.port
      || state.credentials?.database !== config.tenantDatabase || state.credentials?.tenantId !== state.tenantId
      || state.credentials?.login !== 'c4g_local_api' || state.snapshot?.tenantId !== state.tenantId
      || state.snapshot?.organizationId !== state.organizationId) throw Error('LOCAL_TENANT_BINDING_INVALID');
  const origin = state.identity.origin || 'http://localhost:3000';
  const publicUrl = new URL(origin), issuer = new URL(state.identity.issuer);
  const policyVersion = state.identity.policyVersion || 'c4g-assurance-v1';
  const optional = policyVersion === 'c4g-user-mfa-v1';
  const expectedRealm = optional ? state.identity.clientId : 'c4g-test';
  const policy = RECOGNIZED_ASSURANCE_POLICIES[policyVersion];
  if (publicUrl.origin !== origin || publicUrl.protocol !== 'http:' || publicUrl.hostname !== 'localhost'
      || issuer.protocol !== 'https:' || issuer.hostname !== 'localhost' || issuer.port !== '8443'
      || issuer.pathname !== '/realms/' + expectedRealm || issuer.search || issuer.hash || issuer.username || issuer.password
      || !policy || (!optional && policyVersion !== 'c4g-assurance-v1')
      || (optional && !/^c4g-native-[a-z0-9-]+$/.test(expectedRealm))) throw Error('LOCAL_IDENTITY_TARGET_INVALID');
  if (state.funding && (state.funding.source !== 'live-local' || !['five-public-records', 'central-programmes-100', 'central-official-sources-100'].includes(state.funding.approval)
    || config.centralDatabase !== 'c4g_central_dev' || config.port !== 5432 || origin !== 'http://localhost:3000')) throw Error('LOCAL_FUNDING_TARGET_INVALID');
  const activationEnvironment = require('./opportunityV2Runtime').opportunityV2RuntimeEnvironment(config, state);
  const euWriterEnvironment = require('./euWriterRuntime').euWriterRuntimeEnvironment(state, activationEnvironment);
  return { ...require('./catalogReadRuntime').catalogReadRuntimeEnvironment(state, controlledAdmission), ...require('./catalogReaderConfig').catalogReaderEnvironment(config, state), ...activationEnvironment, ...euWriterEnvironment,
    ...(state.billingPdfs?.mode==='local-private'?{BILLING_PDF_RUNTIME:'local-private',BILLING_PDF_LOCAL_ROOT:path.join(folder,'billing-pdfs','objects')}:{ }),
    AUTH_MODE: 'oidc', FUNDING_TENDERS_RUNTIME: 'central',
    FUNDING_TENDERS_SOURCE: state.funding?.source || 'unconfigured', FUNDING_TENDERS_REHEARSAL_APPROVED: state.funding?.approval,
    FUNDING_TENDERS_COVERAGE: state.funding?.coverage || 'disabled',
    ...fundingScheduleEnvironment(state.funding?.schedule),
    NODE_ENV: 'development', PORT: '5000', PUBLIC_APP_URL: origin, CORS_ORIGIN: origin,
    ...(state.identity.emailVerification === true ? { OIDC_EMAIL_VERIFICATION: 'keycloak-account-v1' } : {}),
    OIDC_ISSUER: state.identity.issuer, OIDC_CLIENT_ID: state.identity.clientId,
    OIDC_REDIRECT_URI: origin + '/api/auth/oidc/callback', OIDC_POST_LOGOUT_REDIRECT_URI: origin + '/login',
    SESSION_SECRET: state.sessionSecret, SESSION_COOKIE_NAME: 'c4g_native_local',
    SESSION_IDLE_MS: '1800000', SESSION_ABSOLUTE_MS: '28800000', OIDC_TRANSACTION_MS: '600000',
    AUTH_POLICY_VERSION: policyVersion, AUTH_ASSURANCE_POLICY_JSON: JSON.stringify(policy.policy),
    PRIVILEGED_LOGIN_ASSURANCE_CATEGORY: policy.privilegedCategory,
    AUTHORITY_COMMIT_PERMIT_SECRET: state.permitSecret, CENTRAL_DATABASE_URL: connectionUrl(config, config.centralDatabase),
    OPPORTUNITY_API_CREDENTIALS_JSON: JSON.stringify([state.credentials]),
    OPPORTUNITY_ALLOWED_RESIDENCY_JSON: JSON.stringify([{ regionCode: 'LOCAL', policyVersion: 'local-development-v1' }]) };
}
function trustLocalIdentityCertificate() {
  const tls = require('node:tls');
  const certificate = identityConfig().NODE_EXTRA_CA_CERTS;
  if (!certificate || typeof tls.setDefaultCACertificates !== 'function') throw Error('LOCAL_IDP_CA_CONFIGURATION_REQUIRED');
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), fs.readFileSync(certificate, 'utf8')]);
}
async function listenLocalApi(app, port, lifecycle) {
  // Docker Desktop reaches this host through IPv4, while localhost can bind to ::1.
  const server = app.listen(port, '127.0.0.1');
  await once(server, 'listening');
  try {
    lifecycle.start();
    return server;
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
}

async function startNative({ config = readConfig(), state = JSON.parse(fs.readFileSync(path.join(folder, 'runtime.json'))), port = 5000 } = {}) {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw Error('LOCAL_PLATFORM_DEVELOPMENT_ONLY');
  trustLocalIdentityCertificate();
  let env, catalogStartup, composition; const express = require('express'), cors = require('cors');
  const centralPool = new Pool(connection(config, config.centralDatabase));
  const authorityPool = new Pool({ ...connection(config, config.centralDatabase), user: 'c4g_authority_runtime', password: state.authorityPassword });
  let platformLogs, runtime, server, memberWorker, memberService, memberOidc, bridgeServer, admissionWorker, admissionService, admissionOidc,admissionSupervisor;
  try {
    const centralReady = await require('../../src/security/centralMigrationPreflight').preflightCentral(centralPool);
    if(state.catalogRead?.mode==='controlled'){
      if(!['048_catalog_read_service_v1','049_pt2030_document_upload','050_billing_private_documents','051_email_templates'].includes(centralReady.currentVersion))throw Error('CATALOG_SCHEMA_REQUIRED');
      const settings=JSON.parse(fs.readFileSync(path.join(folder,'catalog-controlled','settings.json'),'utf8'));
      catalogStartup=await require('../../src/opportunities/catalogRead/controlledStartup').prepareControlledStartup({centralPool,target:{host:config.host,port:config.port,database:config.centralDatabase},settings,Pool,express,policyVersion:state.identity.policyVersion||'c4g-assurance-v1',evidenceDirectory:path.join(root,'context/references/opportunity-v2/evidence'),sink:event=>fs.appendFileSync(path.join(folder,'catalog-controlled','telemetry.jsonl'),JSON.stringify(event)+'\n')});
    }
    env=runtimeEnvironment(config,state,catalogStartup?.admission);
    if(catalogStartup)Object.assign(env,{FUNDING_TENDERS_SOURCE:'unconfigured',FUNDING_TENDERS_COVERAGE:'disabled',FUNDING_TENDERS_REHEARSAL_APPROVED:undefined,FUNDING_TENDERS_ENRICHMENT:undefined,OPPORTUNITY_EU_WRITER:'disabled',OPPORTUNITY_11145_EXECUTOR:'disabled'});
    if (state.funding?.approval === 'central-programmes-100' && !supportsCentralVersion(centralReady.currentVersion,'017_funding_programmes')) throw Error('FUNDING_SCHEMA_REQUIRED');
    if (state.funding?.approval === 'central-official-sources-100' && !supportsCentralVersion(centralReady.currentVersion,'018_official_programme_sources')) throw Error('FUNDING_SCHEMA_REQUIRED');
    const coordinator = require('../../src/security/authorityCoordinator').createAuthorityCoordinator({ pool: authorityPool, permitSecret: state.permitSecret });
    if(state.admissionAccess===true){
      if(!state.memberAccess||!supportsCentralVersion(centralReady.currentVersion,'025_entity_admission_completion'))throw Error('ADMISSION_SCHEMA_REQUIRED');
      admissionWorker=require('../../src/platformOnboarding/memberWorkerClient').createMemberWorkerClient(path.join(folder,'admissions','worker.json'),path.join(__dirname,'admissionWorker.js'));
      await admissionWorker.call('health',{});
      admissionSupervisor=setInterval(()=>admissionWorker.call('health',{}).catch(()=>{}),5000);
    }
    runtime = require('../../src/config/opportunityRuntime').createConfiguredOpportunityRuntime({ centralPool, authorityCoordinator: coordinator, env,credentialResolver:admissionWorker?x=>admissionWorker.call('resolve',x):undefined });
    if(!state.memberAccess)runtime.directoryRepository = { async resolveSnapshotByOrganization(org) { return org === state.organizationId ? structuredClone(state.snapshot) : null; } };
    const tenantProbe = new Pool({ ...connection(config, config.tenantDatabase), user: state.credentials.login, password: state.credentials.password });
    try {
      const client = await tenantProbe.connect();
      try { await runtime.bindingVerifier.verify({ client, snapshot: state.snapshot, requiredCapabilities: [],
        correlationId: state.installationId, phase: 'PREPARATION' }); }
      finally { client.release(); }
    } finally { await tenantProbe.end(); }
    const routes = {};
    let createMemberOnboarding;
    if(state.memberAccess===true){
      if(!supportsCentralVersion(centralReady.currentVersion,'021_platform_members'))throw Error('MEMBER_SCHEMA_REQUIRED');
      const settings=JSON.parse(fs.readFileSync(path.join(folder,'members','http.json')));
      if(!require('../../src/security/secretFormat').isSecretHex(settings.bridgeSecret))throw Error('ACTIVATION_BRIDGE_SECRET_INVALID');
      if(settings.installationId!==state.installationId||settings.issuer!==state.identity.issuer||settings.origin!==env.PUBLIC_APP_URL)throw Error('MEMBER_CONFIGURATION_INVALID');
      memberWorker=require('../../src/platformOnboarding/memberWorkerClient').createMemberWorkerClient(path.join(folder,'members','worker.json'));
      env.PLATFORM_ACCESS_RUNTIME='central';
      createMemberOnboarding=({authorityCoordinator,authConfig})=>memberService=require('../../src/platformOnboarding/memberService').createMemberOnboardingService({coordinator:authorityCoordinator,issuer:settings.issuer,policyVersion:authConfig.policyVersion,assuranceRequirements:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],mfaPolicyCode:'USER_OPTIONAL',dataResidencyCode:'LOCAL',identity:{ensure:x=>memberWorker.call('identity',x)},projection:{ensure:x=>admissionWorker&&x.organizationId!==state.organizationId?admissionWorker.call('memberProjection',x):memberWorker.call('projection',x)},verification:{verify:x=>memberOidc.verify(x)},email:{secret:x=>memberWorker.call('activationSecret',x),send:x=>memberWorker.call('activationEmail',x)}});
    }
    const createAdmission=admissionWorker?({authorityCoordinator,authConfig})=>{
      const unused=async()=>{throw Error('WORKER_ONLY');};
      const completion=require('../../src/entityAdmission/completionService').createCompletionService({coordinator:authorityCoordinator,issuer:state.identity.issuer,policyVersion:authConfig.policyVersion,assuranceRequirements:authConfig.assurancePolicy[authConfig.privilegedLoginCategory],mfaPolicyCode:'USER_OPTIONAL',dataResidencyCode:'LOCAL',tenant:{ensure:unused},projection:{ensure:unused},publishCredentials:unused});
      return admissionService=require('../../src/entityAdmission/service').createAdmissionService({coordinator:authorityCoordinator,issuer:state.identity.issuer,completion,listing:require('../../src/entityAdmission/listing').createAdmissionListing({pool:centralPool}),identity:{ensure:x=>admissionWorker.call('identity',x)},verification:{verify:x=>admissionOidc.verify(x)}});
    }:undefined;
    const databaseReadiness=require('./readiness').createNativeReadiness({centralPool,admissionRequired:Boolean(admissionWorker),async probeTenant(){
      const snapshot=state.memberAccess?await runtime.directoryRepository.resolveSnapshotByOrganization(state.organizationId,'API'):state.snapshot;
      const pool=new Pool({...connection(config,config.tenantDatabase),user:state.credentials.login,password:state.credentials.password});
      try{const client=await pool.connect();try{await runtime.bindingVerifier.verify({client,snapshot,requiredCapabilities:[],correlationId:state.installationId,phase:'PREPARATION'});}finally{client.release();}}finally{await pool.end();}
    }});
    if(state.platformLogs===true){
      if(!supportsCentralVersion(centralReady.currentVersion,'026_platform_logs'))throw Error('LOGS_SCHEMA_REQUIRED');
      platformLogs=require('../../src/platformDirectory/logs').createPlatformLogs({pool:centralPool,onFailure:()=>console.error('PLATFORM_LOG_COLLECTION_FAILED')});
    }
    const registrationReady=supportsCentralVersion(centralReady.currentVersion,'024_organization_registration');
    const fundingWorkerHealth=()=>{let heartbeat;try{heartbeat=JSON.parse(fs.readFileSync(path.join(folder,'funding-worker-heartbeat.json')));}catch{}return require('../../src/fundingTenders/workerHealth').workerHealth(heartbeat,{installationId:state.installationId});};
    const fundingCoverage=require('../../src/fundingTenders/coverageConfig').coverageConfig(env.FUNDING_TENDERS_COVERAGE,centralReady.currentVersion,env.FUNDING_TENDERS_ENRICHMENT);
    composition = require('../../src/productionComposition').createProductionComposition({ env, dependencies: { express, cors,platformLogs,createMemberOnboarding,createAdmission,enableRegistration:registrationReady,databaseReadiness,fundingWorkerHealth,fundingCoverage,
      centralPool, authorityPool, routes, createCatalogReadRuntime:catalogStartup?.createRuntime, opportunityRuntimeDependencies: runtime } });
    await composition.assertDatabaseReadiness();
    const app = express();
    if(memberService){
      const settings=JSON.parse(fs.readFileSync(path.join(folder,'members','http.json')));
      memberOidc=await require('../../src/platformOnboarding/oidcActivationAdapter').createOidcActivationAdapter({issuer:settings.issuer,origin:settings.origin,manualClientId:settings.manualClientId,existingClientId:settings.existingClientId,callbackPath:'/api/activation/callback',service:memberService,passwordReady:subject=>memberWorker.call('passwordReady',{subject})});
      if(admissionService){
        admissionOidc=await require('../../src/platformOnboarding/oidcActivationAdapter').createOidcActivationAdapter({issuer:settings.issuer,origin:settings.origin,manualClientId:settings.manualClientId,existingClientId:settings.existingClientId,callbackPath:'/api/admission-activation/callback',service:admissionService,passwordReady:subject=>admissionWorker.call('passwordReady',{subject})});
        const activation=require('../../src/platformOnboarding/activationHttp').createActivationHttp({express,service:admissionService,oidc:admissionOidc,origin:settings.origin,identityOrigin:new URL(settings.issuer).origin,bridgeSecret:settings.bridgeSecret,purpose:'ADMISSION'});
        app.use('/api/admission-activation',activation.router);
      }
      const bridgeOidc={...memberOidc,async bridge(ticket,subject){try{return await memberOidc.bridge(ticket,subject);}catch(error){if(!admissionOidc)throw error;return admissionOidc.bridge(ticket,subject);}}};
      const activation=require('../../src/platformOnboarding/activationHttp').createActivationHttp({express,service:memberService,oidc:bridgeOidc,origin:settings.origin,identityOrigin:new URL(settings.issuer).origin,bridgeSecret:settings.bridgeSecret});
      app.use('/api/activation',activation.router);
      const bridge=express();bridge.use('/bridge',activation.bridge);bridgeServer=bridge.listen(5285,'0.0.0.0');
      await new Promise((resolve,reject)=>{bridgeServer.once('listening',resolve);bridgeServer.once('error',reject)});
    }
    app.get('/api/local-health', async (req, res) => {
      try {
        await centralPool.query('SELECT 1');
        const workerReady = Boolean(catalogStartup) || !state.funding || fundingWorkerHealth().ready;
        const admissionReady=admissionWorker?(await admissionWorker.call('health',{})).ready:true;
        res.status(workerReady&&admissionReady?200:503).json({ ready: workerReady&&admissionReady, environment: 'C4G local', source: env.FUNDING_TENDERS_SOURCE, workerReady,admissionReady });
      }
      catch { res.status(503).json({ ready: false }); }
    });
    app.use(composition.app);
    server = await listenLocalApi(app, port, composition.observability.lifecycle);
    let closing;
    const close = () => closing ||= (async () => {
      clearInterval(admissionSupervisor);
      await new Promise(resolve => server.close(resolve));
      await composition.observability.lifecycle.stop();
      await catalogStartup?.close();
      await composition.closeOpportunityRuntime();
      if(bridgeServer)await new Promise(resolve=>bridgeServer.close(resolve));
      await memberWorker?.close();
      await admissionWorker?.close();
      await runtime.poolManager.closeAll();
      await authorityPool.end();
      await platformLogs?.flush();
      await centralPool.end();
    })();
    return { app, server, close, env };
  } catch (error) {
    clearInterval(admissionSupervisor);
    await catalogStartup?.close();
    await composition?.closeOpportunityRuntime();
    if(bridgeServer?.listening)await new Promise(resolve=>bridgeServer.close(resolve));await memberWorker?.close();await admissionWorker?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (runtime) await runtime.poolManager.closeAll();
    await authorityPool.end(); await centralPool.end(); throw error;
  }
}
module.exports = { fundingScheduleEnvironment, runtimeEnvironment, listenLocalApi, startNative };
