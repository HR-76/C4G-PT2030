'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createOpportunityInterestRepository,loadInterestForConversion,validateUnitIds,project}=require('../src/opportunityInterests/repository');

function fixture({existing=null,denied=false,sourceSnapshot=null,sourceLifecycle='ACTIVE'}={}){
 const org=randomUUID(),actor={id:randomUUID(),membershipId:randomUUID()},opportunity=randomUUID(),revision=randomUUID();
 const input={opportunityId:opportunity,centralRevisionId:revision,unitIds:[],transversal:true,idempotencyKey:randomUUID()};
 const row=existing?{organization_id:org,interest_id:randomUUID(),central_opportunity_id:opportunity,central_revision_id:revision,
  central_snapshot:{title:'Opportunity'},title:'Opportunity',notes:'Preserved',status:existing,revision:2,created_by:actor.id,
  created_membership_id:actor.membershipId,created_at:new Date(),updated_at:new Date()}:null;
 const state={row,receipts:new Map(),writes:[],guards:[],central:0,changes:[],units:[],links:[]};
 const client={async query(sql,p=[]){
  if(sql.startsWith('SELECT * FROM opportunity_catalog.interest_receipt'))return {rows:state.receipts.has(p[1])?[state.receipts.get(p[1])]:[]};
  if(sql.includes('FROM opportunity_catalog.opportunity_interest'))return {rows:state.row?[state.row]:[]};
  if(sql.startsWith('SELECT')&&sql.includes('FROM opportunity_catalog.interest_unit'))return {rows:state.links.map(scope_id=>({scope_id}))};
  if(sql.includes('FROM organizational_scope.scope'))return {rows:state.units};
  if(sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[]};
  if(sql.startsWith('INSERT INTO opportunity_catalog.opportunity_interest')){
   state.writes.push('interest');state.row={organization_id:p[0],interest_id:p[1],central_opportunity_id:p[2],central_revision_id:p[3],central_snapshot:p[4],title:p[5],notes:p[8]??null,status:'ACTIVE',revision:1,created_by:p[6],created_membership_id:p[7],created_at:new Date(),updated_at:new Date()};return {rows:[state.row]};
  }
  if(sql.startsWith('INSERT INTO opportunity_catalog.interest_receipt')){
   state.writes.push('receipt');state.receipts.set(p[1],{operation:p[2],subject_id:p[3],resource_id:p[4],intention_digest:p[5],result_projection:p[6]});return {rows:[]};
  }
  if(sql.startsWith('INSERT INTO opportunity_catalog.interest_change')){state.writes.push('change');state.changes.push(p);return {rows:[]};}
  if(sql.startsWith('UPDATE opportunity_catalog.interest_unit')){state.links=state.links.filter(id=>p[2].includes(id));return {rows:[]};}
  if(sql.startsWith('INSERT INTO opportunity_catalog.interest_unit')){assert.match(sql,/WHERE NOT EXISTS\(SELECT 1 FROM opportunity_catalog.interest_unit/);if(!state.links.includes(p[2]))state.links.push(p[2]);return {rows:[]};}
  if(sql.startsWith('UPDATE opportunity_catalog.opportunity_interest')){
   if(state.row.revision!==p[4])return {rows:[]};
   state.writes.push('edit');state.row={...state.row,notes:p[2],status:p[3],revision:state.row.revision+1,updated_at:new Date()};return {rows:[state.row]};
  }
  throw Error(`Unexpected query: ${sql}`);
 }};
 const repository=createOpportunityInterestRepository({organizationId:org,actor,cursor:{cursor:v=>v,openCursor:v=>v},
  protect:async args=>{state.guards.push(args);if(denied)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});},authorize:async()=>true,
  centralCurrent:async()=>{state.central++;return {revisionId:revision,...(sourceSnapshot?{opportunityId:opportunity,lifecycleState:sourceLifecycle}:{}),snapshot:sourceSnapshot||{title:'Opportunity',lifecycleState:'ACTIVE'}};},
  centralOrigin:async()=>sourceSnapshot||({title:'Opportunity',lifecycleState:'ACTIVE'}),audit:async()=>state.writes.push('audit')});
 return {org,actor,input,state,client,repository};
}

