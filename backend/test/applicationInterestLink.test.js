'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApplicationRepository}=require('../src/applications/repository');
const {command}=require('../src/applications/contracts');
const {selection}=require('../src/applications/browseSql');
const {storeUnits}=require('../src/applications/interestLink');
const {project}=require('../src/applications/repository');
const {query}=require('../src/applications/contracts');
function fixture({schema=true,denied=false}={}){
 const org=randomUUID(),actor={id:randomUUID(),membershipId:randomUUID()},opportunityId=randomUUID(),unitId=randomUUID(),interestId=randomUUID(),centralRevisionId=randomUUID();
 const history=[],receipts=new Map(),apps=[],guards=[],audit=[],queries=[];
 const interest={organization_id:org,interest_id:interestId,central_opportunity_id:opportunityId,central_revision_id:randomUUID(),revision:2,status:'ACTIVE'};
 const units=[{scope_id:unitId,label:'Projetos',parent_scope_id:null,lifecycle:'ACTIVE'}];
 const client={async query(sql,params=[]){queries.push({sql,params});
  const numbers=[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]));if(numbers.length)assert.equal(Math.max(...numbers),params.length,'bound SQL parameters match');
  if(sql.startsWith('SELECT * FROM opportunity_catalog.application_receipt'))return {rows:receipts.has(params[1])?[receipts.get(params[1])]:[]};
  if(sql.includes('pg_catalog.pg_attribute'))return {rows:[{extended:true,interest_units:schema}]};
  if(sql.startsWith('SELECT * FROM opportunity_catalog.opportunity_interest'))return {rows:[interest]};
  if(sql.includes('FROM organizational_scope.scope'))return {rows:units};
  if(sql.startsWith('INSERT INTO opportunity_catalog.application(')){
   const row={organization_id:org,application_id:params[1],opportunity_id:null,central_opportunity_id:opportunityId,central_revision_id:centralRevisionId,evaluation_id:null,title:params[2],responsible_membership_id:params[3],deadline:params[4],status:'IDENTIFIED',revision:1,notes:params[9],source_interest_id:params[12],source_interest_revision:params[13],created_at:new Date(),updated_at:new Date()};apps.push(row);return {rows:[row]};
  }
  if(sql.startsWith('INSERT INTO opportunity_catalog.application_change'))history.push(params);
  if(sql.startsWith('INSERT INTO opportunity_catalog.application_receipt'))receipts.set(params[1],{operation:params[2],subject_id:params[3],resource_id:params[4],intention_digest:params[5],result_projection:params[6]});
  return {rows:[],rowCount:1};
 }};
 const repo=createApplicationRepository({organizationId:org,actor,protect:async args=>{guards.push(args);if(denied)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});},authorize:async()=>true,verifyResponsible:async()=>true,
  centralOrigin:async()=>({title:'Aviso',lifecycleState:'ACTIVE'}),centralCurrent:async()=>({revisionId:centralRevisionId}),audit:async(c,e)=>audit.push(e)});
 const input=command('create',{origin:'CENTRAL',opportunityId,centralRevisionId,evaluationId:null,title:'Projeto',responsibleMembershipId:randomUUID(),deadline:'2026-12-31',idempotencyKey:randomUUID(),sourceInterestId:interestId,sourceInterestRevision:2,unitIds:[unitId],includeResponsibleInTeam:true});
 return {repo,client,input,interest,units,apps,history,guards,queries,audit,unitId,org};
}
test('conversion preserves signal observation, selected units, exact new source and explicit team in one command',async()=>{
 const f=fixture(),result=await f.repo.create(f.client,f.input);
 assert.equal(result.sourceInterestId,f.input.sourceInterestId);assert.equal(result.sourceInterestRevision,2);assert.equal(result.centralRevisionId,f.input.centralRevisionId);
 assert.deepEqual(result.unitIds,[f.unitId]);assert.equal(result.status,'IDENTIFIED');
 assert.notEqual(f.interest.central_revision_id,result.centralRevisionId,'signal observation remains historical');
 assert.deepEqual(f.history[0].at(-2),[f.unitId]);assert.equal(JSON.parse(f.history[0].at(-1))[0].label,'Projetos');
 for(const op of ['OPPORTUNITY_INTEREST_READ','OPPORTUNITY_INTEREST_MANAGE','APPLICATION_WORK_EDIT'])assert.ok(f.guards[0].additionalAuthorizations.some(check=>check.operationCode===op));
 assert.equal(f.queries.filter(q=>q.sql.startsWith('INSERT INTO opportunity_catalog.application_participant')).length,1);
 f.interest.status='ARCHIVED';f.units[0].lifecycle='ARCHIVED';
 assert.deepEqual(await f.repo.create(f.client,f.input),result,'committed retry survives later changes');assert.equal(f.apps.length,1);assert.equal(f.audit.length,2);
});
test('conversion rejects foreign/stale source and archived new units before creating anything',async()=>{
 for(const scenario of ['foreign','stale','unit']){
  const f=fixture();if(scenario==='foreign')f.interest.organization_id=randomUUID();if(scenario==='stale')f.interest.revision=3;if(scenario==='unit')f.units[0].lifecycle='ARCHIVED';
  await assert.rejects(f.repo.create(f.client,f.input),{code:scenario==='foreign'?'RESOURCE_NOT_AVAILABLE':scenario==='stale'?'STALE_REVISION':'UNIT_UNAVAILABLE'});assert.equal(f.apps.length,0);
 }
});
test('new fields fail closed on old schema and failed authority does not read tenant data',async()=>{
 const old=fixture({schema:false});await assert.rejects(old.repo.create(old.client,old.input),{code:'SCHEMA_UPGRADE_REQUIRED'});assert.equal(old.apps.length,0);
 const denied=fixture({denied:true});await assert.rejects(denied.repo.create(denied.client,denied.input),{code:'NOT_AUTHORIZED'});assert.equal(denied.queries.length,0);
});
test('unit filter uses a scoped EXISTS instead of multiplying candidacy rows',()=>{
 const unit=randomUUID(),authority={teamOnly:true,membershipId:randomUUID(),application:{all:false,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:false,ids:[]}};
 const selected=selection(randomUUID(),authority,new Map(),{unitId:unit});assert.equal(selected.params[12],unit);assert.match(selected.sql,/EXISTS\(SELECT 1 FROM opportunity_catalog.application_unit au WHERE au.organization_id=a.organization_id AND au.application_id=a.application_id AND au.active AND au.scope_id=\$13::uuid\)/);assert.doesNotMatch(selected.sql,/JOIN opportunity_catalog.application_unit/);
 const none=selection(randomUUID(),authority,new Map(),{unitId:'NONE'});assert.match(none.sql,/NOT EXISTS\(SELECT 1 FROM opportunity_catalog.application_unit/);assert.equal(none.params.length,12);
});

test('unchanged unit links do not reinsert an archived unit through its activation trigger',async()=>{
 const queries=[];await storeUnits({query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}},randomUUID(),randomUUID(),[randomUUID()]);
 const insert=queries.find(query=>query.sql.startsWith('INSERT INTO'));
 assert.match(insert.sql,/WHERE NOT EXISTS\(SELECT 1 FROM opportunity_catalog.application_unit/);
 assert.match(insert.sql,/scope_id=\$3 AND active\)/);
});

