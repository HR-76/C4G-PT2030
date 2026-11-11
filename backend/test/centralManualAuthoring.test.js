'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createCentralManualAuthoring } = require('../src/fundingTenders/manualAuthoring');
const { createFundingRepository } = require('../src/fundingTenders/repository');
function fixture() {
  const admin = randomUUID(), other = randomUUID();
  const state = { active:true, assigned:true, sql:[], receipts:new Map(), writes:0, audits:0, failAudit:false };
  let before;
  const client = { release(){}, async query(sql, args=[]) {
    state.sql.push(sql);
    if (sql === 'BEGIN' || sql === 'BEGIN READ ONLY') { before={receipts:new Map(state.receipts),writes:state.writes,audits:state.audits}; return {rows:[]}; }
    if (sql === 'ROLLBACK') { Object.assign(state,before); return {rows:[]}; }
    if (sql.includes('SELECT id FROM public.global_user')) return {rows:state.active?[{id:args[0]}]:[]};
    if (sql.includes('SELECT id FROM public.platform_admin_assignment')) return {rows:state.assigned&&args[0]===admin?[{id:admin}]:[]};
    if(sql.includes('audit.prepare_platform_append_v1'))return {rows:[{stream_id:randomUUID(),sequence:1,previous_hash:null,accepted_at:new Date().toISOString()}]};
    if(sql.includes('audit.append_platform_event_v1')){state.audits++;state.auditMaterial=JSON.parse(args[22]);return {rows:[{status:'APPENDED',event_id:args[0],event_hash:args[21]}]};}
    if (sql.includes('SELECT request_digest')) return {rows:state.receipts.has(args[1])?[state.receipts.get(args[1])]:[]};
    if (sql.startsWith('INSERT INTO opportunity_catalog.idempotency_record')) {state.receipts.set(args[1],{requestDigest:args[2],result:JSON.parse(args[5])});return {rows:[]};}
    if (sql.startsWith('INSERT INTO opportunity_catalog.opportunity')) {state.writes++;state.id=args[0];state.revisionId=args[1];return {rows:[]};}
    if (sql.startsWith('INSERT INTO opportunity_catalog.revision')) {state.snapshot=JSON.parse(args[2]);return {rows:[]};}
    if (sql.includes('SELECT o.opportunity_id')) return {rows:state.snapshot?[{opportunityId:state.id,revisionId:state.revisionId,externalIdentifier:null,snapshot:state.snapshot}]:[]};
    if (sql.startsWith('INSERT INTO opportunity_catalog.provenance')) {state.provenance=args;return {rows:[]};}
    if (/^(SET LOCAL|RESET ROLE|COMMIT|SELECT pg_advisory)/.test(sql)) return {rows:[]};
    throw Error('Unexpected SQL: '+sql);
  }};
  const pool={connect:async()=>client};
  const service=createCentralManualAuthoring({pool,repository:createFundingRepository({pool}),audit:async(_client,event)=>{if(state.failAudit)throw Error('audit unavailable');state.audits++;state.event=event;}});
  return {state,service,admin,other,pool};
}
const input=()=>({requestId:randomUUID(),fields:{title:'Aviso manual',funderName:'Financiador',summary:'Resumo',openingDate:'2026-01-01',closingDate:'2027-01-01'}});
test('manual creation uses central authority, atomic audit and immutable provenance without tenant',async()=>{
 const {state,service,admin}=fixture();const result=await service.create(admin,input());
 assert.ok(result.opportunityId);assert.equal(state.writes,1);assert.equal(state.audits,1);
 assert.equal(state.snapshot.lifecycleState,'ACTIVE');assert.equal(state.snapshot.validationState,'PENDING_REVIEW');
 assert.equal(state.provenance[3],'C4G_MANUAL');assert.equal(state.provenance[4],'C4G_MANUAL_HTTP');
 assert.equal(state.event.actor.id,admin);assert.equal(state.event.eventCode,'OPPORTUNITY_CREATED');
 assert.ok(state.sql.filter(s=>s.includes('FOR SHARE')).length===2);
 assert.ok(!state.sql.some(s=>s.includes('app.organization_id')||s.includes('funding_identity')));
 assert.equal(state.sql.at(-1),'COMMIT');
});
test('retries preserve a receipt and reject changed summaries; audit is not duplicated',async()=>{
 const {state,service,admin}=fixture(),body=input();const first=await service.create(admin,body);
 assert.deepEqual(await service.create(admin,body),first);assert.equal(state.writes,1);assert.equal(state.audits,1);
 await assert.rejects(service.create(admin,{...body,fields:{...body.fields,summary:'Outro'}}),{code:'OPPORTUNITY_DIGEST_MISMATCH'});
 assert.equal(state.writes,1);
});

