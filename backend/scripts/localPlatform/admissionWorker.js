'use strict';
// Local privileged process, IPC only. No DDL credentials are returned to HTTP.
const fs=require('node:fs'),path=require('node:path'),tls=require('node:tls'),{Pool}=require('pg');
async function start(configFile){
 const settings=JSON.parse(fs.readFileSync(configFile,'utf8'));
 const cfg=require('./config');
 const proof=settings.isolatedProof;
 if(proof&&(proof.config.host!=='127.0.0.1'||proof.config.port!==5598||proof.config.centralDatabase!=='c4g_f13_authority_synthetic_central'||settings.issuer!=='https://localhost:8283/realms/c4g-manual-proof'))throw Error('ISOLATED_WORKER_REQUIRED');
 const config=proof?cfg.assertTarget(proof.config):cfg.readConfig(),state=proof?proof.state:JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'),'utf8'));
 if(settings.installationId!==state.installationId||!state.admissionAccess||settings.issuer!==state.identity.issuer)throw Error('ADMISSION_CONFIGURATION_INVALID');
 tls.setDefaultCACertificates([...tls.getCACertificates('default'),fs.readFileSync(settings.certificate,'utf8')]);
 const central=new Pool(cfg.connection(config,config.centralDatabase)),admin=new Pool(cfg.connection(config,'postgres'));
 const authority=new Pool({...cfg.connection(config,config.centralDatabase),user:'c4g_authority_runtime',password:state.authorityPassword});
 const coordinator=require('../../src/security/authorityCoordinator').createAuthorityCoordinator({pool:authority,permitSecret:state.permitSecret});
 const directory=require('../../src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central);
 const journal=directoryName=>require('../../src/platformOnboarding/encryptedJournal').createEncryptedJournal({directory:path.join(path.dirname(configFile),directoryName),key:settings.journalKey});
 const provisioner=require('../../src/platformOnboarding/postgresProvisioner').createPostgresProvisioner({adminPool:admin,centralPool:central,connection:cfg.connection(config,'postgres'),journal:journal('provisioning'),ownershipKey:settings.ownershipKey,regionCode:proof?'EU':'LOCAL',residencyPolicyVersion:proof?'onboarding-isolated-v1':'local-development-v1'});
 const registry=require('../../src/entityAdmission/credentialRegistry').createCredentialRegistry({journal:journal('credentials'),directory,async probe(e,snapshot,workload){
  const pool=new Pool({host:e.host,port:e.port,database:e.database,user:e.login,password:e.password,max:1});
  const c=await pool.connect();try{await c.query('BEGIN READ ONLY');const r=(await c.query('SELECT current_database() name,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=session_user')).rows[0];if(r.name!==snapshot.databaseRef||r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolbypassrls)throw Error('CREDENTIAL_BINDING_INVALID');
   const verifier=require('../../src/security/tenantBindingVerifier').createTenantBindingVerifier({async observe(){const observed=await require('../../src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(c,snapshot);return {...observed,schemaVersion:observed.currentVersion,bindingDigest:require('../../src/security/localTenantCredentialAdapter').bindingDigest({...e,workload})};}});
   await verifier.verify({client:c,snapshot,requiredCapabilities:[],correlationId:snapshot.organizationId});await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();await pool.end();}
 }});
 let token,until=0;
 const identity=require('../../src/platformOnboarding/keycloakAdapter').createKeycloakAdapter({issuer:settings.issuer,ownershipKey:settings.ownershipKey,purpose:'ADMISSION',usernameMode:'email',async accessToken(){
  if(token&&Date.now()<until)return token;const r=await fetch(settings.issuer+'/protocol/openid-connect/token',{method:'POST',signal:AbortSignal.timeout(15000),body:new URLSearchParams({grant_type:'client_credentials',client_id:settings.clientId,client_secret:settings.clientSecret})});if(!r.ok)throw Error('KEYCLOAK_UNAVAILABLE');const data=await r.json();token=data.access_token;until=Date.now()+Math.max(1,data.expires_in-20)*1000;return token;
 }});
 const policy=require('../../src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES[state.identity.policyVersion];
 const completion=require('../../src/entityAdmission/completionService').createCompletionService({coordinator,issuer:settings.issuer,policyVersion:state.identity.policyVersion,assuranceRequirements:policy.policy[policy.privilegedCategory],mfaPolicyCode:'USER_OPTIONAL',dataResidencyCode:'LOCAL',tenant:{ensure:x=>provisioner.ensure(x)},projection:{ensure:x=>provisioner.project(x)},publishCredentials:async x=>registry.publish(Object.fromEntries(['operationId','organizationId','globalUserId','membershipId'].map(k=>[k,x[k]])),await provisioner.apiCredentials(x),await provisioner.workerCredentials(x))});
 const worker=require('../../src/entityAdmission/completionWorker').createCompletionWorker(completion);
 let stopping=false,inFlight=null,lastPass=0;
 const tick=()=>{if(stopping||inFlight)return;inFlight=worker.runOnce().then(()=>{lastPass=Date.now()}).catch(()=>{}).finally(()=>{inFlight=null});};
 tick();const timer=setInterval(tick,3000);
 const methods={identity:x=>identity.ensure(x),passwordReady:x=>identity.passwordReady(x.subject),resolve:x=>registry.resolve(x),health:async()=>({ready:Date.now()-lastPass<15000}),async memberProjection(x){
  const snapshot=await directory.resolveSnapshotByOrganization(x.organizationId,'API'),credentials=await registry.resolve({...snapshot,workload:'API'});
  return require('../../src/platformOnboarding/memberProjection').createMemberProjection({bindings:[{organizationId:x.organizationId,snapshot,credentials}]}).ensure(x);
 }};
 process.on('message',async m=>{try{if(!Object.hasOwn(methods,m.method))throw Error('WORKER_METHOD_DENIED');process.send?.({id:m.id,result:await methods[m.method](m.value)});}catch{process.send?.({id:m.id,error:'ONBOARDING_STEP_UNCONFIRMED'});}});
 process.on('disconnect',async()=>{stopping=true;clearInterval(timer);await inFlight;await Promise.all([authority.end(),central.end(),admin.end()]);process.exit(0);});
 process.send?.({ready:true});
}
if(require.main===module)start(process.argv[2]).catch(()=>process.exit(1));
module.exports={start};
