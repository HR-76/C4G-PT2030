'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomBytes}=require('node:crypto');
const execute=promisify(execFile);
function createBudget(ms,{now=()=>performance.now()}={}){assert(Number.isSafeInteger(ms)&&ms>0);const end=now()+ms;function remaining(){const value=Math.floor(end-now());if(value<=0)throw Object.assign(Error('CONTROL_DEADLINE_EXCEEDED'),{code:'CONTROL_DEADLINE_EXCEEDED'});return value;}return {remaining,check:()=>{remaining();},commandTimeout:maximum=>Math.min(maximum,remaining())};}
function validateDockerEndpoint(value){assert(/^(npipe:\/\/|unix:\/\/)/.test(value),'LOCAL_DOCKER_REQUIRED');}
function assertOwned(record,{id,name,runId}){assert.match(id,/^[a-f0-9]{64}$/);assert.equal(record.Id,id);assert.equal(record.Name,'/'+name);assert.equal(record.Config?.Labels?.['c4g.eu-trial'],runId);for(const ports of Object.values(record.NetworkSettings?.Ports||{}))for(const port of ports||[])assert.equal(port.HostIp,'127.0.0.1','NON_LOOPBACK_RESOURCE');}
async function docker(args,env=process.env,budget){const timeout=budget?budget.commandTimeout(30000):30000;try{return(await execute('docker',args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:4*1024*1024,env})).stdout.trim();}catch(error){throw Object.assign(Error('DOCKER_OPERATION_FAILED'),{code:'DOCKER_OPERATION_FAILED',exitCode:error.code});}}
async function inspectOwned(resource,{budget,dockerCall=docker}={}){const record=JSON.parse(await dockerCall(['inspect',resource.id],process.env,budget));assert.equal(record.length,1);assertOwned(record[0],resource);return record[0];}
async function freePort(){const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const port=listener.address().port;await new Promise(r=>listener.close(r));return port;}
async function localImages(){const budget=createBudget(90000);validateDockerEndpoint(await docker(['context','inspect','--format','{{.Endpoints.docker.Host}}'],process.env,budget));if(process.env.DOCKER_HOST)validateDockerEndpoint(process.env.DOCKER_HOST);
 const images={};for(const [key,name] of [['postgres','postgres:18-alpine'],['keycloak','quay.io/keycloak/keycloak:26.8.0']]){const info=JSON.parse(await docker(['image','inspect',name],process.env,budget));assert.equal(info.length,1);assert.match(info[0].Id,/^sha256:[a-f0-9]{64}$/);images[key]={id:info[0].Id,repositoryDigests:info[0].RepoDigests||[],sourceTag:name};}return images;
}
async function cleanupResources({attempted,owned,runId,dockerCall=docker,budget=createBudget(120000)}){const evidence=[];let failed=false;const label='c4g.eu-trial='+runId;
 for(const item of attempted.slice().reverse()){
  const entry={name:item.name,removed:false};evidence.push(entry);
  try{budget.check();let resource=owned.find(x=>x.name===item.name);if(!resource){const found=(await dockerCall(['ps','-aq','--no-trunc','--filter','name=^/'+item.name+'$','--filter','label='+label],process.env,budget)).split(/\r?\n/).filter(Boolean);assert(found.length<=1);if(!found.length){entry.absent=true;entry.removed=true;continue;}resource={...item,id:found[0],runId};}
   entry.id=resource.id;await inspectOwned(resource,{budget,dockerCall});await dockerCall(['rm','--force','--volumes',resource.id],process.env,budget);assert.equal(await dockerCall(['ps','-aq','--no-trunc','--filter','id='+resource.id],process.env,budget),'');entry.removed=true;
  }catch(error){failed=true;entry.failure={code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'RESOURCE_CLEANUP_FAILED'};}
 }
 return {status:failed?'FAIL':'PASS',resources:evidence,controlBudgetMs:120000};
}
async function createLab({runId,tlsDirectory,images,stage='043'}){
 const budget=createBudget(300000);
 assert.match(runId,/^[a-f0-9]{32}$/);assert(['042','043'].includes(stage));for(const key of ['postgres','keycloak'])assert.match(images[key]?.id,/^sha256:[a-f0-9]{64}$/);
 validateDockerEndpoint(await docker(['context','inspect','--format','{{.Endpoints.docker.Host}}'],process.env,budget));if(process.env.DOCKER_HOST)validateDockerEndpoint(process.env.DOCKER_HOST);
 const tls=fs.realpathSync(tlsDirectory);for(const file of ['localhost.key','localhost.crt','mkcert-rootCA.pem'])assert(fs.statSync(path.join(tls,file)).isFile(),'TEST_TLS_REQUIRED');
 const password=randomBytes(32).toString('hex'),kcPassword=randomBytes(32).toString('hex'),env={...process.env,POSTGRES_PASSWORD:password,KC_BOOTSTRAP_ADMIN_PASSWORD:kcPassword};
 const owned=[],attempted=[],label='c4g.eu-trial='+runId;
 async function cleanup(){return cleanupResources({attempted,owned,runId});}
 async function start(kind,args){budget.check();const name='c4g-eu-trial-'+kind+'-'+runId+'-'+stage;const item={name,runId};attempted.push(item);const id=await docker(['run','--detach','--name',name,'--label',label,...args],env,budget);const resource={id,name,runId};owned.push(resource);await inspectOwned(resource,{budget});return resource;}
 try{
  const pg=await start('pg',['--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=proof_admin','--env','POSTGRES_DB=postgres','--memory','2g','--tmpfs','/var/lib/postgresql:rw','-p','127.0.0.1::5432',images.postgres.id]);
  const pgRecord=await inspectOwned(pg,{budget}),pgPort=pgRecord.NetworkSettings.Ports['5432/tcp'][0].HostPort;assert(Number(pgPort)>1024&&!['5432','5433'].includes(pgPort));
  let ready=false;for(let i=0;i<80;i++){budget.check();try{await docker(['exec',pg.id,'pg_isready','-U','proof_admin','-d','postgres'],env,budget);ready=true;break;}catch{await new Promise(r=>setTimeout(r,Math.min(250,budget.remaining())));}}assert(ready,'POSTGRES_NOT_READY');
  const kcPort=await freePort();await start('kc',['--env','KC_BOOTSTRAP_ADMIN_USERNAME=proof-admin','--env','KC_BOOTSTRAP_ADMIN_PASSWORD','--memory','2g','--mount',`type=bind,source=${path.join(tls,'localhost.crt')},target=/certs/localhost.crt,readonly`,'--mount',`type=bind,source=${path.join(tls,'localhost.key')},target=/certs/localhost.key,readonly`,'-p',`127.0.0.1:${kcPort}:8443`,images.keycloak.id,'start-dev',`--hostname=https://localhost:${kcPort}`,'--https-certificate-file=/certs/localhost.crt','--https-certificate-key-file=/certs/localhost.key','--http-access-log-enabled=false']);
  budget.check();return {resources:owned.map(({id,name,runId})=>({id,name,runId})),environment:{postgresMemoryBytes:2147483648,keycloakMemoryBytes:2147483648,timezone:'UTC',network:'LOOPBACK_ONLY',images,setupControlBudgetMs:300000,cleanupControlBudgetMs:120000},env:{EU_TRIAL_ADMIN_URL:`postgresql://proof_admin:${password}@127.0.0.1:${pgPort}/postgres`,EU_TRIAL_KEYCLOAK:`https://localhost:${kcPort}`,EU_TRIAL_KEYCLOAK_PASSWORD:kcPassword,EU_TRIAL_RUN:runId,EU_TRIAL_STAGE:stage,EU_TRIAL_OWNED:JSON.stringify(owned),NODE_EXTRA_CA_CERTS:path.join(tls,'mkcert-rootCA.pem')},cleanup};
 }catch(error){try{error.cleanup=await cleanup();}catch{error.cleanup={status:'FAIL'};}throw error;}
}
module.exports={validateDockerEndpoint,assertOwned,docker,inspectOwned,localImages,createLab,createBudget,cleanupResources};
