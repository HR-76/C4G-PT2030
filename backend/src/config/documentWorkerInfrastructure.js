'use strict';

const path=require('node:path');
const {Pool}=require('pg');
const {guardPool}=require('./poolResilience');
const queueProfile=require('../security/documentQueueProfile');
const {createTenantDirectoryReader}=require('../security/tenantDirectoryReader');
const {createAuthorityCoordinator}=require('../security/authorityCoordinator');
const {observeTenantRuntimeMetadata}=require('../security/tenantRuntimeMetadata');
const {bindingDigest}=require('../security/localTenantCredentialAdapter');
const {validateLocalTenantRoleChain}=require('../security/localTenantIdentityProvisioner');
const {createPgBossQueueAdapter}=require('../async/adapters/pgBossQueueAdapter');
const {InboxRepository}=require('../async/inboxRepository');
const {OutboxRepository}=require('../async/outboxRepository');
const {OutboxRelay}=require('../async/outboxRelay');
const {createPersistentRetryPort}=require('../async/retryPort');
const {createTrustedObservability}=require('../async/envelope');
const {createDocumentRepository}=require('../documents/repository');
const {createR2Storage}=require('../documents/r2Storage');
const {createClamavScanner}=require('../documents/clamavScanner');
const {createScanService}=require('../documents/scanService');
const {createPostgresDocumentWorkerPorts,transaction}=require('../documents/postgresWorkerPorts');
const {loadApplicationDocumentConfiguration}=require('./applicationDocuments');
const {JOBS,SERVICE_ACTORS}=require('../documents/jobs');

const SCHEMA_VERSION='032_document_worker_runtime';
const SCHEMA_VERSIONS=Object.freeze([SCHEMA_VERSION,'033_organizational_opportunity_interests',require('../security/opportunityV2MigrationPackage').tenantAddition.version,
 require('../security/tenantMigrationManifest').APPLICATION_CHAT_SCHEMA_VERSION]);
const REQUIRED=Object.freeze(['F9_ASYNC_EXECUTION','F9_EXECUTION_LINEAGE','F7_AUDIT_LEDGER','F11_PRIVATE_DOCUMENT_STORAGE','APPLICATION_DOCUMENT_TRANSPORT','DOCUMENT_WORKER_RUNTIME']);
const QUEUES=Object.freeze({'document.scan':'c4g.document.scan','document.reconcile':'c4g.document.reconcile','document.expire_upload':'c4g.document.expire-upload'});

function json(env,name){try{return JSON.parse(env[name]);}catch{throw new TypeError(`${name} is invalid.`);}}
function positive(env,name,fallback,min,max){if(env[name]===undefined)return fallback;const value=Number(env[name]);if(!Number.isSafeInteger(value)||value<min||value>max)throw new TypeError(`${name} is invalid.`);return value;}
function credentials(env){const values=json(env,'DOCUMENT_WORKER_CREDENTIALS_JSON');if(!Array.isArray(values)||!values.length||values.some(value=>!value||value.workload!=='WORKER'||typeof value.organizationId!=='string'||typeof value.tenantId!=='string'||!Number.isSafeInteger(value.connectionVersion)||typeof value.credentialRef!=='string'||typeof value.databaseGenerationId!=='string'||typeof value.host!=='string'||!Number.isSafeInteger(value.port)||typeof value.database!=='string'||typeof value.login!=='string'||typeof value.password!=='string'||typeof value.ssl!=='boolean'))throw new TypeError('Document worker credential configuration is invalid.');const organizations=new Set(),tuples=new Set();return Object.freeze(values.map(value=>{const tuple=`${value.tenantId}:${value.connectionVersion}:${value.credentialRef}`;if(organizations.has(value.organizationId)||tuples.has(tuple))throw new TypeError('Document worker credential configuration is duplicated.');organizations.add(value.organizationId);tuples.add(tuple);return Object.freeze({...value});}));}
function poolOptions(value){return{host:value.host,port:value.port,database:value.database,user:value.login,password:value.password,ssl:value.ssl?{rejectUnauthorized:true}:false,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:30000};}
function closed(value,keys){return value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}

