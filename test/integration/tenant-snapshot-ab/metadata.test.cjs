'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),{createHash}=require('node:crypto');
const {runMetadataAB}=require('./metadata.cjs');
const revision='034_application_snapshot_v2',hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function harness({divergent=false,security=24,queryFailure=false,changedSecurity=false}={}){
 const state={connections:0,releases:0,ends:0,measuring:false,sql:[]},value={tables:['same']};
 const tenants=[0,1].map(index=>{const organizationId='00000000-0000-4000-8000-00000000000'+index, suffix=organizationId.replaceAll('-','');return {index,organizationId,identity:{tenantId:organizationId,databaseGenerationId:organizationId},pool:{options:{host:'127.0.0.1',port:59999,database:'c4g_onb_'+suffix},query(){},connect(){}},credentials:{host:'127.0.0.1',port:59999,database:'c4g_onb_'+suffix,login:'c4g_onb_api_'+suffix,password:'synthetic',ssl:false}};});
 const fixture={ownership:{isolated:true,runId:'a'.repeat(32),centralDatabase:'c4g_f13_authority_synthetic_central'},central:{pool:{options:{host:'127.0.0.1',port:59999,database:'c4g_f13_authority_synthetic_central'},query(){},connect(){}}},tenants};
 const createPool=(_root,tenant)=>({async connect(){state.connections++;return {async query(sql){state.sql.push(sql);if(sql.includes('AS limited'))return {rows:[{database:tenant.credentials.database,session_user:tenant.credentials.login,current_user:tenant.credentials.login,limited:true,api_member:true,no_broad_reader:true,read_only:'on'}]};if(queryFailure&&state.measuring&&sql.startsWith('base'))throw Object.assign(Error('synthetic'),{code:'SYNTHETIC_FAILURE'});return {rows:[]};},release(){state.releases++;}};},async end(){state.ends++;}});
 const load=root=>({entry:{version:revision,schemaFingerprint:hash(value)},schema:{tenantSchemaFingerprint:hash,async tenantSchemaSnapshot(c){await c.query('base-'+root);for(let i=0;i<security;i++)await c.query('security-'+i+(changedSecurity&&root==='B'?'-changed':''));return divergent&&root==='B'?{tables:['changed']}:value;}}});
 return {fixture,state,createPool,load,rootA:'A',rootB:'B'};
}
test('two tenants preserve 2400 measured, 240 warmups, 16 functional calls and all 25 queries',async()=>{
 const f=harness(),r=await runMetadataAB(f);assert.equal(r.status,'PASS');assert.equal(r.populations.length,2);
 for(const p of r.populations){assert.equal(p.samples.length,1328);assert.equal(p.connections.length,13);assert.equal(p.blocks.length,12);assert.equal(p.pairs.length,6);assert.deepEqual(p.pairs.map(x=>x.order.join('')),['AB','BA','AB','BA','AB','BA']);assert(p.samples.every(s=>s.queryCounts.base===1&&s.queryCounts.security===24&&s.queries.length===25));assert.equal(p.summary.A.count,600);assert.equal(p.summary.B.count,600);}
 assert.equal(f.state.connections,26);assert.equal(f.state.releases,26);assert.equal(f.state.ends,2);assert.equal(f.state.sql.filter(x=>x==='BEGIN TRANSACTION READ ONLY').length,26);
});
test('functional parity mismatch and missing security read fail before measures and preserve report',async()=>{
 for(const options of [{divergent:true},{security:23},{changedSecurity:true}]){const f=harness(options);await assert.rejects(runMetadataAB(f),e=>{assert.equal(e.metadataABReport.status,'FAIL');assert.equal(e.metadataABReport.populations[0].samples.filter(x=>x.phase==='measured').length,0);return true;});assert.equal(f.state.connections,f.state.releases);assert.equal(f.state.ends,1);}
});
test('a failed measured query is retained and all owned connections close',async()=>{
 const f=harness({queryFailure:true});await assert.rejects(runMetadataAB({...f,onProgress:p=>{if(p.stage==='functional-complete')f.state.measuring=true;}}),e=>{assert.equal(e.code,'SYNTHETIC_FAILURE');const p=e.metadataABReport.populations[0];assert.equal(p.samples.at(-1).queries[0].status,'FAIL');assert.equal(p.blocks[0].status,'FAIL');return true;});assert.equal(f.state.connections,f.state.releases);assert.equal(f.state.ends,1);
});
test('block deadline includes the final query, without silently accepting completed late block',async()=>{
 const f=harness(),clock={now:0,queries:0};const file=path.join(__dirname,'metadata.cjs'),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require,process,Buffer,performance:{now:()=>clock.now}},{filename:file});
 const original=f.createPool;f.createPool=(...args)=>{const pool=original(...args),connect=pool.connect;pool.connect=async()=>{const c=await connect(),query=c.query;c.query=async sql=>{const r=await query(sql);if(f.state.measuring&&/^(base|security)/.test(sql)&&++clock.queries===25*110)clock.now+=300001;return r;};return c;};return pool;};
 await assert.rejects(module.exports.runMetadataAB({...f,onProgress:p=>{if(p.stage==='functional-complete')f.state.measuring=true;}}),e=>{assert.equal(e.code,'CONTROL_DEADLINE_EXCEEDED');const p=e.metadataABReport.populations[0];assert.equal(p.samples.filter(x=>x.phase==='measured').length,100);assert.equal(p.blocks[0].status,'FAIL');assert.equal(p.blocks[0].controlElapsedMs,300001);return true;});assert.equal(f.state.connections,f.state.releases);
});
test('measurement refuses a fixture database or endpoint outside the declared isolated pair',async()=>{
 for(const mutation of [f=>{f.fixture.tenants[0].credentials.database='habitual';},f=>{f.fixture.tenants[0].pool.options.port=5432;},f=>{f.fixture.tenants[1]=f.fixture.tenants[0];},f=>{f.fixture.ownership.isolated=false;}]){
  const f=harness();mutation(f);await assert.rejects(runMetadataAB(f),{code:'TENANT_AB_OWNED_FIXTURE_REQUIRED'});assert.equal(f.state.connections,0);
 }
});
test('checkout and release both consume the current block budget; no budget carries to the next block',async()=>{
 for(const boundary of ['checkout','release','reset']){
  const f=harness(),clock={now:0},file=path.join(__dirname,'metadata.cjs'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require,process,Buffer,performance:{now:()=>clock.now}},{filename:file});
  const original=f.createPool;f.createPool=(...args)=>{const pool=original(...args),connect=pool.connect;pool.connect=async()=>{
   const c=await connect();if(f.state.measuring&&boundary==='checkout')clock.now+=300001;
   const query=c.query;c.query=async sql=>{const r=await query(sql);if(f.state.measuring&&boundary==='reset'&&/^(base|security)/.test(sql))clock.now+=100;return r;};
   const release=c.release;c.release=()=>{release();if(f.state.measuring&&boundary==='release')clock.now+=300001;};return c;
  };return pool;};
  // Functional calls for the second tenant must remain outside virtual load.
  const progress=p=>{if(p.stage==='functional-complete')f.state.measuring=true;if(p.stage==='block-complete'&&p.blockIndex===11)f.state.measuring=false;};
  if(boundary==='reset'){const r=await module.exports.runMetadataAB({...f,onProgress:progress});assert.equal(r.status,'PASS');assert(r.populations.every(p=>p.blocks.every(b=>b.controlElapsedMs===275000)));}
  else await assert.rejects(module.exports.runMetadataAB({...f,onProgress:progress}),e=>{assert.equal(e.code,'CONTROL_DEADLINE_EXCEEDED');const p=e.metadataABReport.populations[0];assert.equal(p.samples.filter(s=>s.phase==='measured').length,boundary==='checkout'?0:100);assert.equal(p.blocks[0].status,'FAIL');return true;});
  assert.equal(f.state.connections,f.state.releases);
 }
});
