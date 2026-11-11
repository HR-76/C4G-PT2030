'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFundingRepository}=require('../src/fundingTenders/repository');
const {createSource}=require('../src/fundingTenders/source');
const eu=require('../../context/references/opportunity-v2/examples/eu-11145.json');
const raw=require('../../context/references/opportunity-v2/evidence/eu-11145.json');
const id='01900000-0000-7000-8000-000000000001',revisionId='01900000-0000-7000-8000-000000000002';
const asOf='2026-10-30T12:00:00.000Z';
function fixture(snapshot,metadata={}){
 const queries=[];let revoked=false;
 const base={opportunityId:id,revisionId,rowVersion:1,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',externalIdentifier:'CASCADE:11145',observedAt:asOf,title:'Old scalar must not win',funding:{}};
 const client={release(){},async query(sql,p=[]){queries.push([sql,p]);
  if(sql.includes('FROM public.global_user')||sql.includes('FROM public.platform_admin_assignment'))return {rows:revoked?[]:[{id}]};
  if(sql.startsWith('SELECT DISTINCT'))return {rows:[{name:'DIGITAL'}]};
  if(sql.startsWith('SELECT o.opportunity_id'))return {rows:[{...base,...metadata,snapshot,temporalSnapshot:snapshot}]};
  if(sql.startsWith('SELECT r.snapshot'))return {rows:[{snapshot}]};
  return {rows:[]};}};
 const repository=createFundingRepository({pool:{connect:async()=>client},clock:()=>new Date(asOf)});
 return {repository,queries,revoke(){revoked=true;}};
}
test('accepted revision supplies identical common facts to list and detail; no candidate archive is consulted',async()=>{
 const f=fixture(eu),list=await f.repository.list(),detail=await f.repository.get(id);
 assert.deepEqual(list.items[0].readModel,detail.readModel);
 assert.deepEqual(list.items[0].interventionClassification,detail.interventionClassification);
 assert.deepEqual(list.items[0].catalogPresentation.presentation,detail.catalogPresentation.presentation);
 assert.ok(detail.catalogPresentation.callInformation);
 assert.equal(detail.readModel.projection.financing.allocations.value[0].money.amount,'120000');
 assert.equal(list.items[0].readModel.projection.schedule.deadlines.value.length,7);
 assert.equal(list.items[0].revisionId,revisionId);assert.equal(detail.lifecycleState,'ACTIVE');
 assert.equal(list.items[0].title,'Gnomon Internships Offer');assert.equal(detail.title,'Gnomon Internships Offer');
 assert.equal(detail.readModel.sourceVersion,2);assert.equal(detail.snapshot,eu);
 assert.ok(f.queries.every(([sql])=>!/opportunity_catalog\.(?:funding_candidate_v2|manual_v2_candidate|pt2030_)/.test(sql)));
});

test('v2 freshness uses accepted observations and never stale legacy funding metadata',async()=>{
 const legacyObserved='2020-01-01T00:00:00.000Z',acceptedObserved='2026-10-30T10:00:00.000Z';
 const historical=fixture(eu,{observedAt:legacyObserved});
 const fallback=await historical.repository.get(id);
 assert.equal(fallback.readModel.freshness.observedAt,eu.provenance.observations.map(o=>o.observedAt).sort().at(-1));
 const current=fixture(eu,{observedAt:legacyObserved,canonicalObservedAt:acceptedObserved});
 const detail=await current.repository.get(id),list=await current.repository.list();
 assert.equal(detail.readModel.freshness.observedAt,acceptedObserved);assert.equal(detail.observedAt,acceptedObserved);assert.equal(detail.readModel.freshness.ageSeconds,7200);
 assert.deepEqual(detail.readModel.freshness,list.items[0].readModel.freshness);assert.equal(detail.canonicalObservedAt,undefined);
 assert.ok(current.queries.filter(([sql])=>sql.startsWith('SELECT o.opportunity_id')).every(([sql])=>sql.includes("to_jsonb(o)->>'last_v2_observed_at'")));
});
test('legacy enriched financing is no longer absent from list and keeps its representation',async()=>{
 const batch=await createSource({fetchImpl:async()=>new Response(JSON.stringify(raw)),enrichmentEnabled:true,clock:()=>Date.parse(asOf)}).lookup({externalIdentifier:'CASCADE:11145'});
 // A stored v1 snapshot requires a historical funder label. The source parser
 // deliberately does not claim one when the official record has no awarder.
 const snapshot={schemaVersion:1,...batch.record.fields,funderName:'Historical v1 label',provenanceId:id,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};
 const f=fixture(snapshot),list=await f.repository.list(),detail=await f.repository.get(id);
 assert.equal(list.items[0].readModel.projection.financing.allocations.value[0].amount,'120000');
 assert.equal(list.items[0].readModel.projection.financing.allocations.value[0].currency,null);
 assert.equal(list.items[0].readModel.projection.financing.allocations.representation,'v1-enrichment:budget');
 assert.deepEqual(list.items[0].readModel,detail.readModel);
 assert.deepEqual(list.items[0].interventionClassification,detail.interventionClassification);
});
test('list binds SQL temporal projection to the response clock and filters all programme labels before pagination',async()=>{
 const f=fixture(eu);await f.repository.list({programme:'DIGITAL',temporalState:'OPEN',q:'11145'});
 const [sql,p]=f.queries.find(([q])=>q.startsWith('SELECT o.opportunity_id'));
 assert.equal(p[6],asOf);assert.match(sql,/jsonb_array_elements/);assert.match(sql,/programmes/);assert.match(sql,/identity,references/);
 assert.ok(sql.indexOf('WHERE')<sql.indexOf('LIMIT 26'));assert.match(sql,/current_revision_id/);
});
test('invalid stored versions fail closed and revoked administrators cannot obtain read models',async()=>{
 const f=fixture({...eu,schemaVersion:3});await assert.rejects(f.repository.list());await assert.rejects(f.repository.get(id));
 const g=fixture(eu);g.revoke();await assert.rejects(g.repository.platformList(id,{}),{code:'FUNDING_FORBIDDEN'});
 assert.ok(!g.queries.some(([sql])=>sql.includes('FROM opportunity_catalog')));
});

test('real HTTP catalogue serializes the same accepted v2 facts for authorized list and detail reads',async t=>{
 const express=require('express'),{createFundingRouters}=require('../src/fundingTenders/http');
 const f=fixture(eu),app=express();
 const routers=createFundingRouters({express,pool:{connect:async()=>{throw Error('No admin writes');}},catalogReader:f.repository,
  authenticate(req,_res,next){req.user={id};next();},organizationMiddleware:{requireServerSession(req,_res,next){req.sessionID='isolated';next();},resolveOrganizationContext(_req,_res,next){next();}},
  sessionRegistry:{resolveOrganizationContext:async()=>({state:'VALID'})}});
 app.use('/catalog',routers.catalog);
 const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const root=`http://127.0.0.1:${server.address().port}/catalog`;
 const listResponse=await fetch(root),detailResponse=await fetch(root+'/'+id);
 assert.equal(listResponse.status,200);assert.equal(detailResponse.status,200);assert.equal(listResponse.headers.get('cache-control'),'no-store');
 const list=await listResponse.json(),detail=await detailResponse.json();
 assert.deepEqual(list.items[0].readModel.projection,detail.readModel.projection);
 assert.equal(detail.readModel.revisionId,revisionId);assert.equal(detail.readModel.projection.financing.allocations.value[0].money.amount,'120000');
 assert.equal(detail.readModel.projection.schedule.deadlines.value.length,7);assert.equal(detail.readModel.projection.relatedProject.grantAgreementNumber.value,'101190010');
});
