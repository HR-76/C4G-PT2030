'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createOpportunityActivationRouter,assertActivationHttpCapability,runtimeEnabled,executor11145Enabled,publicError}=require('../src/opportunities/v2/activationHttp');
const {bounded,MAX_READ_BYTES}=require('../src/opportunities/v2/activationRead');
const {createOriginProtection}=require('../src/security/originProtection');
const {csrfSync}=require('csrf-sync');
const actor='01900000-0000-7000-8000-000000000001',plan='01900000-0000-7000-8000-000000000002',run='01900000-0000-7000-8000-000000000003';
const origin='https://app.example.invalid',requestId='http-activation-request',digest='a'.repeat(64);
async function fixture(t,{ready=true,error=null,authenticated=true,executorEnabled=false,euWriterEnabled=false,writerWindowEnabled=false,reconciliationEnabled=false,legacyPreapprovalEnabled=false,legacyAcceptanceEnabled=false}={}){
 const calls=[];const invoke=name=>async(...args)=>{calls.push({name,args});if(error)throw error;return {method:name};};
 const service=Object.fromEntries(['prepare','approve','revoke'].map(k=>[k,invoke(k)]));
 const reads=Object.fromEntries(['list','get'].map(k=>[k,invoke(k)]));
 const sourceControl=Object.fromEntries(['status','suspend','acknowledgeQuiesced','resume'].map(k=>[k,invoke(k)]));
 if(euWriterEnabled)sourceControl.configureWriter=invoke('configureWriter');
 const writerReviews=euWriterEnabled?{list:invoke('writerReviews')}:null;
 const writerWindow=writerWindowEnabled?{get:invoke('window:get'),approve:invoke('window:approve')}:null;
 const reconciliation=reconciliationEnabled?Object.fromEntries(['get','approve','execute'].map(k=>[k,invoke('reconciliation:'+k)])):null;
 const legacyPreapproval=legacyPreapprovalEnabled?{list:invoke('legacy:list'),get:invoke('legacy:get'),approve:invoke('legacy:approve')}:null;
 const legacyAcceptance=legacyAcceptanceEnabled?Object.fromEntries(['list','get','prepare','approve','accept'].map(k=>[k,invoke('acceptance:'+k)])):null;
 const csrf=csrfSync({getTokenFromRequest:req=>req.get('x-csrf-token'),getTokenFromState:()=> 'unit-session-csrf',storeTokenInState:()=>{},errorConfig:{statusCode:403,code:'CSRF_INVALID',message:'Invalid'}});
 const executor11145=executorEnabled?Object.fromEntries(['collect','prepare','accept'].map(k=>[k,invoke('11145:'+k)])):null;
 const router=createOpportunityActivationRouter({express,service,reads,sourceControl,executor11145,writerReviews,writerWindow,reconciliation,legacyPreapproval,legacyAcceptance,
  authenticate(req,res,next){if(authenticated){req.user={id:actor};req.sessionID='unit-http-session';req.session={auth:{user:{id:actor}}};req.authContext={sessionId:req.sessionID};}next();},
  requireServerSession(req,res,next){if(!req.session?.auth)return res.status(401).json({error:{code:'SESSION_REQUIRED'}});next();},
  originProtection:createOriginProtection({allowedOrigins:[origin]}),csrfProtection:csrf.csrfSynchronisedProtection,
  assertReady:async()=>{if(!ready)throw Object.assign(Error(),{code:'OPPORTUNITY_V2_NOT_CONFIGURED'});}});
 const app=express();app.use('/api/admin/opportunity-activation',router);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return {calls,async request(path,{method='GET',body,headers={}}={}){return fetch('http://127.0.0.1:'+server.address().port+'/api/admin/opportunity-activation'+path,{method,headers:{origin,'x-csrf-token':'unit-session-csrf',...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});}};
}

test('legacy prearchive approval is per identity, OIDC guarded and has no archive or accept route',async t=>{
 const packageId=plan,itemDigest=digest,base='/eu-legacy/preapprovals/'+packageId+'/'+itemDigest;
 const f=await fixture(t,{legacyPreapprovalEnabled:true});
 assert.equal((await f.request('/eu-legacy/preapprovals/'+packageId)).status,200);
 assert.equal((await f.request(base)).status,200);
 assert.equal((await f.request(base+'/approve',{method:'POST',body:{requestId,bindingDigest:digest}})).status,200);
 assert.deepEqual(f.calls.map(c=>c.name),['legacy:list','legacy:get','legacy:approve']);
 assert.deepEqual(f.calls[0].args,[packageId,{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'}]);
 assert.deepEqual(f.calls[1].args,[packageId,itemDigest,{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'}]);
 assert.deepEqual(f.calls[2].args[0],{requestId,bindingDigest:digest,packageId,itemDigest});
 for(const extra of [{archive:{kind:'FUNDING'}},{actor:{id:actor}},{sourceFence:7},{snapshot:{}},{accept:true}])
  assert.equal((await f.request(base+'/approve',{method:'POST',body:{requestId,bindingDigest:digest,...extra}})).status,400);
 for(const [endpoint,method] of [[base+'/archive','POST'],[base+'/accept','POST'],[base+'/execute','POST']])
  assert.equal((await f.request(endpoint,{method,body:{requestId,bindingDigest:digest}})).status,405);
 assert.equal((await f.request(base+'?actor=service')).status,400);
 assert.equal((await f.request(base+'/approve',{method:'POST',body:{requestId,bindingDigest:digest},headers:{'x-csrf-token':'wrong'}})).status,403);
 const disabled=await fixture(t);assert.equal((await disabled.request(base)).status,503);
 for(const [options,headers,status] of [[{authenticated:false},{},401],[{ready:false},{},503],[{},{origin:'https://attacker.invalid'},403]]){
  const guarded=await fixture(t,{legacyPreapprovalEnabled:true,...options});
  assert.equal((await guarded.request(base+'/approve',{method:'POST',body:{requestId,bindingDigest:digest},headers})).status,status);
  assert.equal(guarded.calls.length,0);
 }
});

test('legacy acceptance binds each OIDC decision to the package and item under session, origin and CSRF guards',async t=>{
 const base='/eu-legacy/acceptance/'+plan+'/'+digest;
 const f=await fixture(t,{legacyAcceptanceEnabled:true});
 assert.equal((await f.request('/eu-legacy/acceptance/'+plan)).status,200);
 assert.equal((await f.request(base)).status,200);
 for(const [action,body,status] of [['prepare',{requestId},201],['approve',{requestId,planId:plan,planDigest:digest},200],['accept',{requestId,planId:plan,planDigest:digest,fence:2},200]]){
  assert.equal((await f.request(base+'/'+action,{method:'POST',body})).status,status);
  assert.deepEqual(f.calls.at(-1).args[0],{...body,packageId:plan,itemDigest:digest});
  for(const extra of [{actor:{id:actor}},{archive:{}},{sourceFence:7},{packageId:plan},{itemDigest:digest}])
   assert.equal((await f.request(base+'/'+action,{method:'POST',body:{...body,...extra}})).status,400);
 }
 assert.deepEqual(f.calls.map(c=>c.name),['acceptance:list','acceptance:get','acceptance:prepare','acceptance:approve','acceptance:accept']);
 for(const c of f.calls)assert.deepEqual(c.args.at(-1),{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'});
 assert.equal((await f.request(base+'/accept',{method:'POST',body:{requestId,planId:plan,planDigest:digest,fence:2},headers:{'x-csrf-token':'wrong'}})).status,403);
 for(const [options,headers,status] of [[{authenticated:false},{},401],[{ready:false},{},503],[{},{origin:'https://attacker.invalid'},403]]){
  const guarded=await fixture(t,{legacyAcceptanceEnabled:true,...options});
  assert.equal((await guarded.request(base+'/accept',{method:'POST',body:{requestId,planId:plan,planDigest:digest,fence:2},headers})).status,status);
  assert.equal(guarded.calls.length,0);
 }
});

test('EU writer controls require explicit composition, bind human authority and refuse client policy overrides',async t=>{
 const disabled=await fixture(t);
 assert.equal((await disabled.request('/sources/eu/writer',{method:'POST',body:{requestId,expectedFence:3}})).status,503);
 assert.equal((await disabled.request('/eu-writer/reviews')).status,503);
 const f=await fixture(t,{euWriterEnabled:true});
 assert.equal((await f.request('/sources/eu/writer',{method:'POST',body:{requestId,expectedFence:3}})).status,200);
 assert.equal((await f.request('/eu-writer/reviews')).status,200);
 assert.equal((await f.request('/sources/eu/writer',{method:'POST',body:{requestId,expectedFence:3,policyVersion:'untrusted'}})).status,400);
 assert.equal((await f.request('/eu-writer/reviews?actor=SERVICE')).status,400);
 assert.deepEqual(f.calls.map(x=>x.name),['configureWriter','writerReviews']);
 for(const call of f.calls)assert.deepEqual(call.args.at(-1),{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'});
});

test('expired EU reconciliation exposes only closed plan approval and execution with server authority',async t=>{
 const f=await fixture(t,{reconciliationEnabled:true}),base='/eu-writer/reconciliations/'+plan,approval={requestId,previewDigest:digest},execution={...approval,approvalEventId:run,approvalEventHash:digest};
 assert.equal((await f.request(base)).status,200);
 assert.equal((await f.request(base+'/approve',{method:'POST',body:approval})).status,200);
 assert.equal((await f.request(base+'/execute',{method:'POST',body:execution})).status,200);
 assert.deepEqual(f.calls.map(c=>c.name),['reconciliation:get','reconciliation:approve','reconciliation:execute']);
 assert.deepEqual(f.calls[1].args[0],{...approval,planId:plan});assert.deepEqual(f.calls[2].args[0],{...execution,planId:plan});
 for(const c of f.calls)assert.deepEqual(c.args.at(-1),{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'});
 for(const injected of [{actor:{id:actor}},{planId:plan},{runId:run},{cycleId:run},{sourceFence:7},{resume:true},{plan:{}}])assert.equal((await f.request(base+'/execute',{method:'POST',body:{...execution,...injected}})).status,400);
 for(const [key,value]of [['previewDigest','bad'],['approvalEventId','bad'],['approvalEventHash','bad']])assert.equal((await f.request(base+'/execute',{method:'POST',body:{...execution,[key]:value}})).status,400);
 assert.equal((await f.request(base+'?path=secret')).status,400);
 assert.equal((await f.request(base+'/execute?resume=true',{method:'POST',body:execution})).status,400);
 for(const action of ['resume','enqueue','accept'])assert.equal((await f.request(base+'/'+action,{method:'POST',body:execution})).status,405);
 assert.equal(f.calls.length,3);
 const disabled=await fixture(t);assert.equal((await disabled.request(base)).status,503);assert.equal(disabled.calls.length,0);
});

test('expired EU reconciliation retains session, origin, CSRF and capability guards before effects',async t=>{
 const base='/eu-writer/reconciliations/'+plan;
 for(const [options,headers,status]of [[{authenticated:false},{},401],[{ready:false},{},503],[{},{origin:'https://attacker.invalid'},403],[{},{'x-csrf-token':'wrong'},403]]){
  const f=await fixture(t,{reconciliationEnabled:true,...options});
  for(const action of ['approve','execute'])assert.equal((await f.request(base+'/'+action,{method:'POST',body:{requestId,previewDigest:digest,...(action==='execute'?{approvalEventId:run,approvalEventHash:digest}:{})},headers})).status,status);
  assert.equal(f.calls.length,0);
 }
});

test('operational window approval has a separate closed HTTP scope and uses server session authority',async t=>{
 const f=await fixture(t,{writerWindowEnabled:true}),base='/eu-writer/windows/'+plan;
 assert.equal((await f.request(base)).status,200);
 assert.equal((await f.request(base+'/approve',{method:'POST',body:{requestId,planDigest:digest}})).status,200);
 assert.deepEqual(f.calls[1].args[0],{requestId,planDigest:digest,windowId:plan});
 assert.deepEqual(f.calls[1].args[1],{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'});
 for(const injected of [{actor:{id:actor}},{sourceFence:3},{packageId:'other'},{windowId:plan},{plan:{}}])assert.equal((await f.request(base+'/approve',{method:'POST',body:{requestId,planDigest:digest,...injected}})).status,400);
 assert.equal((await f.request(base+'?path=secret')).status,400);
 assert.equal((await f.request(base+'/approve',{method:'POST',body:{requestId,planDigest:digest},headers:{'x-csrf-token':'wrong'}})).status,403);
 assert.equal(f.calls.length,2);
 const disabled=await fixture(t);assert.equal((await disabled.request(base)).status,503);assert.equal(disabled.calls.length,0);
});
test('activation routes bind actor/session and path identity on the server and expose no acceptance operation',async t=>{
 const f=await fixture(t);
 const cases=[['GET','/plans',undefined,'list',200],['GET','/plans/'+plan,undefined,'get',200],
 ['POST','/plans',{requestId,archive:{kind:'FUNDING',runId:run,externalIdentifier:'CASCADE:11145'},expected:null},'prepare',201],
 ['POST','/plans/'+plan+'/approve',{requestId,planDigest:digest},'approve',200],['POST','/plans/'+plan+'/revoke',{requestId,planDigest:digest},'revoke',200],
 ['GET','/sources/eu',undefined,'status',200],...['suspend','quiesce','resume'].map((action,i)=>['POST','/sources/eu/'+action,{requestId,expectedFence:1},['suspend','acknowledgeQuiesced','resume'][i],200])];
 for(const [method,path,body,name,status]of cases){const res=await f.request(path,{method,body});assert.equal(res.status,status,path);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal((await res.json()).method,name);}
 for(const call of f.calls){const ctx=call.args.at(-1);assert.deepEqual(ctx,{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'});assert.equal(Object.isFrozen(ctx),true);}
 assert.deepEqual(f.calls.find(c=>c.name==='approve').args[0],{requestId,planDigest:digest,planId:plan});
 assert.equal((await f.request('/plans/'+plan+'/accept',{method:'POST',body:{requestId}})).status,405);
 assert.equal((await f.request('/plans',{method:'HEAD'})).status,405);
});

test('11145 executor is an independent closed opt-in and never follows an alternative call path',async t=>{
 assert.equal(executor11145Enabled({}),false);
 assert.equal(executor11145Enabled({OPPORTUNITY_ACTIVATION_RUNTIME:'authenticated-v2'}),false);
 assert.throws(()=>executor11145Enabled({OPPORTUNITY_11145_EXECUTOR:'bounded-v2'}));
 assert.throws(()=>executor11145Enabled({OPPORTUNITY_ACTIVATION_RUNTIME:'authenticated-v2',OPPORTUNITY_11145_EXECUTOR:'true'}));
 assert.equal(executor11145Enabled({OPPORTUNITY_ACTIVATION_RUNTIME:'authenticated-v2',OPPORTUNITY_11145_EXECUTOR:'bounded-v2'}),true);
 const disabled=await fixture(t);
 assert.equal((await disabled.request('/calls/11145/collect',{method:'POST',body:{requestId:run,expectedSourceFence:1}})).status,503);
 assert.equal(disabled.calls.length,0);
 const f=await fixture(t,{executorEnabled:true});
 const cases=[['collect',{requestId:run,expectedSourceFence:1},'collect',201],['plans',{requestId,runId:run},'prepare',201],['plans/'+plan+'/accept',{requestId,planDigest:digest,fence:2,sourceFence:3},'accept',200]];
 for(const [path,body,name,status]of cases){const response=await f.request('/calls/11145/'+path,{method:'POST',body});assert.equal(response.status,status);assert.equal((await response.json()).method,'11145:'+name);}
 assert.deepEqual(f.calls[2].args[0],{requestId,planDigest:digest,fence:2,sourceFence:3,planId:plan});
 for(const call of f.calls)assert.deepEqual(call.args.at(-1),{actor:{type:'HUMAN',id:actor},sessionId:'unit-http-session'});
 const before=f.calls.length;
 for(const [path,body]of cases){for(const injected of [{actor:{id:actor}},{source:'CORDIS'},{externalIdentifier:'CASCADE:222'},{snapshot:{}},{archive:{}},{expected:{}}])assert.equal((await f.request('/calls/11145/'+path,{method:'POST',body:{...body,...injected}})).status,400);}
 for(const path of ['/calls/11146/collect','/calls/11146/plans/'+plan+'/accept','/plans/'+plan+'/accept'])assert.equal((await f.request(path,{method:'POST',body:{requestId}})).status,405);
 for(const [key,value]of [['fence',0],['sourceFence',0],['planDigest','bad']])assert.equal((await f.request('/calls/11145/plans/'+plan+'/accept',{method:'POST',body:{requestId,planDigest:digest,fence:2,sourceFence:3,[key]:value}})).status,400);
 assert.equal(f.calls.length,before);
});

test('11145 mutations retain session, capability, origin and CSRF protection before any delegate',async t=>{
 for(const [options,headers,status]of [[{authenticated:false},{},401],[{ready:false},{},503],[{},{origin:'https://attacker.invalid'},403],[{},{'x-csrf-token':'wrong'},403]]){
  const f=await fixture(t,{executorEnabled:true,...options});
  for(const [path,body]of [['collect',{requestId:run,expectedSourceFence:1}],['plans',{requestId,runId:run}],['plans/'+plan+'/accept',{requestId,planDigest:digest,fence:2,sourceFence:3}]])assert.equal((await f.request('/calls/11145/'+path,{method:'POST',body,headers})).status,status);
  assert.equal(f.calls.length,0);
 }
});
test('HTTP refuses caller authority, query injection and cross-source control before delegated effects',async t=>{
 const f=await fixture(t);
 for(const body of [{requestId,planDigest:digest,actor:{id:actor}},{requestId,planDigest:digest,sessionId:'forged'},{requestId,planDigest:digest,planId:plan}])assert.equal((await f.request('/plans/'+plan+'/approve',{method:'POST',body})).status,400);
 for(const path of ['/plans?actor=admin','/plans?cursor=bad','/plans/'+plan+'?source=EU','/sources/eu?organizationId=other'])assert.equal((await f.request(path)).status,400);
 for(const body of [{requestId,expectedFence:0},{requestId,expectedFence:1,source:'INTERREG_EUROPE'},{requestId,expectedFence:1,actor:{type:'SERVICE'}}])assert.equal((await f.request('/sources/eu/suspend',{method:'POST',body})).status,400);
 assert.equal((await f.request('/sources/interreg/suspend',{method:'POST',body:{requestId,expectedFence:1}})).status,405);
 assert.equal(f.calls.length,0);
});
test('real origin and CSRF middleware protect every HTTP mutation',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/sources/eu/suspend',{method:'POST',body:{requestId,expectedFence:1},headers:{origin:'https://other.invalid'}})).status,403);
 const res=await f.request('/plans/'+plan+'/approve',{method:'POST',body:{requestId,planDigest:digest},headers:{'x-csrf-token':'wrong'}});
 assert.equal(res.status,403);assert.equal((await res.json()).error.code,'CSRF_INVALID');assert.equal(f.calls.length,0);
});
test('missing authenticated session or SQL capability prevents route effects',async t=>{
 const missing=await fixture(t,{authenticated:false});assert.equal((await missing.request('/plans')).status,401);assert.equal(missing.calls.length,0);
 const absent=await fixture(t,{ready:false});const res=await absent.request('/sources/eu');assert.equal(res.status,503);assert.equal((await res.json()).error.code,'OPPORTUNITY_V2_NOT_CONFIGURED');assert.equal(absent.calls.length,0);
});
test('HTTP errors and malformed/oversized bodies never expose database or stack details',async t=>{
 const f=await fixture(t,{error:new Error('connection password and SQL')});const res=await f.request('/plans');assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:{code:'SERVICE_UNAVAILABLE'}});
 assert.equal((await f.request('/plans',{method:'POST',body:'{bad'})).status,400);
 assert.equal((await f.request('/plans',{method:'POST',body:JSON.stringify({unexpected:'x'.repeat(17000)})})).status,413);
 assert.deepEqual(publicError({code:'OPPORTUNITY_V2_EU_NOT_QUIESCENT'}),{status:409,code:'OPPORTUNITY_V2_EU_NOT_QUIESCENT'});
});
test('runtime stays disabled by default and SQL capability is required explicitly',async()=>{
 assert.equal(runtimeEnabled({}),false);assert.equal(runtimeEnabled({OPPORTUNITY_ACTIVATION_RUNTIME:'disabled'}),false);assert.equal(runtimeEnabled({OPPORTUNITY_ACTIVATION_RUNTIME:'authenticated-v2'}),true);
 for(const value of ['true','v2','accept'])assert.throws(()=>runtimeEnabled({OPPORTUNITY_ACTIVATION_RUNTIME:value}));
 await assert.rejects(assertActivationHttpCapability({query:async()=>({rows:[{ready:false}]})}),{code:'OPPORTUNITY_V2_NOT_CONFIGURED'});
 assert.equal(await assertActivationHttpCapability({query:async()=>({rows:[{ready:true}]})}),true);
 assert.throws(()=>bounded({snapshot:'x'.repeat(MAX_READ_BYTES)}),{code:'OPPORTUNITY_V2_READ_LIMIT_EXCEEDED'});assert.deepEqual(bounded({snapshot:'preserved'}),{snapshot:'preserved'});
});
