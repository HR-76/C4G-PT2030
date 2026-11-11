'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),net=require('node:net');
const {loadDocumentApiConfiguration,createDocumentApiInfrastructure,workerProbe,workerTarget}=require('../src/config/documentApiInfrastructure');
const {createDocumentApiPool,REQUIRED}=require('../src/documents/apiTenantPool');
const {validSnapshot}=require('./support/tenantRuntimeDoubles');
const ORG='11111111-1111-4111-8111-111111111111';
function runtime(){
 const snapshot=validSnapshot({organizationId:ORG,fence:1,schema:{currentVersion:'032_document_worker_runtime',verifiedCapabilities:Object.fromEntries(REQUIRED.map(k=>[k,true]))}});
 const state={snapshot,fence:1,deadline:Date.now()+15000,sql:[],released:[],verified:0};
 const value={
  directoryRepository:{async resolveSnapshotByOrganization(){return state.snapshot;}},
  regionPolicy:{allows:()=>true},credentialProvider:{async resolve(){return{};}},
  bindingVerifier:{async verify(){state.verified++;}},
  poolManager:{synchronizeFence(){},getFence:()=>state.fence,async acquire(){
   return{fence:1,deadline:state.deadline,client:{async query(sql){state.sql.push(sql);return{rows:[]};}},async release(options){state.released.push(options);}};
  }}
 };
 return{state,value};
}
function configuration(directory,port=3310){return{NODE_ENV:'test',DOCUMENT_API_ORGANIZATIONS_JSON:JSON.stringify([ORG]),DOCUMENT_API_STAGING_DIRECTORY:directory,DOCUMENT_API_STORAGE_MODE:'test-provider',DOCUMENT_API_TEST_ADAPTERS:'enabled',DOCUMENT_API_TEST_PROVIDER:path.resolve(__dirname,'fixtures/documentWorkerStorageProvider.js'),C4G_CLAMAV_HOST:'127.0.0.1',C4G_CLAMAV_PORT:String(port),DOCUMENT_WORKER_HEALTH_URL:'http://127.0.0.1:53312/health/ready'};}
test('configuration closes test providers in production and rejects arbitrary health destinations',()=>{
 const env=configuration(os.tmpdir());assert.equal(loadDocumentApiConfiguration(env).mode,'test-provider');
 for(const patch of [{NODE_ENV:'production'},{DOCUMENT_API_TEST_ADAPTERS:''},{DOCUMENT_API_TEST_PROVIDER:'relative.js'},{DOCUMENT_API_ORGANIZATIONS_JSON:'[]'},{DOCUMENT_API_ORGANIZATIONS_JSON:JSON.stringify([ORG,ORG])},{DOCUMENT_API_STAGING_DIRECTORY:'relative'}])assert.throws(()=>loadDocumentApiConfiguration({...env,...patch}));
 for(const url of ['http://example.invalid:3310/health/ready','http://user:secret@127.0.0.1:3310/health/ready','http://127.0.0.1:3310/other','http://127.0.0.1:3310/health/ready?token=synthetic'])assert.throws(()=>workerTarget(url));
});
test('document lease verifies binding, releases once, and refuses queries after release',async()=>{
 const f=runtime(),pool=createDocumentApiPool({organizationId:ORG,runtime:f.value}),c=await pool.connect();
 await c.query('BEGIN');await c.query('COMMIT');await c.release();await c.release();
 assert.equal(f.state.verified,1);assert.deepEqual(f.state.released,[{discard:false}]);await assert.rejects(()=>c.query('SELECT 1'),/RELEASED/);
});
test('stale fence, expired lease and changed directory cannot commit; rollback and discard remain possible',async()=>{
 for(const kind of ['fence','deadline','directory']){
  const f=runtime();if(kind==='deadline')f.state.deadline=Date.now()-1;
  const c=await createDocumentApiPool({organizationId:ORG,runtime:f.value}).connect();
  if(kind==='fence')f.state.fence=2;if(kind==='directory')f.state.snapshot={...f.state.snapshot,connectionRevision:99};
  await assert.rejects(()=>c.query('COMMIT'),/LEASE_EXPIRED|BINDING_CHANGED/);await c.query('ROLLBACK');await c.release();
  assert.deepEqual(f.state.sql,['ROLLBACK']);assert.equal(f.state.released[0].discard,true);
 }
});
test('incompatible schema and binding changes fail before exposing a repository client',async()=>{
 const f=runtime();f.state.snapshot={...f.state.snapshot,schema:{...f.state.snapshot.schema,currentVersion:'031'}};
 await assert.rejects(()=>createDocumentApiPool({organizationId:ORG,runtime:f.value}).connect(),/BINDING_UNAVAILABLE/);assert.equal(f.state.verified,0);
 const g=runtime();g.value.bindingVerifier.verify=async()=>{g.state.snapshot={...g.state.snapshot,connectionRevision:88};};
 await assert.rejects(()=>createDocumentApiPool({organizationId:ORG,runtime:g.value}).connect(),/BINDING_CHANGED/);assert.equal(g.state.released[0].discard,true);
});
test('factory requires observed dependencies, coalesces checks and owns only its storage/staging',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'c4g-av01-factory-'));let connections=0,worker=true,closed=0,healthCalls=0;
 const sockets=new Set(),server=net.createServer(socket=>{connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.once('data',chunk=>{assert.equal(chunk.toString(),'zPING\0');socket.end('PONG\0');});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const store={async head(){},async readRange(){},async health(){healthCalls++;return{ready:true};}};
 const f=runtime(),infra=createDocumentApiInfrastructure({env:configuration(directory,server.address().port),runtimeDependencies:f.value,storageProvider:{create:()=>store,async close(){closed++;}},workerHealth:async()=>worker});
 try{
  assert.throws(()=>infra.repositoryFactory(ORG),/NOT_READY/);
  assert.deepEqual(await Promise.all([infra.check(),infra.check()]),[true,true]);assert.equal(healthCalls,1);assert.equal(connections,1);
  assert.equal(infra.snapshot().ready,true);assert(infra.repositoryFactory(ORG));assert.throws(()=>infra.repositoryFactory('foreign'),/ORGANIZATION/);
  worker=false;assert.equal(await infra.check(),false);assert.throws(()=>infra.storageFactory(ORG),/NOT_READY/);
  worker=true;assert.equal(await infra.check(),true);
  await infra.close();await infra.close();assert.equal(closed,1);assert.equal(await infra.check(),false);assert.deepEqual(fs.readdirSync(directory),[]);
 }finally{await infra.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));fs.rmdirSync(directory);}
});
test('partial readiness failure closes constructed ports without claiming availability',async()=>{
 const f=runtime();f.value.bindingVerifier.verify=async()=>{throw Error('SCHEMA_DRIFT');};let closed=0;
 const infra=createDocumentApiInfrastructure({env:configuration(path.join(os.tmpdir(),'unused-av01-stage')),runtimeDependencies:f.value,storageProvider:{create:()=>({head(){},readRange(){}}),async close(){closed++;}},workerHealth:()=>{throw Error('UNEXPECTED');}});
 await assert.rejects(()=>infra.assertReady(),/DEPENDENCY_UNAVAILABLE/);assert.equal(infra.snapshot().ready,false);await infra.close();assert.equal(closed,1);assert.equal(f.state.released[0].discard,true);
});
test('worker health transport reports real HTTP readiness and stops accepting connections',async()=>{
 const temporary=net.createServer();await new Promise(resolve=>temporary.listen(0,'127.0.0.1',resolve));const port=temporary.address().port;await new Promise(resolve=>temporary.close(resolve));
 let ready=false,fail=false;const health=await require('../src/config/documentWorkerHealth').startWorkerHealth({port,check:()=>{if(fail)throw Error('SYNTHETIC_HEALTH_FAILURE');return{ready};}});const url=new URL(`http://127.0.0.1:${port}/health/ready`);
 try{assert.equal(await workerProbe(url),false);ready=true;assert.equal(await workerProbe(url),true);fail=true;assert.equal(await workerProbe(url),false);}finally{await health.close();await health.close();}assert.equal(await workerProbe(url),false);
});