test('application unit facets use authorized applications and require authority before reading',async()=>{
 const org=randomUUID(),membershipId=randomUUID(),unitId=randomUUID(),queries=[];
 const authority={teamOnly:true,membershipId,application:{all:false,ids:[randomUUID()]},opportunity:{all:true,ids:[]},evaluation:{all:false,ids:[]}};
 const client={query:async(sql,params)=>{queries.push({sql,params});return {rows:sql.includes('to_regclass')?[{available:true}]:[{scope_id:unitId,label:'Former unit',parent_scope_id:null,lifecycle:'ARCHIVED'}]};}};
 const repo=createApplicationRepository({organizationId:org,actor:{id:randomUUID()},protect:async()=>{},readAuthority:async()=>authority});
 assert.deepEqual(await repo.unitOptions(client),{items:[{unitId,label:'Former unit',parentUnitId:null,lifecycle:'ARCHIVED'}]});
 assert.match(queries[1].sql,/JOIN visible a ON a.organization_id=u.organization_id/);
 assert.equal(queries[1].params[0],org);assert.equal(queries[1].params[1],true);assert.equal(queries[1].params[2],membershipId);
 const denied=createApplicationRepository({organizationId:org,actor:{id:randomUUID()},protect:async()=>{throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});}});
 await assert.rejects(denied.unitOptions({query:()=>assert.fail('unauthorized read')}),{code:'NOT_AUTHORIZED'});
});