test('manual call fields survive authorized reread and bind replay without changing authority',async()=>{
 const {state,service,admin,other,pool}=fixture(),body=input();
 Object.assign(body.fields,{geographySummary:'  Portugal\r\nRemoto  ',eligibleGroups:'PME\n\nAssociações',eligibilitySummary:'Documento A\nCondição B'});
 const first=await service.create(admin,body),reader=createFundingRepository({pool});
 assert.deepEqual(Object.keys(first).sort(),['opportunityId','revisionId','revisionNumber','rowVersion']);
 const detail=await reader.platformGet(admin,first.opportunityId);
 assert.equal(detail.source,'C4G_MANUAL');assert.equal(detail.snapshot.geographySummary,'Portugal\nRemoto');
 assert.equal(detail.snapshot.eligibleGroups,body.fields.eligibleGroups);assert.equal(detail.snapshot.eligibilitySummary,body.fields.eligibilitySummary);
 assert.deepEqual(await service.create(admin,body),first);
 for(const field of ['geographySummary','eligibleGroups','eligibilitySummary'])await assert.rejects(service.create(admin,{...body,fields:{...body.fields,[field]:'Changed'}}),{code:'OPPORTUNITY_DIGEST_MISMATCH'});
 assert.equal(state.writes,1);assert.equal(state.audits,1);
 await assert.rejects(service.create(other,body),{code:'FUNDING_FORBIDDEN'});
 state.assigned=false;state.sql=[];
 await assert.rejects(service.create(admin,body),{code:'FUNDING_FORBIDDEN'});
 await assert.rejects(reader.platformGet(admin,first.opportunityId),{code:'FUNDING_FORBIDDEN'});
 assert.ok(!state.sql.some(sql=>sql.includes('opportunity_catalog')));
});
test('live user and assignment gate creation and every replay before catalog access',async()=>{
 const {state,service,admin,other}=fixture(),body=input();await service.create(admin,body);
 for(const change of [{assigned:false},{active:false}]) {Object.assign(state,{assigned:true,active:true},change);state.sql=[];await assert.rejects(service.create(admin,body),{code:'FUNDING_FORBIDDEN'});assert.ok(!state.sql.some(s=>s.includes('opportunity_catalog')));}
 Object.assign(state,{assigned:true,active:true});await assert.rejects(service.create(other,body),{code:'FUNDING_FORBIDDEN'});
});
test('caller authority, lifecycle, invalid dates/money and unsafe URLs are rejected',async()=>{
 const {service,admin}=fixture(),body=input();
 for(const extra of [{organizationId:randomUUID()},{actor:admin},{provenance:{}}])await assert.rejects(service.create(admin,{...body,...extra}));
 for(const extra of [{lifecycleState:'ACTIVE'},{officialUrl:'javascript:alert(1)'},{closingDate:'2025-01-01'},{fundingAmountMin:'1'}])await assert.rejects(service.create(admin,{...body,fields:{...body.fields,...extra}}));
});
test('audit failure rolls back opportunity and receipt',async()=>{
 const {state,service,admin}=fixture();state.failAudit=true;await assert.rejects(service.create(admin,input()));assert.equal(state.writes,0);assert.equal(state.receipts.size,0);assert.equal(state.sql.at(-1),'ROLLBACK');
});

