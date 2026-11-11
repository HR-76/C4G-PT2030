'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Client}=require('../../../backend/node_modules/pg');
const {policyVersion,requirement}=require('../http-oidc/fixture');
const defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),resolve:()=>resolve()}};
module.exports=async function verify({db,client,otherClient,origin,check,report,metrics}){
 let tenant=client.tenant,org=tenant.organizationId;
 const routes={profile:'/api/organization-directory',browse:'/api/applications/browse-page'};report.securityRequests=[];
 async function call(kind,{baseline=false,expectedOrg=org,query=''}={}){
  const tag=randomUUID(),response=await client.context.request.get(origin+routes[kind]+query,{headers:{'X-C4G-Organization':expectedOrg,'X-Contention-Request':tag,...(baseline?{'X-Profile-Baseline':'1'}:{})},timeout:65000});
  const body=await response.json(),trace=metrics.take(tag);report.securityRequests.push({kind,baseline,status:response.status(),code:body.error?.code,failures:trace?.failures});console.log('SECURITY_HTTP '+JSON.stringify(report.securityRequests.at(-1)));return {status:response.status(),body};
 }
 const original=Client.prototype.query;
 async function auditedProfile(baseline){const events=[];
  Client.prototype.query=function(...args){if(this.connectionParameters.user===tenant.credentials.login&&String(args[0]).startsWith('SELECT * FROM audit.append_event_v1')){const e=JSON.parse(args[1].at(-1));events.push({code:args[1][2],resource:e.resource,decision:e.decision,outcome:e.outcome,payload:e.payload})}return original.apply(this,args)};
  try{return {response:await call('profile',{baseline}),events}}finally{Client.prototype.query=original}
 }
 const a=await auditedProfile(true),b=await auditedProfile(false);assert.equal(a.response.status,200);assert.equal(b.response.status,200);assert.deepEqual(b.response.body,a.response.body);assert.deepEqual(b.events,a.events);assert.equal(b.events.length,6);report.profileAudit={baselineEvents:a.events.length,currentEvents:b.events.length,equal:true};
 assert.deepEqual(b.response.body.permissions,{edit:true,units:true,createUnit:false,renameUnit:false,moveUnit:false});check('profile payload and all six ordered audit decisions match the frozen baseline');
 const comparable=value=>({...value,...Object.fromEntries(['nextCursor','previousCursor'].map(key=>{if(!value[key])return [key,null];const {exp,...binding}=JSON.parse(Buffer.from(value[key].split('.')[1],'base64url'));assert(Number.isSafeInteger(exp));return [key,binding]}))});
 const browse=await call('browse'),old=await call('browse',{baseline:true});assert.equal(browse.status,200);assert.equal(old.status,200);assert.equal(browse.body.total,1000);assert.deepEqual(comparable(browse.body),comparable(old.body));
 const next=await call('browse',{query:'?cursor='+encodeURIComponent(browse.body.nextCursor)});assert.equal(next.status,200);assert.equal(next.body.page,2);
 const bad=await call('browse',{query:'?cursor='+encodeURIComponent(browse.body.nextCursor+'x')});assert.equal(bad.status,400);check('shared projection snapshot preserves browse payload, filters and signed pagination');
 for(const kind of Object.keys(routes)){const cross=await call(kind,{expectedOrg:randomUUID()});assert.notEqual(cross.status,200);assert(!cross.body.profile&&!cross.body.items)}check('profile and browse refuse crossed organizations');
 const data=require('../../../backend/src/authorization/authorityDataRepository').createAuthorityDataRepository({coordinator:db.central.coordinator,catalogs:db.central.catalogs,policyVersion,recentMfaRequirement:requirement});let version=tenant.owner.version;
 async function grants(value){version=await data.change({organizationId:org,membershipId:tenant.owner.membershipId,expectedVersion:version,grants:value,assuranceRequirements:requirement})}
 const extra=['ORGANIZATIONAL_SCOPE_CREATE','ORGANIZATIONAL_SCOPE_RENAME','ORGANIZATIONAL_SCOPE_REPARENT'].map(code=>({permission:db.central.catalogs.operationCatalog.resolve(code).permission,scope:{type:'ORGANIZATION',id:org,organizationId:org}}));
 tenant.owner.grants=[...tenant.owner.grants,...extra];await grants(tenant.owner.grants);
 const fullBefore=await auditedProfile(true),fullAfter=await auditedProfile(false);assert.equal(fullAfter.response.status,200);assert.deepEqual(fullAfter.response.body,fullBefore.response.body);assert(Object.values(fullAfter.response.body.permissions).every(Boolean));assert.deepEqual(fullAfter.events,fullBefore.events);assert.equal(fullAfter.events.length,6);report.profileAudit.fullPermissionEvents=6;check('profile preserves payload and ordered audit for both restricted and fully granted capabilities');
 for(const [key,code] of [['edit','ORGANIZATION_DIRECTORY_EDIT'],['units','ORGANIZATIONAL_SCOPE_READ'],['createUnit','ORGANIZATIONAL_SCOPE_CREATE'],['renameUnit','ORGANIZATIONAL_SCOPE_RENAME'],['moveUnit','ORGANIZATIONAL_SCOPE_REPARENT']]){
  const permission=db.central.catalogs.operationCatalog.resolve(code).permission;
  await grants(tenant.owner.grants.filter(g=>g.permission!==permission));
  try{const current=await call('profile'),before=await call('profile',{baseline:true});assert.equal(current.status,200);assert.equal(before.status,200);assert.equal(current.body.permissions[key],false);assert.deepEqual(current.body,before.body)}finally{await grants(tenant.owner.grants)}
  check('profile preserves the exact denied capability '+key);
 }
 for(const [kind,permission] of [['profile','organization_directory.read'],['browse','application.read']]){
  await grants(tenant.owner.grants.filter(g=>g.permission!==permission));try{const denied=await call(kind);assert.notEqual(denied.status,200);assert(!denied.body.profile&&!denied.body.items)}finally{await grants(tenant.owner.grants)}check(kind+' refuses missing primary permission');
 }
 await grants(tenant.owner.grants.filter(g=>g.permission!=='application.transition'));
 try{const current=await call('browse');assert.equal(current.status,200);assert(current.body.items.every(r=>r.allowedTransitions.length===0));const before=await call('browse',{baseline:true});assert.deepEqual(comparable(current.body),comparable(before.body))}finally{await grants(tenant.owner.grants)}check('transition capabilities are freshly denied without changing visible records');
 for(const kind of Object.keys(routes)){
  let failed=false;Client.prototype.query=function(...args){if(!failed&&this.connectionParameters.user===tenant.credentials.login&&String(args[0]).startsWith('SELECT * FROM audit.append_event_v1')){failed=true;return Promise.reject(Object.assign(Error('SYNTHETIC_AUDIT_FAILURE'),{code:'SYNTHETIC_AUDIT_FAILURE'}))}return original.apply(this,args)};
  try{const denied=await call(kind);assert(failed);assert.equal(denied.status,503);assert(!denied.body.profile&&!denied.body.items)}finally{Client.prototype.query=original}check(kind+' refuses publication on synchronous audit failure');
 }
 for(const kind of Object.keys(routes)){
  const results=await Promise.all(Array.from({length:4},()=>call(kind)));assert(results.every(r=>r.status===200&&(kind==='profile'?r.body.organization.id===org:r.body.total===1000)));report.concurrent ||= {};report.concurrent[kind]=results.map(r=>({status:r.status,...(kind==='browse'?{total:r.body.total}:{complete:!!r.body.profile})}));check('four concurrent '+kind+' requests complete successfully');
 }
 const memberships=require('../../../backend/src/security/membershipRepository').createMembershipRepository(db.central.pool,db.central.coordinator);
 for(const kind of Object.keys(routes)){
  const entered=defer(),release=defer(),order=[];let held=false,reading,revoking,blocked,committed=false;
  Client.prototype.query=function(...args){const sql=String(args[0]);if(!held&&this.connectionParameters.user===tenant.credentials.login&&(kind==='profile'?sql.startsWith('SELECT * FROM audit.prepare_append_v1'):sql.includes('SELECT s.scope_id'))){held=true;blocked=this;entered.resolve();return release.promise.then(()=>original.apply(this,args))}if(this===blocked&&args[0]==='COMMIT')return original.apply(this,args).then(r=>{order.push('tenantCommit');return r});return original.apply(this,args)};
  try{reading=call(kind);await Promise.race([entered.promise,reading.then(()=>{throw Error('PROTECTED_OPERATION_NOT_HELD')})]);
   revoking=memberships.changeStatus({membershipId:tenant.owner.membershipId,status:'SUSPENDED',reason:'Synthetic profile performance revocation'}).then(r=>{committed=true;order.push('revocationCommit');return r});revoking.catch(()=>{});
   let registered=false;const deadline=Date.now()+3000;while(Date.now()<deadline){registered=(await db.central.pool.query("SELECT EXISTS(SELECT 1 FROM public.authority_write_request WHERE state='WAITING' AND $1=ANY(scope_keys)) waiting",['MEMBER:'+tenant.owner.membershipId])).rows[0].waiting;if(registered)break;await new Promise(r=>setTimeout(r,25))}
   assert(registered);assert.equal(committed,false);release.resolve();const result=await reading;await revoking;if(result.status===200){assert(order.includes('tenantCommit'));assert(order.indexOf('tenantCommit')<order.indexOf('revocationCommit'))}else assert(!result.body.profile&&!result.body.items);
   const denied=await call(kind);assert.notEqual(denied.status,200);assert(!denied.body.profile&&!denied.body.items);report.revocation ||= {};report.revocation[kind]={held:true,registered:true,status:result.status,commitOrder:order};check(kind+' commits its protected result before revocation and refuses subsequent requests');
  }finally{release.resolve();Client.prototype.query=original;await Promise.allSettled([reading,revoking].filter(Boolean))}
  if(kind==='profile'){client=otherClient;tenant=client.tenant;org=tenant.organizationId}
 }
};
