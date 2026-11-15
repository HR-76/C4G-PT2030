'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'deploy/rehearsal/production');
const read=name=>fs.readFileSync(path.join(directory,name),'utf8');
const compose=require('../backend/node_modules/yaml').parse(read('compose.yaml'));
const runner=require('../deploy/rehearsal/production/run.cjs');
const images={applicationImage:'example.invalid/c4g@sha256:'+'a'.repeat(64),postgresImage:'postgres:18.6-bookworm@sha256:'+'b'.repeat(64),revision:'c'.repeat(40)};

test('rehearsal has only its own internal network and volumes, with no published ports or source mounts',()=>{
 assert.match(compose.name,/C4G_REHEARSAL_PROJECT/);
 assert.deepEqual(Object.keys(compose.services).sort(),['gate','postgres','prepare']);
 assert.equal(compose.networks.isolated.internal,true);
 assert.deepEqual(Object.keys(compose.volumes).sort(),['evidence','postgres-data','secrets']);
 for(const service of Object.values(compose.services)){
  assert.equal(service.ports,undefined);assert.equal(service.privileged,undefined);
  assert.ok(service.mem_limit);
  for(const mount of service.volumes||[])assert.match(mount,/^(postgres-data|evidence|secrets):/);
 }
 assert.equal(compose.services.gate.network_mode,'service:postgres');
 assert.equal(compose.services.prepare.network_mode,'none');
 assert.doesNotMatch(read('compose.yaml'),/external:|docker.sock|\/srv\/|c4g-staging|8600|8500/);
});

test('gate uses actual candidate code and copied tests, without copying private runtime input',()=>{
 assert.match(read('Gate.Dockerfile'),/FROM \$\{CANDIDATE_IMAGE\}/);
 assert.match(read('Gate.Dockerfile'),/COPY \. \/app\/test\/integration\/production-bootstrap/);
 assert.match(read('Gate.Dockerfile'),/USER node/);
 assert.match(read('compose.yaml'),/POSTGRES_PASSWORD_FILE/);
 assert.equal(compose.services.postgres.environment.POSTGRES_HOST_AUTH_METHOD,undefined);
 assert.match(compose.services.postgres.environment.POSTGRES_INITDB_ARGS,/scram-sha-256/);
});

test('rehearsal images require immutable digests and the expected application revision',()=>{
 assert.deepEqual(runner.validateImages(images),images);
 for(const invalid of [{...images,applicationImage:'example.invalid/c4g:latest'},{...images,postgresImage:'postgres:18'},{...images,applicationImage:'https://user:secret@sha256:'+'d'.repeat(64)},{...images,revision:'main'},{...images,extra:'value'}])assert.throws(()=>runner.validateImages(invalid),/REHEARSAL_IMAGES_INVALID/);
});

test('rehearsal only accepts a bounded local Docker endpoint and refuses deployment inputs',()=>{
 for(const endpoint of ['unix:///var/run/docker.sock','npipe:////./pipe/docker_engine'])assert.equal(runner.localEndpoint(endpoint),true);
 for(const endpoint of ['ssh://server','tcp://127.0.0.1:2375','tcp://production:2376','https://server'])assert.equal(runner.localEndpoint(endpoint),false);
 assert.deepEqual(runner.parseArguments(['--images','private-images.json','--mode','full']),{images:'private-images.json',mode:'full',apply:false});
 for(const args of [['--url','postgresql://secret'],['--project','c4g-production-app'],['--images','x','--mode','staging'],['--images','x','--apply','--apply']])assert.throws(()=>runner.parseArguments(args),/REHEARSAL_ARGUMENT_INVALID/);
});

test('rehearsal plan has no mutations, requires explicit apply and names the limits of acceptance',()=>{
 const result=runner.plan(images,{mode:'fresh',apply:false});
 assert.equal(result.apply,false);assert.equal(result.mode,'fresh');
 assert.equal(result.provesRealProviders,false);assert.equal(result.provesApplicationHttp,false);
 assert.doesNotMatch(JSON.stringify(result),/password|Bearer|RESEND_API_KEY/);
});

test('container evidence export drops private and unrecognized receipt fields',()=>{
 const safe=require('../test/integration/production-bootstrap/docker.cjs').safeEvidence;
 const result=safe({postgres:'18',mode:'full',total:1,checks:[{name:'proved',pass:true,private:'canary'}],receipt:{installed:true,centralVersion:'058_platform_account_lifecycle',password:'canary',logins:{read:'c4g_prod_api_read',private:'secret@canary'}}});
 assert.equal(JSON.stringify(result).includes('canary'),false);
 assert.deepEqual(result.checks,[{name:'proved',pass:true}]);
 assert.equal(result.provesTransportTls,false);
 assert.throws(()=>safe({total:1,checks:[{name:'failed',pass:false}]}),/EVIDENCE_INVALID/);
});