test('interest registration preserves raw v2 and exposes the common read model without deriving lifecycle from facts',async()=>{
 const sourceSnapshot=require('../../context/references/opportunity-v2/examples/eu-11145.json');
 const f=fixture({sourceSnapshot}),result=await f.repository.register(f.client,f.input);
 assert.equal(result.title,sourceSnapshot.description.title.value);assert.deepEqual(result.snapshot,sourceSnapshot);
 assert.equal(result.readModel.projection.financing.allocations.value[0].money.amount,'120000');
 assert.deepEqual(f.state.row.central_snapshot,sourceSnapshot);
 const archived=fixture({sourceSnapshot,sourceLifecycle:'ARCHIVED'});
 await assert.rejects(archived.repository.register(archived.client,archived.input),{code:'RESOURCE_NOT_AVAILABLE'});
 assert.equal(archived.state.writes.length,0);
});

function largeV2Source(rateCount=56){
 const source=structuredClone(require('../../context/references/opportunity-v2/examples/eu-11145.json')),evidence=source.provenance.evidence[0].id;
 source.financing.rates={state:'PRESENT',value:Array.from({length:rateCount},(_,i)=>({minimumPercent:'0',maximumPercent:'100',scope:'S'+i,conditions:'x'.repeat(4000)})),evidenceRefs:[evidence],reason:null};
 source.schedule.deadlines={state:'PRESENT',value:Array.from({length:64},(_,i)=>({at:{precision:'INSTANT',value:'2028-09-02T04:59:00.000Z',originalTimezone:null},phase:String(i).padStart(128,'X')})),evidenceRefs:[evidence],reason:null};
 require('../src/opportunities/v2').validateSnapshotV2(source);return source;
}

test('interest refuses an oversized detail from a valid v2 snapshot before registration writes without truncation',async()=>{
 const sourceSnapshot=largeV2Source(),before=JSON.stringify(sourceSnapshot),f=fixture({sourceSnapshot});
 assert.ok(require('../src/opportunities/v2/data').jsonbBytes(sourceSnapshot)<256*1024);
 await assert.rejects(f.repository.register(f.client,f.input),{code:'OPPORTUNITY_READ_LIMIT_EXCEEDED'});
 assert.deepEqual(f.state.writes,[]);assert.equal(f.state.row,null);assert.equal(f.state.receipts.size,0);
 assert.equal(JSON.stringify(sourceSnapshot),before);
});

test('interest detail, replay and mutation include capabilities in the shared size limit before any new write',async()=>{
 const {assertDetailSize,MAX_DETAIL_BYTES}=require('../src/opportunities/v2/readModel');
 const f=fixture({sourceSnapshot:require('../../context/references/opportunity-v2/examples/eu-11145.json')});
 await f.repository.register(f.client,f.input);f.state.writes=[];
 f.state.row.central_snapshot=largeV2Source(54);f.state.row.notes='';
 const padding=MAX_DETAIL_BYTES-4096-10-Buffer.byteLength(JSON.stringify(project(f.state.row)));
 assert.ok(padding>0&&padding<10000);f.state.row.notes='n'.repeat(padding);
 const base=project(f.state.row);assertDetailSize(base);
 assert.ok(Buffer.byteLength(JSON.stringify({...base,capabilities:{canRegister:true,canManage:true,canCreateApplication:true,canIncludeResponsibleInTeam:true}}))>MAX_DETAIL_BYTES-4096);
 f.state.receipts.get(f.input.idempotencyKey).result_projection=base;
 for(const read of [()=>f.repository.get(f.client,{},base.interestId),()=>f.repository.register(f.client,f.input),
  ()=>f.repository.register(f.client,{...f.input,idempotencyKey:randomUUID()}),
  ()=>f.repository.edit(f.client,{notes:f.state.row.notes,unitIds:[],expectedRevision:1,idempotencyKey:randomUUID()},base.interestId)]){
  await assert.rejects(read(),{code:'OPPORTUNITY_READ_LIMIT_EXCEEDED'});assert.deepEqual(f.state.writes,[]);
 }
 assert.equal(f.state.row.revision,1);assert.deepEqual(f.state.row.central_snapshot,largeV2Source(54));
});

