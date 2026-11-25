const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {areas,match,classify}=require('../src/organizationDirectory/thematicAreas');
const {suggestResearchAreas}=require('../src/utils/researchAreaMatcher');
const {parse}=require('../src/organizationDirectory/contracts');
const {createOrganizationMatching,pages,civilToday}=require('../src/organizationDirectory/matching');
test('restores the original classification and explains the actual words without inventing an eligibility score',()=>{
 const snapshot={summary:'education training vocational students school',title:'Education',lifecycleState:'ACTIVE',opportunityId:randomUUID(),closingDate:'2027-01-01'};
 assert.deepEqual(classify(snapshot),suggestResearchAreas({title:snapshot.title,description:snapshot.summary},areas,{minScore:1,maxSuggestions:3}));
 const education=areas.find(a=>a.name==='Educação e Formação Profissional');
 const result=match({active:true,areaIds:[education.id]},[snapshot,{...snapshot,opportunityId:randomUUID(),closingDate:'2020-01-01'},{...snapshot,lifecycleState:'ARCHIVED'}],'2026-10-17');
 assert.equal(result.length,1);assert.equal(result[0].matchedAreas[0].name,education.name);assert(result[0].matchedAreas[0].keywords.includes('education'));assert(!('score' in result[0].matchedAreas[0]));
 assert.equal(match({active:false,areaIds:[education.id]},[snapshot],'2026-10-17').length,0);
});
test('unknown deadline remains unknown and ties have a deterministic order',()=>{
 const records=['b','a'].map(opportunityId=>({opportunityId,title:'Education training',lifecycleState:'ACTIVE',closingDate:null}));
 assert.deepEqual(match({active:true,areaIds:areas.map(a=>a.id)},records,'2026-10-17').map(x=>x.opportunityId),['a','b']);
});
test('equal opportunity identifiers from distinct origins have deterministic order regardless of source arrival',()=>{
 const id=randomUUID(),person={active:true,areaIds:areas.map(a=>a.id)};
 const records=['PRIVATE','CENTRAL'].map(origin=>({opportunityId:id,origin,title:'Education training',lifecycleState:'ACTIVE',closingDate:null}));
 const forward=match(person,records,'2026-10-17').map(x=>x.origin);
 const reverse=match(person,[...records].reverse(),'2026-10-17').map(x=>x.origin);
 assert.deepEqual(forward,reverse);assert.deepEqual(forward,['CENTRAL','PRIVATE']);
});
test('self edits cannot change identity, membership or inject arbitrary thematic IDs',()=>{
 const input={biography:'',keywords:'',areaIds:[areas[0].id],expectedRevision:0,idempotencyKey:randomUUID()};
 assert.deepEqual(parse('selfEdit',input),input);
 for(const extra of [{membershipId:randomUUID()},{personId:randomUUID()},{areaIds:[randomUUID()]},{areaIds:[areas[0].id,areas[0].id]}])assert.throws(()=>parse('selfEdit',{...input,...extra}),{code:'INVALID_INPUT'});
});
test('incomplete source reads fail rather than returning partial matches',async()=>{
 await assert.rejects(pages(async()=>({items:[],nextCursor:'repeat'})),{code:'SERVICE_UNAVAILABLE'});
 const d={execute:async()=>({person:{personId:randomUUID(),active:true},profile:{areaIds:[areas[0].id]}})};
 const service=createOrganizationMatching({directory:d,opportunities:{list:async()=>{throw Error('denied')}},central:{list:async()=>({items:[],nextCursor:null})}});
 await assert.rejects(service.execute({},{}),/denied/);
});
test('matching source returns exactly 1000 items completely and refuses 1001 without publishing a partial result',async()=>{
 const fixture=Array.from({length:1001},(_,index)=>({id:index}));
 const reader=count=>async({cursor}={})=>{const offset=Number(cursor||0),items=fixture.slice(offset,Math.min(offset+25,count));return{items,nextCursor:offset+25<count?String(offset+25):null};};
 assert.deepEqual(await pages(reader(1000)),fixture.slice(0,1000));
 await assert.rejects(pages(reader(1001)),{code:'LIMIT_EXCEEDED'});
});

test('matching rejects a repeated continuation even if the source keeps returning items',async()=>{
 let calls=0;
 await assert.rejects(pages(async()=>({items:[{id:++calls}],nextCursor:'same'})),{code:'SERVICE_UNAVAILABLE'});
 assert.equal(calls,2);
});

