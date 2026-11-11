'use strict';
const path=require('node:path');
const http=require('node:http');
const {createDocumentApiPool}=require('../documents/apiTenantPool');
const {createDocumentApiPorts}=require('../documents/apiPorts');
const {createDocumentRepository}=require('../documents/repository');
const {createR2Storage}=require('../documents/r2Storage');
const {createClamavScanner}=require('../documents/clamavScanner');
const {createDownloadStaging}=require('../documents/downloadStaging');
const {loadApplicationDocumentConfiguration}=require('./applicationDocuments');
const {UUID}=require('../documents/objectIdentity');
function workerTarget(value){let url;try{url=new URL(value);}catch{throw Error('DOCUMENT_WORKER_HEALTH_REQUIRED');}if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||!url.port||url.pathname!=='/health/ready'||url.search||url.hash||url.username||url.password)throw Error('DOCUMENT_WORKER_HEALTH_INVALID');return url;}
function workerProbe(url){return new Promise(resolve=>{let total=0,text='';const req=http.get(url,{timeout:2000},res=>{res.on('data',chunk=>{total+=chunk.length;if(total>4096){res.destroy();resolve(false);}else text+=chunk;});res.on('error',()=>resolve(false));res.on('end',()=>{try{resolve(res.statusCode===200&&JSON.parse(text).ready===true);}catch{resolve(false);}});});req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(false));});}
function loadDocumentApiConfiguration(env){
 let organizations;try{organizations=JSON.parse(env.DOCUMENT_API_ORGANIZATIONS_JSON);}catch{throw Error('DOCUMENT_API_ORGANIZATIONS_REQUIRED');}
 if(!Array.isArray(organizations)||!organizations.length||organizations.length>100||new Set(organizations).size!==organizations.length||organizations.some(id=>!UUID.test(id)))throw Error('DOCUMENT_API_ORGANIZATIONS_INVALID');
 if(!path.isAbsolute(env.DOCUMENT_API_STAGING_DIRECTORY||''))throw Error('DOCUMENT_API_STAGING_DIRECTORY_REQUIRED');
 const mode=env.DOCUMENT_API_STORAGE_MODE||'r2';let document,providerPath;
 if(mode==='r2')document=loadApplicationDocumentConfiguration(env);
 else if(mode==='test-provider'){
  if(env.NODE_ENV!=='test'||env.DOCUMENT_API_TEST_ADAPTERS!=='enabled'||!path.isAbsolute(env.DOCUMENT_API_TEST_PROVIDER||''))throw Error('DOCUMENT_API_TEST_PROVIDER_FORBIDDEN');
  providerPath=env.DOCUMENT_API_TEST_PROVIDER;const host=env.C4G_CLAMAV_HOST,port=Number(env.C4G_CLAMAV_PORT);
  if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw Error('DOCUMENT_API_SCANNER_INVALID');document={scanner:{host,port}};
 }else throw Error('DOCUMENT_API_STORAGE_MODE_INVALID');
 return Object.freeze({organizations:Object.freeze(organizations),mode,document,providerPath,stagingDirectory:env.DOCUMENT_API_STAGING_DIRECTORY,workerUrl:workerTarget(env.DOCUMENT_WORKER_HEALTH_URL)});
}
function createDocumentApiInfrastructure({env,runtimeDependencies,storageProvider:injectedProvider=null,workerHealth=workerProbe}){
 const config=loadDocumentApiConfiguration(env),ports=new Map();let provider,closed=false,ready=false,pending=null,closing=null,failurePhase=null;
 if(injectedProvider){if(env.NODE_ENV!=='test')throw Error('DOCUMENT_API_PROVIDER_INJECTION_FORBIDDEN');provider=injectedProvider;}
 else if(config.mode==='test-provider'){
  const factory=require(config.providerPath).createDocumentWorkerStorageProvider;
  if(typeof factory!=='function')throw Error('DOCUMENT_API_TEST_PROVIDER_INVALID');provider=factory({env:{...env,DOCUMENT_WORKER_TEST_ADAPTERS:'enabled',DOCUMENT_WORKER_TEST_STORAGE_ROOT:env.DOCUMENT_API_TEST_STORAGE_ROOT}});
 }else{
  const stores=[];provider={create({organizationId}){const value=createR2Storage(config.document.r2,{organizationId,credentials:config.document.credentials});stores.push(value);return value;},async close(){const results=await Promise.allSettled(stores.map(store=>store.shutdown()));const failures=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(failures.length)throw new AggregateError(failures,'DOCUMENT_STORAGE_CLOSE_FAILED');}};
 }
 const staging=createDownloadStaging({directory:config.stagingDirectory});
 function preparePorts(){for(const organizationId of config.organizations){
  if(ports.has(organizationId))continue;
  const pool=createDocumentApiPool({organizationId,runtime:runtimeDependencies});
  const store=provider.create({organizationId}),scanner=createClamavScanner({organizationId,storage:store,...config.document.scanner});
  ports.set(organizationId,{pool,storage:store,scanner,repository:createDocumentRepository(pool),...createDocumentApiPorts({pool,organizationId})});
 }}
 const forOrg=id=>{if(closed||!ready)throw Error('DOCUMENT_API_NOT_READY');const value=ports.get(id);if(!value)throw Error('DOCUMENT_API_ORGANIZATION_UNAVAILABLE');return value;};
 async function check(){
  if(closed)return false;if(pending)return pending;
  pending=(async()=>{try{
   failurePhase='PORTS';preparePorts();
   failurePhase='TENANT_BINDING';for(const value of ports.values()){const client=await value.pool.connect();await client.release();}
   // All configured organizations use the same buckets and scanner endpoint.
   failurePhase='STORAGE_SCANNER';const first=ports.values().next().value;
   const [storage,scanner]=await Promise.all([first.storage.health(),first.scanner.health()]);if(!storage?.ready||!scanner?.ready)throw Error('DOCUMENT_DEPENDENCY_UNAVAILABLE');
   failurePhase='WORKER';
   if(!await workerHealth(config.workerUrl))throw Error('DOCUMENT_WORKER_UNAVAILABLE');
   failurePhase='STAGING';staging.initialize();ready=!closed;failurePhase=null;return ready;
  }catch{ready=false;return false;}finally{pending=null;}})();return pending;
 }
 return Object.freeze({repositoryFactory:id=>forOrg(id).repository,storageFactory:id=>forOrg(id).storage,auditFactory:id=>forOrg(id).audit,reconciliationFactory:id=>forOrg(id).reconciliation,
  jobs:Object.freeze({enqueueScan:payload=>forOrg(payload.organizationId).jobs.enqueueScan(payload)}),downloadStaging:staging,
  get migrationReady(){return ready;},get scannerReady(){return ready;},get reconciliationLagSeconds(){return null;},mode:config.mode,check,
  async assertReady(){if(!await check())throw Error('DOCUMENT_API_DEPENDENCY_UNAVAILABLE');},
  close(){return closing||=(async()=>{closed=true;ready=false;if(pending)await pending;try{await provider.close();}finally{staging.close();}})();},
  snapshot:()=>Object.freeze({ready:ready&&!closed,mode:config.mode,failurePhase,organizations:ports.size,staging:staging.snapshot()})});
}
module.exports={loadDocumentApiConfiguration,createDocumentApiInfrastructure,workerProbe,workerTarget};