function fakeDocker({failGate=false,remote=false,remoteBuilder=false}={}){
 const commands=[];
 const command=(binary,args,options)=>{
  assert.equal(binary,'docker');commands.push({args,env:options.env});
  if(args[0]==='--context'){assert.equal(args[1],'desktop-linux');args=args.slice(2);}
  if(args[0]==='context')return args[1]==='show'?'desktop-linux':remote?'ssh://production':'npipe:////./pipe/docker_engine';
  if(args[0]==='buildx')return remoteBuilder?'Name: default\nDriver: remote\nNodes:\nEndpoint: tcp://remote:1234':'Name: default\nDriver: docker\nNodes:\nEndpoint: desktop-linux';
  if(args[0]==='info')return 'linux';
  if(args[0]==='image'&&args[1]==='inspect')return args.at(-1).includes('Labels')?images.revision:'sha256:'+'d'.repeat(64);
  if(args[0]==='ps'||args[1]==='ls')return '';
  if(args[0]==='build')return 'built';
  if(args[0]==='compose'){
   if(args.at(-1)==='gate'&&failGate)throw Error('raw-private-docker-error-canary');
   if(args.at(-1)==='export')return JSON.stringify({postgres:'18',mode:'fresh',total:1,checks:[{name:'fixture',pass:true}],receipt:{installed:true}});
   return '';
  }
  assert.fail('Unexpected Docker operation');
 };
 return {command,commands};
}
function removeOwnedWorkspace(directory){
 assert.equal(path.dirname(directory),path.join(root,'.tmp'));
 assert.match(path.basename(directory),/^production-rehearsal-[a-f0-9]{32}$/);
 assert.equal(fs.realpathSync(directory),directory);
 fs.rmSync(directory,{recursive:true});
}
test('isolated executor refuses remote Docker before allocating resources',async()=>{
 const fake=fakeDocker({remote:true});
 await assert.rejects(runner.execute(images,{command:fake.command,environment:{}}),/REMOTE_DOCKER_FORBIDDEN/);
 assert.equal(fake.commands.some(({args})=>['build','compose'].includes(args[0])),false);
});
test('isolated executor refuses remote environment contexts and builder overrides before allocation',async()=>{
 for(const environment of [{DOCKER_HOST:'tcp://remote:2375'},{BUILDX_BUILDER:'remote-builder'},{BUILDKIT_HOST:'tcp://remote:1234'}]){
  const fake=fakeDocker();await assert.rejects(runner.execute(images,{command:fake.command,environment}),/REHEARSAL_REMOTE_/);
  assert.equal(fake.commands.length,0);
 }
 const remote=fakeDocker({remote:true});
 await assert.rejects(runner.execute(images,{command:remote.command,environment:{DOCKER_CONTEXT:'remote-context'}}),/REMOTE_DOCKER_FORBIDDEN/);
 const builder=fakeDocker({remoteBuilder:true});
 await assert.rejects(runner.execute(images,{command:builder.command,environment:{}}),/REMOTE_BUILDER_FORBIDDEN/);
 assert.equal(builder.commands.some(({args})=>args.includes('build')||args.includes('compose')),false);
});
test('isolated executor uses one owned project and cleans only its declared volumes',async()=>{
 const fake=fakeDocker(),receipt=await runner.execute(images,{mode:'fresh',command:fake.command,environment:{}});
 try{
  assert.equal(receipt.passed,true);assert.equal(receipt.cleanup,true);assert.match(receipt.project,/^c4g-rehearsal-[a-f0-9]{32}$/);
  const calls=fake.commands.filter(({args})=>args.includes('compose'));
  assert.ok(fake.commands.filter(({args})=>args[0]!=='context').every(({args})=>args[0]==='--context'&&args[1]==='desktop-linux'));
  const build=fake.commands.find(({args})=>args.includes('build')).args;
  assert.equal(build[build.indexOf('--builder')+1],'default');
  assert.ok(calls.every(({args})=>args[args.indexOf('--project-name')+1]===receipt.project));
  assert.ok(calls.some(({args})=>args.includes('down')&&args.includes('--volumes')));
  assert.ok(fake.commands.every(({args})=>!args.includes('prune')&&!args.includes('--remove-orphans')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(receipt.evidenceDirectory,'results.json'),'utf8')).provesRealProviders,false);
  const recorded=JSON.parse(fs.readFileSync(path.join(receipt.evidenceDirectory,'execution.json'),'utf8'));
  assert.equal(recorded.context,'desktop-linux');assert.match(recorded.gateTag,/^c4g-rehearsal-gate:[a-f0-9]{32}$/);assert.equal(recorded.gateImage,'sha256:'+'d'.repeat(64));
 }finally{removeOwnedWorkspace(receipt.evidenceDirectory);}
});
test('failed gate still cleans its owned project and never exposes a raw Docker error',async()=>{
 const fake=fakeDocker({failGate:true});let receipt;
 try{
  await assert.rejects(runner.execute(images,{mode:'fresh',command:fake.command,environment:{}}),error=>{
   receipt=error.receipt;assert.equal(error.message,'REHEARSAL_EXECUTION_FAILED');assert.equal(receipt.passed,false);assert.equal(receipt.cleanup,true);return true;
  });
  assert.ok(fake.commands.some(({args})=>args.includes('compose')&&args.includes('down')));
 }finally{if(receipt)removeOwnedWorkspace(receipt.evidenceDirectory);}
});