test('unit assignment reads retain the physical read operation and protect the editing permission',async()=>{
 const f=fixture();await f.repository.units(f.client,{purpose:'ASSIGN'});
 assert.equal(f.state.guards[0].operationCode,'OPPORTUNITY_INTEREST_READ');
 assert.equal(f.state.guards[0].intention.operation,'INTEREST_UNIT_ASSIGN');
 assert.equal(f.state.guards[0].additionalAuthorizations[0].operationCode,'OPPORTUNITY_INTEREST_REGISTER');
});

test('registration authorizes before tenant/catalog reads and never writes on denial',async()=>{
 const f=fixture({denied:true});
 await assert.rejects(f.repository.register(f.client,f.input),{code:'NOT_AUTHORIZED'});
 assert.equal(f.state.central,0);assert.deepEqual(f.state.writes,[]);
});

test('new interest registers without application fields; replay uses the persisted receipt',async()=>{
 const f=fixture();const first=await f.repository.register(f.client,f.input);
 assert.equal(first.status,'ACTIVE');assert.equal(first.notes,null);assert.equal(first.title,'Opportunity');assert.deepEqual(first.unitIds,[]);
 assert.equal(f.state.central,1);assert.equal(f.state.changes.length,1);
 const writes=[...f.state.writes];const replay=await f.repository.register(f.client,f.input);
 assert.equal(replay.interestId,first.interestId);assert.equal(f.state.central,1);assert.deepEqual(f.state.writes,writes);
 await assert.rejects(f.repository.register(f.client,{...f.input,unitIds:[randomUUID()]}),{code:'IDEMPOTENCY_CONFLICT'});
});

for(const status of ['ACTIVE','ARCHIVED'])test(`signalling existing ${status} interest preserves original notes, revision and identity`,async()=>{
 const f=fixture({existing:status});const found=await f.repository.register(f.client,f.input);
 assert.equal(found.interestId,f.state.row.interest_id);assert.equal(found.status,status);assert.equal(found.notes,'Preserved');assert.equal(found.revision,2);
 assert.equal(f.state.central,0);assert.equal(f.state.changes.length,0);assert.deepEqual(f.state.writes,['receipt']);
});

test('new registration refuses a stale catalog revision before business writes',async()=>{
 const f=fixture();await assert.rejects(f.repository.register(f.client,{...f.input,centralRevisionId:randomUUID()}),{code:'STALE_OPPORTUNITY_REVISION'});
 assert.deepEqual(f.state.writes,[]);
});

test('unit validation refuses foreign, missing, archived and non-UNIT selections while preserving existing archived links',async()=>{
 const org=randomUUID(),id=randomUUID();let queries=0;
 const client={query:async(sql,p)=>{queries++;assert.equal(p[0],org);return {rows:[]};}};
 await assert.rejects(validateUnitIds(client,org,[id]),{code:'UNIT_UNAVAILABLE'});
 assert.deepEqual(await validateUnitIds(client,org,[]),[]);
 assert(queries>=1);
 const archived={scope_id:id,label:'Archived',parent_scope_id:null,lifecycle:'ARCHIVED'};
 const archiveClient={query:async()=>({rows:[archived]})};
 await assert.rejects(validateUnitIds(archiveClient,org,[id]),{code:'UNIT_UNAVAILABLE'});
 assert.deepEqual((await validateUnitIds(archiveClient,org,[id],{existingIds:[id]})).map(u=>u.unitId),[id]);
});