test('matching bounds empty pages with distinct continuations instead of making unbounded requests',async()=>{
 let calls=0;
 await assert.rejects(pages(async()=>{calls++;return {items:[],nextCursor:calls<1002?String(calls):null}}),{code:'LIMIT_EXCEEDED'});
 assert.equal(calls,1001);
});
test('the page bound still permits a complete source of 1000 one-item pages',async()=>{
 let calls=0;
 const result=await pages(async()=>{calls++;return {items:[calls],nextCursor:calls<1000?String(calls):null}});
 assert.equal(result.length,1000);assert.equal(calls,1000);
});
test('missing association and missing competencies are distinct and do not read opportunities',async()=>{
 let result={person:null};const directory={execute:async()=>result};const service=createOrganizationMatching({directory,opportunities:{},central:{}});
 assert.equal((await service.execute({},{})).state,'PROFILE_NOT_LINKED');result={person:{active:true},profile:{areaIds:[]}};
 assert.equal((await service.execute({},{})).state,'NO_AREAS');
});
test('a revoked context after reading sources cannot publish matching results',async()=>{
 let calls=0;const directory={execute:async()=>{if(++calls>1)throw Error('context changed');return {person:{active:true},profile:{areaIds:[areas[0].id]}}}};
 const service=createOrganizationMatching({directory,opportunities:{list:async()=>({items:[]})},central:{list:async()=>({items:[]})}});
 await assert.rejects(service.execute({},{}),/context changed/);
});
test('matching refuses to publish when the person profile changes during source reads',async()=>{
 let calls=0;const personId=randomUUID(),area=areas[0].id;
 const directory={execute:async()=>({person:{personId,active:true,revision:1},profile:{areaIds:++calls===1?[area]:[]}})};
 const service=createOrganizationMatching({directory,opportunities:{list:async()=>({items:[]})},central:{list:async()=>({items:[]})}});
 await assert.rejects(service.execute({},{}),{code:'CONTEXT_CHANGED'});
});
test('private matching reads current snapshots in one authorized page operation',async()=>{
 const opportunityId=randomUUID(),calls={list:0,get:0};
 const education=classify({title:'Education training'})[0];
 const directory={execute:async()=>({person:{personId:randomUUID(),active:true},profile:{areaIds:[education.id]}})};
 const opportunities={
  listForMatching:async()=>{calls.list++;return {items:[{opportunityId,lifecycleState:'ACTIVE',closingDate:'2027-01-01',snapshot:{title:'Education training',programmeName:'Digital',lifecycleState:'ACTIVE',closingDate:'2027-01-01'}}],nextCursor:null}},
  get:async()=>{calls.get++;throw Error('N+1 detail read')}
 };
 const service=createOrganizationMatching({directory,opportunities,central:{list:async()=>({items:[],nextCursor:null})},clock:()=>new Date('2026-10-19T12:00:00Z')});
 const result=await service.execute({},{});
 assert.equal(result.items.length,1);assert.equal(result.items[0].href,`/oportunidades/${opportunityId}`);assert.deepEqual(calls,{list:1,get:0});
});
test('matching expiry uses the civil day in Lisbon rather than UTC',async()=>{
 assert.equal(civilToday(new Date('2026-07-01T23:30:00Z')),'2026-07-02');
 const opportunityId=randomUUID(),education=classify({title:'Education training'})[0];
 const directory={execute:async()=>({person:{personId:randomUUID(),active:true},profile:{areaIds:[education.id]}})};
 const service=createOrganizationMatching({directory,clock:()=>new Date('2026-07-01T23:30:00Z'),central:{list:async()=>({items:[{opportunityId,lifecycleState:'ACTIVE',closingDate:'2026-07-01'}],nextCursor:null}),get:async()=>({snapshot:{title:'Education training',lifecycleState:'ACTIVE',closingDate:'2026-07-01'}})},opportunities:{listForMatching:async()=>({items:[],nextCursor:null})}});
 assert.deepEqual((await service.execute({},{})).items,[]);
});
test('opportunity matching uses one people/areas operation per page and revalidates after the last page',async()=>{
 const opportunityId=randomUUID(),education=classify({title:'Education training'})[0],calls=[];
 const people=Array.from({length:60},(_,n)=>({personId:randomUUID(),name:`Pessoa ${n}`,active:true,areaIds:[education.id]}));
 const directory={async execute(method,query){calls.push(method);if(method==='context')return {};
  assert.equal(method,'peopleWithResearchAreas','individual person query must never occur');const offset=Number(query.cursor||0);
  return {items:people.slice(offset,offset+25),nextCursor:offset+25<people.length?String(offset+25):null};}};
 const service=createOrganizationMatching({directory,opportunities:{},central:{get:async()=>({snapshot:{title:'Education training',lifecycleState:'ACTIVE',closingDate:'2027-12-31'}})},clock:()=>new Date('2026-10-26T12:00:00Z')});
 const result=await service.execute({opportunityId,origin:'CENTRAL'},{});
 assert.equal(result.items.length,60);assert.deepEqual(calls,['context','peopleWithResearchAreas','peopleWithResearchAreas','peopleWithResearchAreas','context']);
 assert(result.items.every(person=>!Object.hasOwn(person,'areaIds')&&person.matchedAreas.length===1));
});

