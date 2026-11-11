"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createPreviewTokens}=require('../src/prequalification/tokens');
const {digest}=require('../src/organizationalProfile/pq1Material');
const {publicProjection}=require('../src/prequalification/repository');
const {id}=require('./fixtures/pq1Activation');
function fixture(){let time=Date.parse('2030-01-15T12:00:00.000Z');const tokens=createPreviewTokens({keys:{a:'a'.repeat(32)},currentKeyId:'a',clock:()=>time});return {tokens,advance:()=>{time+=300000;},binding:{subjectId:id(1),organizationId:id(2),resourceId:id(3),sessionDigest:'a'.repeat(64),operation:'ACTIVATE',expectedDigest:digest({version:id(3),generation:1})}};}
test('preview token hides server digests and binds session, subject, tenant, version and generation',()=>{const {tokens,binding}=fixture(),token=tokens.issue(binding).concurrencyToken;tokens.verify(token,binding);assert(!token.includes(binding.expectedDigest));for(const delta of [{subjectId:id(8)},{organizationId:id(8)},{resourceId:id(8)},{sessionDigest:'b'.repeat(64)},{expectedDigest:digest({generation:2})}])assert.throws(()=>tokens.verify(token,{...binding,...delta}),{code:'CONCURRENCY_TOKEN_INVALID'});});
test('preview expires at the exact boundary and is not renewed on verify',()=>{const {tokens,binding,advance}=fixture(),token=tokens.issue(binding).concurrencyToken;advance();assert.throws(()=>tokens.verify(token,binding),{code:'CONCURRENCY_TOKEN_EXPIRED'});});
test('snapshot projection recursively keeps evidence but strips restricted digests',()=>{assert.deepEqual(publicProjection({origin:{digest:'private',revision:2},material:[{releaseDigest:'private',conceptId:id(1)}]}),{origin:{revision:2},material:[{conceptId:id(1)}]});});
test('lookup input admits only exact activation/evaluation identity',()=>{const {validate}=require('../src/prequalification/contracts');const input={operation:'PQ1_ACTIVATE',resourceId:id(1),idempotencyKey:id(2)};validate('lookup',input);for(const delta of [{subjectId:id(3)},{operation:'PUBLISH'},{digest:'a'.repeat(64)}])assert.throws(()=>validate('lookup',{...input,...delta}));});
test('Central 013 pins the bounded subject/resource/operation query and exact downgrade',()=>{const {pq1EffectiveLookupQuery:q}=require('../src/security/authorityProtocolQueries');const {migrationSql}=require('../src/security/centralMigrationManifest');const sql=migrationSql('013_pq1_effective_lookup','up').sql;assert(sql.includes(require('../src/security/authorityCoordinator').hash(q)));assert.match(q,/subject_id=\$2/);assert.match(q,/LIMIT 101$/);assert.equal(migrationSql('013_pq1_effective_lookup','down').sql,migrationSql('012_pq1_intention_lookup','up').sql);});
test('effective recovery envelope rejects content, credentials and preview tokens',async()=>{const {saveIntention}=await import(require('node:url').pathToFileURL(require('node:path').resolve(__dirname,'../../frontend/src/pages/Prequalification/intentions.js')).href);const storage={setItem(){}};const value={userId:id(1),organizationId:id(2),resourceId:id(2),operation:'PQ1_ACTIVATE',idempotencyKey:id(3)};saveIntention(value,storage);for(const key of ['previewToken','token','reason','body','digest','grants'])assert.throws(()=>saveIntention({...value,[key]:'private'},storage));});

test('HTTP adapters pin path identity, refuse query injection and distinguish UNKNOWN',async()=>{
 const express=require('express'),app=express();app.use(express.json());const seen=[];const pass=(q,s,n)=>n();
 const service={mfaCategory:'recent-mfa',async execute(method,input){seen.push({method,input});return method==='activate'?{status:'UNKNOWN'}:{ok:true};}};
 const opts={express,service,authenticate:pass,organizationMiddleware:{requireServerSession:pass,resolveOrganizationContext:pass,requireOrganizationContext:pass}};
 const factory=require('../src/routes/pq1ActivationRoutes').createPq1ActivationRouter;
 app.use('/activation',factory(opts));app.use('/opportunities',factory({...opts,consumer:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root='http://127.0.0.1:'+server.address().port;
 try{
  const r=await fetch(root+'/activation/activate',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,202);assert.equal(r.headers.get('cache-control'),'no-store');
  const bad=await fetch(root+'/activation/preview?tenant='+id(2),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(bad.status,400);assert.equal(seen.length,1);
  const evaluated=await fetch(root+'/opportunities/'+id(1)+'/prequalifications',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(evaluated.status,201);assert.equal(seen.at(-1).input.opportunityId,id(1));
 }finally{await new Promise(r=>server.close(r));}
});

test('consumer malformed JSON is sanitized without reflecting input',async()=>{
 const express=require('express'),app=express();app.use(express.json());app.use(require('../src/app').createErrorHandler({nodeEnv:'development'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const route of ['/api/opportunities/'+id(1)+'/prequalifications','/api/opportunities/prequalifications/'+id(1)]){const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{'content-type':'application/json'},body:'{"private":"sensitive"'});assert.equal(r.status,400);const value=await r.json();assert.equal(value.error.code,'INVALID_INPUT');assert(!JSON.stringify(value).includes('sensitive'));}}finally{await new Promise(r=>server.close(r));}
});

test('loss of current authority after uncertain commit preserves UNKNOWN without exposing a receipt',async()=>{
 const {recoverCommit}=require('../src/prequalification/recovery');
 for(const phase of ['reconcile','refresh','replay']){let replays=0;const result=await recoverCommit({async reconcile(){if(phase==='reconcile')throw Error();return {reconciliation_result:'COMMITTED'};},async refresh(){if(phase==='refresh')throw {code:'SESSION_REQUIRED'};},async replay(){replays++;throw {code:'NOT_AUTHORIZED'};}});assert.equal(result.status,'UNKNOWN');assert.equal(result.receipt,undefined);assert.equal(replays,phase==='replay'?1:0);}
 assert.deepEqual(await recoverCommit({async reconcile(){return {reconciliation_result:'ROLLED_BACK'};},async refresh(){throw Error();},async replay(){throw Error();}}),{status:'FAILED_FINAL'});
});