test('conversion checks tenant, opportunity, ACTIVE and CAS while preserving its historical observation',async()=>{
 const f=fixture({existing:'ACTIVE'}),id=f.state.row.interest_id;
 const args={organizationId:f.org,interestId:id,expectedRevision:2,opportunityId:f.input.opportunityId,centralRevisionId:f.input.centralRevisionId};
 assert.equal((await loadInterestForConversion(f.client,args)).interest_id,id);
 await assert.rejects(loadInterestForConversion(f.client,{...args,expectedRevision:1}),{code:'STALE_REVISION'});
 await assert.rejects(loadInterestForConversion(f.client,{...args,opportunityId:randomUUID()}),{code:'RESOURCE_NOT_AVAILABLE'});
 const currentRevision=randomUUID();assert.equal((await loadInterestForConversion(f.client,{...args,centralRevisionId:currentRevision})).central_revision_id,f.input.centralRevisionId);
 f.state.row.status='ARCHIVED';await assert.rejects(loadInterestForConversion(f.client,args),{code:'STATE_CONFLICT'});
});

test('assignment units need register/manage authority; FILTER remains available to readers',async()=>{
 const f=fixture();const repository=createOpportunityInterestRepository({organizationId:f.org,actor:f.actor,
  protect:async()=>{},authorize:async op=>op==='OPPORTUNITY_INTEREST_READ',audit:async()=>{}});
 await assert.rejects(repository.units(f.client,{purpose:'ASSIGN'}),{code:'NOT_AUTHORIZED'});
 assert.deepEqual(await repository.units(f.client,{purpose:'FILTER'}),{items:[]});
});

test('management preserves archived unit history, uses CAS, archives logically and replays before terminal checks',async()=>{
 const f=fixture({existing:'ACTIVE'}),id=f.state.row.interest_id,unit=randomUUID();
 f.state.units=[{scope_id:unit,label:'Former unit',parent_scope_id:null,lifecycle:'ARCHIVED'}];f.state.links=[unit];
 const input={notes:'Reviewed',unitIds:[unit],expectedRevision:2,idempotencyKey:randomUUID()};
 const edited=await f.repository.edit(f.client,input,id);
 assert.equal(edited.revision,3);assert.equal(edited.notes,'Reviewed');assert.equal(edited.units[0].lifecycle,'ARCHIVED');
 assert.deepEqual(JSON.parse(f.state.changes[0][8]),edited.units);
 await assert.rejects(f.repository.edit(f.client,{...input,idempotencyKey:randomUUID()},id),{code:'STALE_REVISION'});
 const archive={reason:'No longer relevant',expectedRevision:3,idempotencyKey:randomUUID()};
 const archived=await f.repository.archive(f.client,archive,id);assert.equal(archived.status,'ARCHIVED');assert.deepEqual(archived.unitIds,[unit]);
 const writes=f.state.writes.length;assert.equal((await f.repository.archive(f.client,archive,id)).revision,4);assert.equal(f.state.writes.length,writes);
 await assert.rejects(f.repository.edit(f.client,{...input,expectedRevision:4,idempotencyKey:randomUUID()},id),{code:'STATE_CONFLICT'});
});

test('two deliberate signalling intentions produce one aggregate/history',async()=>{
 const f=fixture();const first=await f.repository.register(f.client,f.input);
 const second=await f.repository.register(f.client,{...f.input,idempotencyKey:randomUUID()});
 assert.equal(first.interestId,second.interestId);assert.equal(f.state.changes.length,1);
 assert.equal(f.state.receipts.size,2);assert.equal(f.state.writes.filter(value=>value==='interest').length,1);
});

test('unit paths distinguish identical leaf labels without loading people',async()=>{
 const f=fixture(),parent=randomUUID(),child=randomUUID();
 f.state.units=[{scope_id:parent,label:'Municipality',parent_scope_id:null,lifecycle:'ACTIVE'},
  {scope_id:child,label:'Planning',parent_scope_id:parent,lifecycle:'ACTIVE'}];
 const result=await f.repository.units(f.client,{purpose:'ASSIGN'});
 assert.equal(result.items.find(unit=>unit.unitId===child).path,'Municipality / Planning');
});

