'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createAuthorityCoordinator}=require('../src/security/authorityCoordinator');
const {createRegistrationService}=require('../src/entityAdmission/registrationService');
const fields={nif:'500000000',acronym:'C4G',address:'Rua da Escola',addressComplement:'',postalCode:'1000-001',locality:'Lisboa',institutionalEmail:'geral@example.org',institutionalPhone:'+351210000000',website:'https://example.org',responsibleName:'Ana Responsável',responsibleEmail:'ana@example.org',responsiblePhone:'+351910000000',responsibleJobTitle:'Diretora',workerCount:12,workerReferenceDate:'2026-09-30'};
function fixture(t){
 for(const name of ['assertAuthorityAdmission','assertAuthoritySecurity'])t.mock.method(require('../src/security/authoritySecurityManifest'),name,async()=>{});
 t.mock.method(require('../src/security/authorityProtocolQueries'),'execute',(client,sql,values)=>client.query(sql,values));
 const registrations=new Map(),receipts=new Map(),membershipId=randomUUID();let admin=true,selectedOrganization=null;
 const central={release(){},async query(sql,values=[]){
  const normalized=String(sql).replace(/\s+/g,' ').trim();
  if(normalized.includes('c4g_database_identity'))return {rows:[{valid:true}]};
  if(normalized.startsWith('SELECT state,deadline FROM public.authority_write_request'))return {rows:[{state:'WAITING',deadline:new Date(Date.now()+10000)}]};
  if(normalized.includes("FROM public.authority_write_request")&&normalized.includes("epoch<"))return {rows:[]};
  if(normalized.includes("FROM public.authority_commit_guard")&&normalized.includes("state IN"))return {rows:[]};
  if(normalized.startsWith('SELECT u.id FROM public.application_session'))return {rows:admin?[{id:values[1]}]:[]};
  if(normalized.startsWith('SELECT s.selected_organization_id'))return {rows:selectedOrganization?[{selected_organization_id:selectedOrganization,selected_membership_id:membershipId,selected_membership_version:1}]:[]};
  if(normalized.startsWith("SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE'"))return {rows:[{id:values[0]}]};
  if(normalized.startsWith('SELECT * FROM public.organization_registration_receipt'))return {rows:[receipts.get(`${values[0]}:${values[1]}`)].filter(Boolean)};
  if(normalized.startsWith('SELECT * FROM public.organization_registration WHERE organization_id'))return {rows:[registrations.get(values[0])].filter(Boolean)};
  if(normalized.startsWith("SELECT organization_id FROM public.organization_registration WHERE fields->>'nif'"))return {rows:[...registrations.values()].filter(row=>row.fields.nif===values[0]).slice(0,1).map(row=>({organization_id:row.organization_id}))};
  if(normalized.startsWith('INSERT INTO public.organization_registration(')){
   const row={organization_id:values[0],fields:JSON.parse(values[1]),source_revision:values[2],source_digest:values[3],revision:0,updated_at:'2026-10-21T00:00:00.000Z'};registrations.set(values[0],row);return {rows:[row]};
  }
  if(normalized.startsWith('UPDATE public.organization_registration SET fields=')){
   const old=registrations.get(values[0]);if(!old||old.revision!==values[2])return {rows:[]};const row={...old,fields:{...old.fields,...JSON.parse(values[1])},revision:old.revision+1,updated_at:'2026-10-21T00:00:01.000Z'};registrations.set(values[0],row);return {rows:[row]};
  }
  if(normalized.startsWith('INSERT INTO public.organization_registration_receipt')){receipts.set(`${values[0]}:${values[1]}`,{organization_id:values[0],request_key:values[1],actor_id:values[2],intent_digest:values[3],result:JSON.parse(values[4])});return {rows:[]};}
  return {rows:[],rowCount:0};
 }};
 const coordinator=createAuthorityCoordinator({pool:{connect:async()=>central,query:(...args)=>central.query(...args)},permitSecret:'synthetic-entity-profile-permit-secret'});
 const service=createRegistrationService({coordinator,organizationReader:async id=>({id,legalName:'Entidade Exemplo, Lda.',name:'Entidade Exemplo',typeCode:'COMPANY',status:'ACTIVE',currency:'EUR'}),audit:async()=>{}});
 const actor=randomUUID(),request={user:{id:actor},sessionID:'session',authContext:{sessionId:'session'}};
 return {service,request,registrations,receipts,setAdmin:value=>{admin=value},selectOrganization:value=>{selectedOrganization=value},trusted:organizationId=>({actor:{id:actor,organizationId,membershipId,membershipVersion:1}})};
}
test('canonical service initializes, edits and replays an existing entity profile',async t=>{
 const f=fixture(t),organizationId=randomUUID(),requestId=randomUUID(),command={expectedRevision:0,requestId,fields};
 const created=await f.service.saveForPlatform(organizationId,command,f.request);assert.equal(created.revision,0);assert.equal(created.complete,true);assert.equal(created.fields.legalName,'Entidade Exemplo, Lda.');
 assert.deepEqual(await f.service.saveForPlatform(organizationId,command,f.request),created);assert.equal(f.registrations.size,1);assert.equal(f.receipts.size,1);
 const edited=await f.service.saveForPlatform(organizationId,{expectedRevision:0,requestId:randomUUID(),fields:{...fields,website:'',responsibleJobTitle:''}},f.request);assert.equal(edited.revision,1);assert.equal(edited.fields.website,'');assert.equal(edited.fields.responsibleJobTitle,'');
 await assert.rejects(()=>f.service.saveForPlatform(organizationId,{expectedRevision:0,requestId:randomUUID(),fields},f.request),error=>error.code==='ONBOARDING_STALE');
 await assert.rejects(()=>f.service.saveForPlatform(organizationId,{expectedRevision:1,requestId:randomUUID(),fields:{...fields,nif:'501964843'}},f.request),error=>error.code==='FISCAL_IDENTITY_LOCKED');
});
test('canonical service refuses non-admin and duplicate fiscal identity without disclosing its owner',async t=>{
 const f=fixture(t),first=randomUUID(),second=randomUUID();await f.service.saveForPlatform(first,{expectedRevision:0,requestId:randomUUID(),fields},f.request);
 await assert.rejects(()=>f.service.saveForPlatform(second,{expectedRevision:0,requestId:randomUUID(),fields},f.request),error=>error.code==='FISCAL_IDENTITY_REVIEW_REQUIRED');
 f.setAdmin(false);await assert.rejects(()=>f.service.saveForPlatform(first,{expectedRevision:0,requestId:randomUUID(),fields},f.request),error=>error.code==='C4G_ADMIN_REQUIRED');
});
test('entity write requires the live selected membership and the edit permission decision',async t=>{
 const f=fixture(t),organizationId=randomUUID();f.selectOrganization(organizationId);const trusted=f.trusted(organizationId),command={expectedRevision:0,requestId:randomUUID(),fields};
 await assert.rejects(()=>f.service.saveForEntity(organizationId,command,f.request,trusted,async()=>false),error=>error.code==='NOT_AUTHORIZED');
 const saved=await f.service.saveForEntity(organizationId,{...command,requestId:randomUUID()},f.request,trusted,async()=>true);assert.equal(saved.complete,true);
 await assert.rejects(()=>f.service.saveForEntity(organizationId,{expectedRevision:0,requestId:randomUUID(),fields},f.request,{actor:{...trusted.actor,organizationId:randomUUID()}},async()=>true),error=>error.code==='NOT_AUTHORIZED');
 f.selectOrganization(null);await assert.rejects(()=>f.service.saveForEntity(organizationId,{expectedRevision:0,requestId:randomUUID(),fields},f.request,trusted,async()=>true),error=>error.code==='NOT_AUTHORIZED');
});
