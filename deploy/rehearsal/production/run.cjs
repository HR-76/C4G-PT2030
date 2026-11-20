'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function validateImages(value){
 const immutable=/^(?:[A-Za-z0-9][A-Za-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='applicationImage,postgresImage,revision'
  ||!immutable.test(value.applicationImage)||!immutable.test(value.postgresImage)||[value.applicationImage,value.postgresImage].some(image=>image.includes('://'))
  ||!/^[a-f0-9]{40}$/.test(value.revision))fail('REHEARSAL_IMAGES_INVALID');
 return Object.freeze({...value});
}
function parseArguments(argv){
 const result={images:null,mode:'full',apply:false},seen=new Set();
 for(let index=0;index<argv.length;index++){
  const key=argv[index];if(seen.has(key))fail('REHEARSAL_ARGUMENT_INVALID');seen.add(key);
  if(key==='--apply'){result.apply=true;continue;}
  if(!['--images','--mode'].includes(key)||!argv[index+1]||argv[index+1].startsWith('--'))fail('REHEARSAL_ARGUMENT_INVALID');
  result[key.slice(2)]=argv[++index];
 }
 if(!result.images||!['full','fresh'].includes(result.mode)||/^[a-z]+:\/\//i.test(result.images))fail('REHEARSAL_ARGUMENT_INVALID');
 return result;
}
function localEndpoint(value){
 return typeof value==='string'&&(/^unix:\/\/\/[A-Za-z0-9/_.-]+\.sock$/.test(value)||/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_-]+$/.test(value));
}
function plan(images,{mode='full',apply=false}={}){
 validateImages(images);if(!['fresh','full'].includes(mode)||typeof apply!=='boolean')fail('REHEARSAL_ARGUMENT_INVALID');
 return {apply,mode,revision:images.revision,images:{application:images.applicationImage,postgres:images.postgresImage},
  scope:'new local Docker project, private network and disposable volumes',provesRealProviders:false,provesApplicationHttp:false};
}
function ensurePrivateWorkspace(directory){
 const tmp=path.join(root,'.tmp');
 if(fs.existsSync(tmp)&&fs.lstatSync(tmp).isSymbolicLink())fail('REHEARSAL_WORKSPACE_INVALID');
 fs.mkdirSync(tmp,{recursive:true});
 if(path.dirname(directory)!==tmp||!/^production-rehearsal-[a-f0-9]{32}$/.test(path.basename(directory)))fail('REHEARSAL_WORKSPACE_INVALID');
 fs.mkdirSync(directory,{mode:0o700});
}
async function execute(images,{mode='full',command=execFileSync,environment=process.env}={}){
 const prepared=plan(images,{mode,apply:true});
 if(environment.DOCKER_HOST)fail('REHEARSAL_REMOTE_DOCKER_FORBIDDEN');
 if(environment.BUILDX_BUILDER||environment.BUILDKIT_HOST)fail('REHEARSAL_REMOTE_BUILDER_FORBIDDEN');
 const invoke=(args,options={})=>command('docker',args,{cwd:root,env:environment,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:8*1024*1024,...options}).trim();
 const context=invoke(['context','show']);
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(context)||/staging|production/i.test(context))fail('REHEARSAL_REMOTE_DOCKER_FORBIDDEN');
 const docker=(args,options)=>invoke(['--context',context,...args],options);
 const endpoint=docker(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']);
 if(!localEndpoint(endpoint))fail('REHEARSAL_REMOTE_DOCKER_FORBIDDEN');
 if(docker(['info','--format','{{.OSType}}'])!=='linux')fail('REHEARSAL_LINUX_ENGINE_REQUIRED');
 // The reserved default builder is bound to the explicitly selected local daemon.
 // Inspect without --bootstrap: this must not start a container or remote builder.
 const builder=docker(['buildx','inspect','default']);
 const endpoints=[...builder.matchAll(/^Endpoint:\s*(\S+)\s*$/gm)].map(match=>match[1]);
 if(!/^Driver:\s*docker\s*$/m.test(builder)||endpoints.length!==1||![context,endpoint].includes(endpoints[0]))fail('REHEARSAL_REMOTE_BUILDER_FORBIDDEN');
 // Images must already be available locally; this wrapper never publishes an image.
 const label=docker(['image','inspect',images.applicationImage,'--format','{{index .Config.Labels "org.opencontainers.image.revision"}}']);
 if(label!==images.revision)fail('REHEARSAL_CANDIDATE_REVISION_MISMATCH');
 docker(['image','inspect',images.postgresImage,'--format','{{.Id}}']);
 const id=randomUUID().replaceAll('-',''),project='c4g-rehearsal-'+id,directory=path.join(root,'.tmp','production-rehearsal-'+id);
 for(const [kind,args] of [['container',['ps','-aq']],['volume',['volume','ls','-q']],['network',['network','ls','-q']]]){
  if(docker([...args,'--filter','label=com.docker.compose.project='+project]))fail('REHEARSAL_PROJECT_COLLISION_'+kind.toUpperCase());
 }
 ensurePrivateWorkspace(directory);
 const gateTag='c4g-rehearsal-gate:'+id;
 fs.writeFileSync(path.join(directory,'intent.json'),JSON.stringify({...prepared,project,context,gateTag},null,2),{flag:'wx',mode:0o600});
 docker(['build','--builder','default','--network','none','--build-arg','CANDIDATE_IMAGE='+images.applicationImage,'--file',path.join(__dirname,'Gate.Dockerfile'),'--tag',gateTag,path.join(root,'test/integration/production-bootstrap')],{timeout:300000});
 const gateImage=docker(['image','inspect',gateTag,'--format','{{.Id}}']);
 const env={...environment,C4G_REHEARSAL_PROJECT:project,C4G_REHEARSAL_GATE_IMAGE:gateImage,C4G_REHEARSAL_POSTGRES_IMAGE:images.postgresImage,C4G_REHEARSAL_MODE:mode};
 const args=['compose','--project-name',project,'--file',path.join(__dirname,'compose.yaml'),'--profile','rehearsal'];
 const compose=(extra,options)=>docker([...args,...extra],{env,...options});
 let started=false,passed=false,cleanup=false,failure=null;
 try{
  compose(['config','--quiet']);started=true;
  compose(['run','--rm','--no-deps','prepare']);
  compose(['up','--detach','--wait','postgres'],{timeout:180000});
  compose(['run','--rm','--no-deps','gate'],{timeout:1200000});
  const raw=compose(['run','--rm','--no-deps','prepare','node','/app/test/integration/production-bootstrap/docker.cjs','export']);
  const evidence=require('../../../test/integration/production-bootstrap/docker.cjs').safeEvidence(JSON.parse(raw));
  fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({...evidence,project,revision:images.revision,applicationImage:images.applicationImage,postgresImage:images.postgresImage},null,2),{flag:'wx',mode:0o600});
  passed=true;
 }catch(error){failure=error;}
 finally{
  if(started){try{compose(['down','--volumes','--timeout','30'],{timeout:120000});cleanup=true;}catch{failure=Object.assign(new Error('REHEARSAL_CLEANUP_FAILED'),{code:'REHEARSAL_CLEANUP_FAILED'});}}
  fs.writeFileSync(path.join(directory,'execution.json'),JSON.stringify({passed,cleanup,project,context,gateTag,gateImage,provesRealProviders:false,provesApplicationHttp:false},null,2),{flag:'wx',mode:0o600});
 }
 const receipt={passed,cleanup,project,evidenceDirectory:directory};
 if(failure)throw Object.assign(new Error('REHEARSAL_EXECUTION_FAILED'),{code:failure.code==='REHEARSAL_CLEANUP_FAILED'?failure.code:'REHEARSAL_EXECUTION_FAILED',receipt});
 return receipt;
}
async function main(){
 const options=parseArguments(process.argv.slice(2));
 const images=validateImages(JSON.parse(fs.readFileSync(options.images,'utf8')));
 const result=options.apply?await execute(images,options):plan(images,options);
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(require.main===module)main().catch(error=>{const code=/^REHEARSAL_[A-Z0-9_]+$/.test(error?.code||'')?error.code:'REHEARSAL_EXECUTION_FAILED';if(error.receipt)process.stdout.write(JSON.stringify(error.receipt)+'\n');process.stderr.write(code+'\n');process.exitCode=1;});
module.exports={validateImages,parseArguments,localEndpoint,plan,execute};
