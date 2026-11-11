'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {buildProjection,emptyExtension,stableId}=require('../src/opportunities/catalogRead/model');
const {createReadService,TTL}=require('../src/opportunities/catalogRead/readService');
const {validate}=require('../src/opportunities/catalogRead/contractValidation');
const fixture=require('../../test/integration/catalog-read/snapshot-v2.json');
const instant=Date.parse('2027-01-20T12:00:00.000Z');
function payload(i,edit=()=>{}){const s=structuredClone(fixture);s.description.title.value='Energia Ágil '+String(i).padStart(3,'0');edit(s);const e=emptyExtension(s,{opportunityId:stableId('read',i),revisionId:stableId('read-rev',i),extensionId:stableId('read-ext',i),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T11:00:00.000Z'});return buildProjection(s,e,{asOf:new Date(instant).toISOString()});}
const all=Array.from({length:27},(_,i)=>payload(i));
function setup(rows=all){let now=instant,scope='subject:organization:membership:version1',calls=0,available=true;const generation={id:stableId('generation'),asOf:new Date(instant).toISOString(),rows};const other={...generation,id:stableId('generation-new'),rows:[]};let current=generation;
 const service=createReadService({key:randomBytes(32),clock:()=>now,authorize:async p=>{if(!p)throw Object.assign(Error(),{code:'SESSION_REQUIRED',status:401});if(p==='revoked')throw Object.assign(Error(),{code:'ACCESS_DENIED',status:403});return {scope:p==='other'?'other-scope':scope,expiresAt:instant+2*TTL};},repository:{async load(id){calls++;if(!available)throw Object.assign(Error(),{code:'SNAPSHOT_UNAVAILABLE',status:410});return id===generation.id?generation:current;}}});
 const get=(path='/opportunities',pairs=[],principal='member')=>service.request({principal,path,pairs});return {get,service,generation,setNow:n=>now=n,setScope:s=>scope=s,publish:()=>current=other,unavailable:()=>available=false,calls:()=>calls};}
test('list uses 25, stable keyset, no duplicates and frozen generation/detail across publication',async()=>{
 const f=setup(),a=await f.get('/opportunities',[['sort','title']]);assert.equal(a.data.length,25);assert.equal(a.page.hasMore,true);assert.equal(validate('ListResponse',a).valid,true);f.publish();
 const b=await f.get('/opportunities',[['sort','title'],['cursor',a.page.nextCursor],['snapshot',a.meta.snapshot]]);assert.equal(b.data.length,2);assert.equal(new Set([...a.data,...b.data].map(r=>r.id)).size,27);assert.equal(b.meta.asOf,a.meta.asOf);
 const d=await f.get('/opportunities/'+a.data[0].id,[['snapshot',a.meta.snapshot]]);assert.deepEqual(d.data.summary,a.data[0]);assert.equal((await f.get()).data.length,0);
});
test('absolute expiry boundary, no sliding renewal, wrong subject and scope invalidation',async()=>{
 const f=setup(all.slice(0,1)),a=await f.get();f.setNow(instant+TTL-1);const b=await f.get('/opportunities',[['snapshot',a.meta.snapshot]]);assert.equal(b.meta.expiresAt,a.meta.expiresAt);
 await assert.rejects(f.get('/opportunities',[['snapshot',a.meta.snapshot]],'other'),{code:'SNAPSHOT_SCOPE_MISMATCH'});f.setNow(instant+TTL);await assert.rejects(f.get('/opportunities',[['snapshot',a.meta.snapshot]]),{code:'SNAPSHOT_EXPIRED'});f.setNow(instant);f.setScope('version2');await assert.rejects(f.get('/opportunities',[['snapshot',a.meta.snapshot]]),{code:'SNAPSHOT_SCOPE_MISMATCH'});
});
test('authority precedes resource lookup and tokens do not confer access',async()=>{const f=setup(),a=await f.get();const before=f.calls();for(const principal of [null,'revoked'])await assert.rejects(f.get('/opportunities',[['snapshot',a.meta.snapshot]],principal));assert.equal(f.calls(),before);});
test('tampered tokens and changed cursor filters are rejected, canonical defaults accepted',async()=>{
 const f=setup(),a=await f.get('/opportunities',[['q',' ÉNERGIA ']]);
 await assert.rejects(f.get('/opportunities',[['snapshot',a.meta.snapshot.slice(0,-2)+'ZZ']]),{code:'INVALID_SNAPSHOT'});
 await assert.rejects(f.get('/opportunities',[['q','other'],['snapshot',a.meta.snapshot],['cursor',a.page.nextCursor]]),{code:'CURSOR_CONTEXT_MISMATCH'});
 assert.equal((await f.get('/opportunities',[['q','energia'],['sort','-observed_at'],['limit','25'],['snapshot',a.meta.snapshot],['cursor',a.page.nextCursor]])).data.length,2);
 await assert.rejects(f.get('/options',[['dimension','source'],['snapshot',a.meta.snapshot],['cursor',a.page.nextCursor]]),{code:'CURSOR_CONTEXT_MISMATCH'});
});
test('query rejects duplicates, unsafe/unknown filters, invalid dates and incomplete money filters',async()=>{const f=setup(all.slice(0,1));for(const pairs of [[['q','a'],['q','b']],[['organizationId',stableId('foreign')]],[['limit','50']],[['deadline_from','2027-02-30']],[['funding_min','100']],[['areas','energy']]])await assert.rejects(f.get('/opportunities',pairs),{code:'INVALID_QUERY'});await assert.rejects(f.get('/opportunities',[['programme','missing']]),{code:'FILTER_VALUE_UNKNOWN'});});
test('money filtering is exact and unknown currencies are not assumed',async()=>{const rows=[payload(1,s=>{s.financing.allocations.value[0].money.currency={state:'PRESENT',value:'EUR',evidenceRefs:['budget'],reason:null};s.financing.allocations.value[0].money.amount='999999999999999999999999.12345678';}),payload(2)];const f=setup(rows);assert.equal((await f.get('/opportunities',[['currency','EUR'],['funding_min','999999999999999999999999.12345678']])).data.length,1);assert.equal((await f.get('/opportunities',[['currency','USD']])).data.length,0);});
test('options, collections and evidence IDs use the same snapshot and contract',async()=>{const f=setup(all.slice(0,1)),a=await f.get('/options',[['dimension','source']]);assert.equal(validate('OptionResponse',a).valid,true);const id=all[0].opportunityId;for(const name of ['windows','funding','funding-rules','documents','conflicts','relationships','history','evidence']){const r=await f.get('/opportunities/'+id+'/'+name,[['snapshot',a.meta.snapshot]]);assert.equal(r.meta.generationId,a.meta.generationId);}
 const evidence=await f.get('/opportunities/'+id+'/evidence',[['snapshot',a.meta.snapshot],['ids',all[0].collections.evidence[0].id]]);assert.equal(evidence.data.length,1);await assert.rejects(f.get('/opportunities/'+id+'/evidence',[['snapshot',a.meta.snapshot],['ids',stableId('missing-evidence')]]),{code:'RESOURCE_NOT_FOUND'});
});
test('temporal state is reconstructed at snapshot asOf, then frozen',async()=>{const f=setup([payload(0,s=>{s.schedule.deadlines.value=[{at:{precision:'INSTANT',value:'2027-02-01T12:00:00.000Z',originalTimezone:'+00:00'},phase:null}];})]);f.setNow(Date.parse('2027-03-01T12:00:00Z')); // Use a separate authority whose session remains valid at this time.
 const service=createReadService({key:randomBytes(32),clock:()=>Date.parse('2027-03-01T12:00:00Z'),authorize:async()=>({scope:'x',expiresAt:Date.parse('2028-01-01')}),repository:{load:async()=>f.generation}});
 const r=await service.request({principal:'x',path:'/opportunities'});assert.equal(r.data[0].status.code,'closed');assert.equal(r.meta.asOf,'2027-03-01T12:00:00.000Z');
});
test('missing generation, old or corrupted projections fail explicitly',async()=>{const f=setup(all.slice(0,1)),a=await f.get();f.unavailable();await assert.rejects(f.get('/opportunities',[['snapshot',a.meta.snapshot]]),{code:'SNAPSHOT_UNAVAILABLE'});const bad=structuredClone(all[0]);bad.detail.summary.title.value='changed';await assert.rejects(setup([bad]).get(),{code:'CATALOG_UNAVAILABLE'});const old=structuredClone(all[0]);old.version='gcni-catalog-projection/1.1';await assert.rejects(setup([old]).get(),{code:'CATALOG_UNAVAILABLE'});});
test('revocation during work prevents release of the response',async()=>{let allowed=true;const s=createReadService({key:randomBytes(32),clock:()=>instant,authorize:async()=>{if(!allowed)throw Object.assign(Error(),{code:'ACCESS_DENIED',status:403});return {scope:'x',expiresAt:instant+TTL};},repository:{load:async()=>{allowed=false;return {id:stableId('g'),asOf:new Date(instant).toISOString(),rows:[]};}}});await assert.rejects(s.request({principal:'x',path:'/opportunities'}),{code:'ACCESS_DENIED'});});
module.exports={payload,setup};
test('collection byte budget produces resumable short pages without losing documents',async()=>{
 const base=payload(99),e=structuredClone(base.inputs.extension),evidence=base.collections.evidence[0].id;
 e.documents.items=Array.from({length:4},(_,i)=>({id:stableId('big-doc',i),documentId:stableId('logical-doc',i),title:'Long document '+i,versionLabel:'1',role:'notice',contentSha256:null,publishedAt:null,effectiveAt:null,observedAt:'2027-01-20T11:00:00.000Z',sourceUrls:Array.from({length:100},(_,j)=>'https://example.org/'+j+'/'+('a'.repeat(1980))),supersedesVersionId:null,supersessionScope:null,preservation:'reference_only',evidenceIds:[evidence]}));
 const p=buildProjection(base.inputs.snapshot,e,{asOf:base.asOf}),f=setup([p]),list=await f.get();const route='/opportunities/'+p.opportunityId+'/documents';
 const a=await f.get(route,[['snapshot',list.meta.snapshot]]);assert(a.data.length<4&&a.data.length>0);assert(Buffer.byteLength(JSON.stringify(a))<=524288);assert(a.page.hasMore);
 const b=await f.get(route,[['snapshot',list.meta.snapshot],['cursor',a.page.nextCursor]]);assert.equal(new Set([...a.data,...b.data].map(x=>x.id)).size,4);assert.equal(b.page.hasMore,false);
});
test('a single oversized item fails explicitly instead of silently truncating facts',async()=>{
 const base=payload(98),e=structuredClone(base.inputs.extension),ev=base.collections.evidence[0].id;
 e.conflicts.items=[{id:stableId('large-conflict'),fieldPath:'description',scopeLabel:'Aviso',severity:'informational',status:'resolved',reason:'Historical review',alternatives:Array.from({length:100},(_,i)=>({id:stableId('alternative',i),valueText:'x'.repeat(7900),evidenceIds:[ev]})),selectedAlternativeId:null,decision:{decidedAt:'2027-01-20T11:00:00.000Z',reason:'Resolved without selecting a value'}}];
 const p=buildProjection(base.inputs.snapshot,e,{asOf:base.asOf}),f=setup([p]),a=await f.get();await assert.rejects(f.get('/opportunities/'+p.opportunityId+'/conflicts',[['snapshot',a.meta.snapshot]]),{code:'PROJECTION_ITEM_TOO_LARGE'});
});
test('deadline uncertainty sorts last in both directions and does not pass date filter',async()=>{
 const certain=payload(1),missing=payload(2,s=>{s.schedule.deadlines={state:'NOT_COLLECTED',value:null,evidenceRefs:[],reason:'NOT_REQUESTED'};});const f=setup([certain,missing]);
 for(const sort of ['deadline','-deadline'])assert.equal((await f.get('/opportunities',[['sort',sort]])).data.at(-1).id,missing.opportunityId);
 assert.equal((await f.get('/opportunities',[['deadline_from','2027-01-01']])).data.length,1);
});