test('HTTP authoring uses real platform audit, fresh assurance and no organization context',async t=>{
 const express=require('express'),{createFundingRouters}=require('../src/fundingTenders/http');const {state,pool,admin,other}=fixture();
 const pass=(_q,_s,n)=>n();
 const routers=createFundingRouters({express,pool,catalogReader:{list(){},get(){},revision(){}},policyVersion:'test',recentMfaRequirement:{mfa:false,maxAgeSeconds:300},
  authenticate(req,res,next){if(!req.headers['x-user'])return res.sendStatus(401);req.user={id:req.headers['x-user']};req.authContext={evidence:{authTime:Date.now()/1000-(req.headers['x-expired']?400:0),policyVersion:'test'}};next();},
  organizationMiddleware:{requireServerSession(req,res,next){if(req.headers['x-no-session'])return res.sendStatus(401);next();},resolveOrganizationContext:pass},sessionRegistry:{resolveOrganizationContext:async()=>({state:'VALID'})}});
 const app=express();app.use(express.json());app.use('/admin',routers.platformCatalog);app.use('/client',routers.catalog);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const send=(path,body,user=admin,headers={})=>fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'content-type':'application/json',...(user?{'x-user':user}:{}),...headers},body:JSON.stringify(body)});
 const body=input();Object.assign(body.fields,{geographySummary:'Portugal',eligibleGroups:'PME',eligibilitySummary:'Documento A'});
 const first=await send('/admin',body);assert.equal(first.status,201);const receipt=await first.json();assert.ok(receipt.opportunityId);
 assert.equal(state.auditMaterial.source,'API');assert.equal(state.auditMaterial.organizationId,null);assert.equal(state.auditMaterial.actor.id,admin);
 assert.equal((await send('/admin',body)).status,201);assert.equal(state.writes,1);assert.equal(state.audits,1);
 assert.equal((await send('/admin',{...body,fields:{...body.fields,summary:'Changed'}})).status,409);
 assert.equal((await send('/admin',{...body,organizationId:admin})).status,400);
 assert.equal((await send('/admin',body,other)).status,403);
 assert.equal((await send('/admin',body,null)).status,401);
 assert.equal((await send('/admin',body,admin,{'x-no-session':'1'})).status,401);
 assert.equal((await send('/admin',body,admin,{'x-expired':'1'})).status,403);
 assert.equal((await send('/client',body,other)).status,405);
 state.assigned=false;assert.equal((await send('/admin',body)).status,403);assert.equal(state.writes,1);
});
test('manual central rows are readable as manual source and by exact application revision',async()=>{
 const id=randomUUID(),rev=randomUUID(),queries=[];
 const snapshot={schemaVersion:1,title:'Manual',funderName:'C4G',provenanceId:rev,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};
 const pool={connect:async()=>({release(){},async query(sql,args){queries.push(sql);
  if(sql.startsWith('SELECT DISTINCT'))return {rows:[{name:'Programa manual'}]};
  if(sql.includes('SELECT r.snapshot')){assert.deepEqual(args,[id,rev]);return {rows:[{snapshot}]};}
  if(sql.includes('SELECT o.opportunity_id')){assert.match(sql,/LEFT JOIN opportunity_catalog.funding_identity/);return {rows:[{opportunityId:id,revisionId:rev,title:'Manual',externalIdentifier:null,snapshot,temporalSnapshot:snapshot}]};}
  return {rows:[]};
 }})};
 const repository=createFundingRepository({pool,readRole:true});
 assert.equal((await repository.list()).items[0].source,'C4G_MANUAL');const programmes=(await repository.list()).programmes;assert.ok(programmes.includes('Programa manual'));assert.ok(programmes.includes('Horizon Europe (HORIZON)'));
 assert.equal((await repository.get(id)).source,'C4G_MANUAL');assert.equal((await repository.revision(id,rev)).title,'Manual');
 assert.ok(!queries.some(sql=>/INSERT|UPDATE|DELETE/.test(sql)));
});

test('editorial classification survives creation, reread and replay with official URL',async()=>{
 const {state,service,admin,pool}=fixture(),body=input();
 Object.assign(body.fields,{title:'Digital innovation',programmeName:'Horizon Europe (HORIZON)',opportunityType:'Concurso',interventionArea:'HEALTH',officialUrl:'https://example.org/official'});
 const receipt=await service.create(admin,body);
 const detail=await createFundingRepository({pool}).platformGet(admin,receipt.opportunityId);
 assert.equal(detail.catalogPresentation.presentation.typification.value,'Concurso');
 assert.deepEqual(detail.interventionClassification.areas.map(a=>a.code),['HEALTH']);
 assert.equal(detail.snapshot.officialUrl,body.fields.officialUrl);
 assert.equal(state.snapshot.interventionArea,'HEALTH');
 assert.equal(detail.readModel.projection.classification.callNature.value.label,'Concurso');
 assert.deepEqual(await service.create(admin,body),receipt);
 await assert.rejects(service.create(admin,{...body,fields:{...body.fields,interventionArea:'DIGITAL'}}),{code:'OPPORTUNITY_DIGEST_MISMATCH'});
 await assert.rejects(service.create(admin,{...input(),fields:{...body.fields,interventionArea:'INVALID'}}),{code:'OPPORTUNITY_INVALID_INPUT'});
});