test('opportunity matching cannot publish people when authority is revoked during source reads',async()=>{
 const opportunityId=randomUUID(),education=classify({title:'Education training'})[0],calls=[];
 const request={sessionID:'request-bound-session'};
 let contexts=0;
 const directory={async execute(method,query,id,received){
  assert.equal(received,request);calls.push(method);
  if(method==='context'){if(++contexts===2)throw Object.assign(new Error('revoked'),{code:'NOT_AUTHORIZED'});return {};}
  return {items:[{personId:randomUUID(),name:'Pessoa',active:true,areaIds:[education.id]}],nextCursor:null};
 }};
 const service=createOrganizationMatching({directory,opportunities:{},central:{get:async()=>({snapshot:{title:'Education training',lifecycleState:'ACTIVE'}})}});
 await assert.rejects(service.execute({opportunityId,origin:'CENTRAL'},request),{code:'NOT_AUTHORIZED'});
 assert.deepEqual(calls,['context','peopleWithResearchAreas','context']);
});

test('matching denies an unavailable membership before reading public or private opportunities',async()=>{
 const reads=[];
 const source={list:async()=>{reads.push('list');return {items:[]}},get:async()=>{reads.push('get');return {snapshot:{}}}};
 const service=createOrganizationMatching({directory:{execute:async()=>{throw Object.assign(new Error('membership revoked'),{code:'NOT_AUTHORIZED'})}},central:source,opportunities:source});
 for(const query of [{},{opportunityId:randomUUID(),origin:'CENTRAL'},{opportunityId:randomUUID(),origin:'PRIVATE'}])await assert.rejects(service.execute(query,{}),{code:'NOT_AUTHORIZED'});
 assert.deepEqual(reads,[]);
});
test('a technician is matched against the catalog only and is told that private opportunities were not considered',async()=>{
 const person={person:{personId:randomUUID(),active:true},profile:{areaIds:[areas[0].id]}};
 const build=({canReadPrivate,privateCalls})=>createOrganizationMatching({directory:{execute:async()=>person,...(canReadPrivate===undefined?{}:{canReadPrivateOpportunities:async()=>canReadPrivate})},
  opportunities:{list:async()=>{privateCalls.n++;return {items:[],nextCursor:null}}},central:{list:async()=>({items:[],nextCursor:null})}});
 const blocked={n:0},result=await build({canReadPrivate:false,privateCalls:blocked}).execute({},{});
 assert.equal(blocked.n,0);assert.equal(result.state,'READY');assert.equal(result.privateIncluded,false);
 const allowed={n:0},full=await build({canReadPrivate:true,privateCalls:allowed}).execute({},{});
 assert.equal(allowed.n,1);assert.equal(full.privateIncluded,true);
 const legacy={n:0},old=await build({privateCalls:legacy}).execute({},{});
 assert.equal(legacy.n,1);assert.equal(old.privateIncluded,true);
 const failing=createOrganizationMatching({directory:{execute:async()=>person,canReadPrivateOpportunities:async()=>{throw Object.assign(Error(),{code:'SERVICE_UNAVAILABLE'})}},opportunities:{list:async()=>({items:[],nextCursor:null})},central:{list:async()=>({items:[],nextCursor:null})}});
 await assert.rejects(failing.execute({},{}),{code:'SERVICE_UNAVAILABLE'});
});

test('refuses opportunity matching with NOT_AUTHORIZED when the caller cannot read people (not a dependency failure)',async()=>{
 const opportunityId=randomUUID();
 const directory={execute:async(operation)=>{if(operation==='context')return {};throw Object.assign(Error('denied'),{code:'AUTHORIZATION_DENIED'})}};
 const opportunities={get:async()=>({snapshot:{title:'Education training',lifecycleState:'ACTIVE',closingDate:'2027-01-01'}})};
 const service=createOrganizationMatching({directory,opportunities,central:{get:async()=>({snapshot:{title:'Education training',lifecycleState:'ACTIVE',closingDate:'2027-01-01'}}),list:async()=>({items:[],nextCursor:null})}});
 await assert.rejects(service.execute({opportunityId,origin:'CENTRAL'},{}),error=>error.code==='NOT_AUTHORIZED');
});