function loadDocumentWorkerConfiguration(env=process.env){
 require('../security/secretFormat').requireProductionSecret(env,'AUTHORITY_COMMIT_PERMIT_SECRET');
 if(typeof env.DOCUMENT_QUEUE_DATABASE_URL!=='string'||!env.DOCUMENT_QUEUE_DATABASE_URL)throw new TypeError('Document worker DOCUMENT_QUEUE_DATABASE_URL is required.');
 if(typeof env.AUTHORITY_DATABASE_URL!=='string'||!env.AUTHORITY_DATABASE_URL||typeof env.AUTHORITY_COMMIT_PERMIT_SECRET!=='string'||Buffer.byteLength(env.AUTHORITY_COMMIT_PERMIT_SECRET)<32)throw new TypeError('Document worker restricted authority configuration is required.');
 const mode=env.DOCUMENT_WORKER_STORAGE_MODE||'r2';let documents=null,providerPath=null;
 if(mode==='r2')documents=loadApplicationDocumentConfiguration(env);
 else if(mode==='test-provider'){
  if(env.NODE_ENV!=='test'||env.DOCUMENT_WORKER_TEST_ADAPTERS!=='enabled'||!path.isAbsolute(env.DOCUMENT_WORKER_TEST_PROVIDER||''))throw new TypeError('Document worker test provider is forbidden.');
  providerPath=env.DOCUMENT_WORKER_TEST_PROVIDER;
  const host=String(env.C4G_CLAMAV_HOST||''),port=Number(env.C4G_CLAMAV_PORT);if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw new TypeError('Document worker scanner configuration is invalid.');
  documents=Object.freeze({scanner:Object.freeze({host,port})});
 }else throw new TypeError('Document worker storage mode is invalid.');
 return Object.freeze({centralDatabaseUrl:env.DOCUMENT_QUEUE_DATABASE_URL,credentials:credentials(env),mode,documents,providerPath,pollIntervalMs:positive(env,'DOCUMENT_WORKER_POLL_INTERVAL_MS',1000,10,60000),batchSize:positive(env,'DOCUMENT_WORKER_BATCH_SIZE',5,1,10),graceMs:positive(env,'DOCUMENT_WORKER_GRACE_MS',30000,0,300000),forcedCancelMs:positive(env,'DOCUMENT_WORKER_FORCED_CANCEL_MS',5000,0,60000),leaseMs:positive(env,'DOCUMENT_WORKER_LEASE_MS',30000,100,300000)});
}

function testProvider(configuration,env){const loaded=require(configuration.providerPath);if(!loaded||!closed(loaded,['createDocumentWorkerStorageProvider'])||typeof loaded.createDocumentWorkerStorageProvider!=='function')throw new TypeError('Document worker test provider contract is invalid.');const provider=loaded.createDocumentWorkerStorageProvider({env});if(!provider||!closed(provider,['create','close'])||typeof provider.create!=='function'||typeof provider.close!=='function')throw new TypeError('Document worker test provider is incomplete.');return provider;}
function r2Provider(configuration){const stores=new Map();return Object.freeze({create({organizationId}){if(!stores.has(organizationId))stores.set(organizationId,createR2Storage(configuration.documents.r2,{organizationId,credentials:configuration.documents.credentials}));return stores.get(organizationId);},async close(){const failures=[];for(const store of stores.values())try{await store.shutdown();}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failures,'Document storage shutdown failed.');}});}

function createInfrastructureClose(cleanup){let closing;return function close(){return closing||=(async()=>cleanup())();};}