test('interest list applies exact unit filters and cursors without duplicates across authorization gaps',async()=>{
 const org=randomUUID(),actor={id:randomUUID()},all=Array.from({length:55},(_,i)=>({interest_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  central_opportunity_id:randomUUID(),central_revision_id:randomUUID(),central_snapshot:{title:'Source'},title:`Interest ${i}`,notes:null,status:'ACTIVE',revision:1,
  created_by:actor.id,created_membership_id:randomUUID(),created_at:new Date(),updated_at:new Date()}));
 const seen=[],unitId=randomUUID(),repo=createOpportunityInterestRepository({organizationId:org,actor,
  protect:async()=>{},authorize:async(code,target)=>code!=='OPPORTUNITY_INTEREST_READ'||target.id!==all[3].interest_id,
  cursor:{cursor:position=>position,openCursor:value=>value},audit:async()=>{}});
 const client={query:async(sql,p)=>{
  if(sql.startsWith('SELECT scope_id FROM opportunity_catalog.interest_unit')||sql.startsWith('SELECT interest_id,scope_id FROM opportunity_catalog.interest_unit'))return {rows:[]};
  assert.match(sql,/u\.scope_id::text=\$5/);assert.equal(p[0],org);assert.equal(p[4],unitId);
  return {rows:all.filter(row=>p[1]===null||row.interest_id>p[1]).slice(0,100)};
 }};
 let pointer=null;
 do{const result=await repo.list(client,{q:'',status:'ACTIVE',unitId,cursor:pointer});
  for(const item of result.items){assert.equal(Object.hasOwn(item,'snapshot'),false);assert.equal(Object.hasOwn(item,'notes'),false);}
  seen.push(...result.items.map(item=>item.interestId));pointer=result.nextCursor;
 }while(pointer);
 assert.equal(seen.length,54);assert.equal(new Set(seen).size,54);assert(!seen.includes(all[3].interest_id));
});

test('history is immutable projection with stable pagination and original unit names',async()=>{
 const f=fixture({existing:'ACTIVE'}),id=f.state.row.interest_id;
 const changes=Array.from({length:28},(_,i)=>({revision:i+1,kind:'EDIT',title:'Historical',status:'ACTIVE',notes:'Older note',unit_ids:['old'],
  unit_snapshot:[{unitId:'old',label:'Original unit',lifecycle:'ACTIVE'}],reason:null,actor_subject_id:f.actor.id,actor_membership_id:f.actor.membershipId,recorded_at:new Date()}));
 const base=f.client.query;f.client.query=async(sql,p)=>sql.includes('FROM opportunity_catalog.interest_change')?
  {rows:changes.filter(row=>p[2]===null||row.revision<p[2]).reverse().slice(0,26)}:base(sql,p);
 const first=await f.repository.history(f.client,{cursor:null},id),second=await f.repository.history(f.client,{cursor:first.nextCursor},id);
 assert.equal(first.items.length,25);assert.equal(second.items.length,3);assert.equal(first.items[0].units[0].label,'Original unit');
 assert.equal(first.items[0].createdBy,f.actor.id);assert.equal(first.items[0].action,'EDIT');assert.equal(second.nextCursor,null);
});
test('a new registration needs an explicit scope and preserves initial notes in revision one',async()=>{
 const f=fixture()
 await assert.rejects(f.repository.register(f.client,{...f.input,transversal:false}),{code:'INVALID_INPUT'})
 assert.equal(f.state.writes.length,0)
 const saved=await f.repository.register(f.client,{...f.input,notes:'Rever calendário'})
 assert.equal(saved.transversal,true);assert.equal(saved.notes,'Rever calendário')
 assert.equal(f.state.changes[0][5],'Rever calendário')
})
test('summaries return every capability the catalog needs, including starting an application',async()=>{
 const f=fixture();
 const result=await f.repository.summaries(f.client,{opportunityIds:[f.input.opportunityId]});
 assert.deepEqual(Object.keys(result.capabilities).sort(),['canCreateApplication','canIncludeResponsibleInTeam','canManage','canRegister']);
 assert.equal(result.capabilities.canCreateApplication,true);
});