function pageFixture(){
 const org=randomUUID(),actor={id:randomUUID()},unitId=randomUUID(),parentId=randomUUID(),queries=[];
 const rows=Array.from({length:28},(_,i)=>({organization_id:org,application_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,opportunity_id:randomUUID(),evaluation_id:null,title:`Application ${i}`,
  responsible_membership_id:randomUUID(),deadline:'2026-12-31',status:'IDENTIFIED',revision:1,notes:null,source_interest_id:null,source_interest_revision:null,created_at:new Date(),updated_at:new Date()}));
 const directory=[{scope_id:parentId,label:'Investigação',parent_scope_id:null,lifecycle:'ACTIVE'},{scope_id:unitId,label:'Projetos',parent_scope_id:parentId,lifecycle:'ARCHIVED'}];
 const client={async query(sql,params=[]){
  if(sql==='SET LOCAL jit = off')return {rows:[]};
  queries.push({sql,params});
  if(sql.includes('FROM opportunity_catalog.application_unit'))return {rows:params[1].filter(id=>id!==rows[2].application_id).map(application_id=>({application_id,scope_id:unitId}))};
  if(sql.includes('FROM organizational_scope.scope'))return {rows:directory};
  if(sql.startsWith('WITH names AS'))return {rows:[{total:28,items:rows.slice(0,25),counts:{IDENTIFIED:28},fingerprint:'page'}]};
  if(sql.startsWith('SELECT a.*'))return {rows};
  assert.fail(`Unexpected page query: ${sql}`);
 }};
 const repo=createApplicationRepository({organizationId:org,actor,protect:async()=>{},authorize:async(op,target)=>target.id!==rows[1].application_id,
  cursor:{cursor:value=>value,openCursor:value=>value},responsibleDirectory:async()=>new Map(),transitionCapability:async()=>false,
  readAuthority:async()=>({teamOnly:false,membershipId:randomUUID(),application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:true,ids:[]}})});
 return {org,rows,repo,client,queries,unitId,parentId};
}

test('an unloaded unit projection does not claim the application has no units',()=>{
 const f=pageFixture(),row=project(f.rows[0]);
 assert.equal(row.sourceInterestId,null);assert.equal(Object.hasOwn(row,'unitIds'),false);assert.equal(Object.hasOwn(row,'units'),false);
});

test('list hydrates units only for its authorized page using one links and one directory query',async()=>{
 const f=pageFixture(),result=await f.repo.list(f.client,{cursor:null,opportunityId:null});
 assert.equal(result.items.length,25);assert.deepEqual(result.items[0].unitIds,[f.unitId]);
 assert.equal(result.items[0].units[0].path,'Investigação / Projetos');assert.equal(result.items[0].units[0].lifecycle,'ARCHIVED');
 assert.deepEqual(result.items.find(row=>row.applicationId===f.rows[2].application_id).unitIds,[]);
 const links=f.queries.filter(entry=>entry.sql.includes('FROM opportunity_catalog.application_unit'));
 assert.equal(links.length,1);assert.equal(links[0].params[0],f.org);assert.deepEqual(links[0].params[1],result.items.map(row=>row.applicationId));
 assert(!links[0].params[1].includes(f.rows[1].application_id));assert(!links[0].params[1].includes(f.rows[27].application_id));
 assert.equal(f.queries.filter(entry=>entry.sql.includes('FROM organizational_scope.scope')).length,1);
});

test('browse hydrates the returned page with current unit labels without one query per application',async()=>{
 const f=pageFixture(),result=await f.repo.browse(f.client,query('browse',{}));
 assert.equal(result.items.length,25);assert.deepEqual(result.items[0].unitIds,[f.unitId]);assert.equal(result.items[0].units[0].label,'Projetos');
 const links=f.queries.filter(entry=>entry.sql.includes('FROM opportunity_catalog.application_unit'));
 assert.equal(links.length,1);assert.deepEqual(links[0].params,[f.org,result.items.map(row=>row.applicationId)]);
 assert.equal(f.queries.filter(entry=>entry.sql.includes('FROM organizational_scope.scope')).length,1);
});