async function createDocumentWorkerInfrastructure({env=process.env,telemetry=null}={}){
 const config=loadDocumentWorkerConfiguration(env),centralPool=guardPool(new Pool({connectionString:config.centralDatabaseUrl,options:queueProfile.options,max:6}),'document-worker-central'),authorityPool=guardPool(new Pool({connectionString:env.AUTHORITY_DATABASE_URL,max:4}),'document-worker-authority'),pools=new Map(),ports=new Map();let queue=null,storageProvider;
 const close=createInfrastructureClose(async()=>{const failures=[];try{await storageProvider?.close();}catch(error){failures.push(error);}for(const pool of pools.values())try{await pool.end();}catch(error){failures.push(error);}for(const pool of [centralPool,authorityPool])try{await pool.end();}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failures,'Document worker infrastructure shutdown failed.');});
 try{
  const coordinator=createAuthorityCoordinator({pool:authorityPool,permitSecret:env.AUTHORITY_COMMIT_PERMIT_SECRET});
  const directory=createTenantDirectoryReader({coordinator,organizations:config.credentials.map(value=>value.organizationId),workload:'WORKER'});
  storageProvider=config.mode==='r2'?r2Provider(config):testProvider(config,env);
  const queueClient=await centralPool.connect();try{const login=(await queueClient.query('SELECT session_user login')).rows[0].login;await queueProfile.validateDocumentQueueProfile(queueClient,{login,requireSelected:true});await queueProfile.assertSchema(queueClient);}finally{queueClient.release();}
  for(const credential of config.credentials){
   const snapshot=await directory.resolveSnapshotByOrganization(credential.organizationId,'WORKER');
   if(!snapshot||snapshot.tenantId!==credential.tenantId||snapshot.connectionVersion!==credential.connectionVersion||snapshot.credentialRef!==credential.credentialRef||snapshot.databaseGenerationId!==credential.databaseGenerationId||snapshot.bindingDigest!==bindingDigest(credential))throw new Error('DOCUMENT_WORKER_TENANT_BINDING_REQUIRED');
   const pool=guardPool(new Pool(poolOptions(credential)),'document-worker-tenant');pools.set(credential.organizationId,pool);const client=await pool.connect();
   try{await client.query('BEGIN TRANSACTION READ ONLY');const login=(await client.query('SELECT session_user,current_user,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication FROM pg_roles r WHERE r.rolname=session_user')).rows[0];if(!login||login.current_user!==login.session_user||!login.rolcanlogin||login.rolinherit||login.rolsuper||login.rolbypassrls||login.rolcreatedb||login.rolcreaterole||login.rolreplication)throw new Error('DOCUMENT_WORKER_LIMITED_LOGIN_REQUIRED');await validateLocalTenantRoleChain(client,{login:login.session_user,workload:'WORKER',functionalRoles:['c4g_document_worker_runtime','c4g_document_runtime','c4g_f4_metadata_executor']});const observed=await observeTenantRuntimeMetadata(client,{tenantId:credential.tenantId,databaseGenerationId:credential.databaseGenerationId});if(!SCHEMA_VERSIONS.includes(observed.currentVersion)||REQUIRED.some(capability=>!observed.capabilities.includes(capability)))throw new Error('DOCUMENT_WORKER_SCHEMA_INCOMPATIBLE');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
   const repository=createDocumentRepository(pool),storage=await storageProvider.create({organizationId:credential.organizationId,tenantId:credential.tenantId,pool}),scanner=createClamavScanner({organizationId:credential.organizationId,storage,host:config.documents.scanner.host,port:config.documents.scanner.port}),postgres=createPostgresDocumentWorkerPorts({pool,organizationId:credential.organizationId,tenantId:credential.tenantId,telemetry});
   const [storageHealth,scannerHealth]=await Promise.all([storage.health(),scanner.health()]);if(storageHealth?.ready!==true||scannerHealth?.ready!==true)throw new Error('DOCUMENT_WORKER_DEPENDENCY_UNAVAILABLE');
   ports.set(credential.organizationId,Object.freeze({repository,storage,scanService:createScanService({scanner,repository,storage,audit:postgres.audit,telemetryPort:telemetry}),audit:postgres.audit,reconciliation:postgres.reconciliation}));
  }
  const version=Number((await centralPool.query('SELECT version FROM pgboss.version')).rows[0]?.version),names=(await centralPool.query('SELECT name FROM pgboss.queue WHERE name=ANY($1::text[])',[Object.values(QUEUES)])).rows.map(row=>row.name);if(names.length!==JOBS.length)throw new Error('DOCUMENT_WORKER_QUEUE_REQUIRED');
  queue=await createPgBossQueueAdapter({connectionString:config.centralDatabaseUrl,options:queueProfile.options,queueMap:QUEUES,inspectSchema:async()=>({schema:'pgboss',schemaVersion:version})});
  const transactionResolver=Object.freeze({async resolve(organizationId,envelope){const pool=pools.get(organizationId),actor=SERVICE_ACTORS[envelope?.jobType];if(!pool||envelope?.organizationId!==organizationId||envelope?.actor?.kind!=='SERVICE'||!actor||envelope.actor.serviceActorCode!==actor.code||envelope.operation!==actor.operation||envelope.payload?.organizationId!==organizationId)throw Object.assign(new Error('AUTHORIZATION_REVOKED'),{code:'AUTHORIZATION_REVOKED'});return work=>transaction(pool,'c4g_document_worker_runtime',organizationId,work);}});
  const outbox=new OutboxRepository(),relays=[...pools.entries()].map(([organizationId,pool])=>new OutboxRelay({repository:outbox,queue,transaction:work=>transaction(pool,'c4g_document_worker_runtime',organizationId,work),workerId:`document-relay-${organizationId}`,telemetryPort:telemetry}));
  return Object.freeze({queue,inbox:new InboxRepository(),transactionResolver,relay:Object.freeze({async poll(){const result=[];for(const relay of relays)result.push(...await relay.poll());return Object.freeze(result);}}),portsForOrganization(organizationId){const value=ports.get(organizationId);if(!value)throw Object.assign(new Error('AUTHORIZATION_REVOKED'),{code:'AUTHORIZATION_REVOKED'});return value;},retryPortFactory:registry=>createPersistentRetryPort({outboxRepository:outbox,registry,observabilityFactory:()=>createTrustedObservability({traceparent:null,tracestate:null})}),continuous:true,pollIntervalMs:config.pollIntervalMs,batchSize:config.batchSize,graceMs:config.graceMs,forcedCancelMs:config.forcedCancelMs,leaseMs:config.leaseMs,errorObserver:error=>process.stderr.write(`${error?.code||'DOCUMENT_WORKER_FAILURE'}\n`),readiness:()=>Object.freeze({ready:true,schemaVersion:SCHEMA_VERSION,organizations:ports.size,queueTypes:Object.freeze([...JOBS])}),close});
 }catch(error){if(queue)await queue.shutdown().catch(()=>{});await close().catch(()=>{});throw error;}
}

module.exports={QUEUES,REQUIRED,SCHEMA_VERSION,SCHEMA_VERSIONS,createDocumentWorkerInfrastructure,loadDocumentWorkerConfiguration,createInfrastructureClose};
