'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Client}=require('../../../backend/node_modules/pg');
const {policyVersion,requirement}=require('../http-oidc/fixture');
const defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),resolve:v=>resolve(v)}};
module.exports=async function verify({db,client,otherClient,origin,check,report,metrics}){
 let tenant=client.tenant,org=tenant.organizationId;
 let csrf=(await(await client.context.request.get(origin+'/api/auth/csrf')).json()).csrfToken;
 report.securityRequests=[];
 const ops={browse:{route:'/api/applications/browse-page',method:'get'},alerts:{route:'/api/notifications/refresh-list',method:'post'}};
 async function call(kind,{expectedOrg=org,route=ops[kind].route,body={},noCsrf=false}={}){
  const tag=randomUUID(),headers={'X-C4G-Organization':expectedOrg,'X-Contention-Request':tag,Origin:origin,...(!noCsrf?{'X-CSRF-Token':csrf}:{})};
  const response=await client.context.request[ops[kind].method](origin+route,{headers,...(ops[kind].method==='post'?{data:body}:{}),timeout:65000});
  const data=await response.json(),trace=metrics.take(tag);report.securityRequests.push({kind,status:response.status(),code:data.error?.code,failures:trace?.failures});
  console.log('SECURITY_HTTP '+JSON.stringify(report.securityRequests.at(-1)));return {status:response.status(),body:data};
 }
 const first=await call('browse');assert.equal(first.status,200);assert.equal(first.body.total,1000);assert.equal(first.body.items.length,25);assert(Array.isArray(first.body.units));
 const old=await call('browse',{route:'/api/applications/browse'});assert.equal(old.status,200);const {units,...same}=first.body;
 const comparable=value=>({...value,...Object.fromEntries(['nextCursor','previousCursor'].map(key=>{if(!value[key])return [key,null];const {exp,...binding}=JSON.parse(Buffer.from(value[key].split('.')[1],'base64url'));assert(Number.isSafeInteger(exp));return [key,binding]}))});
 assert.deepEqual(comparable(same),comparable(old.body));
 const options=await call('browse',{route:'/api/applications/units'});assert.deepEqual(units,options.body.items);
 const second=await call('browse',{route:ops.browse.route+'?cursor='+encodeURIComponent(first.body.nextCursor)});assert.equal(second.status,200);assert.equal(second.body.page,2);
 assert(second.body.items.every(row=>!first.body.items.some(old=>old.applicationId===row.applicationId)));
 const tampered=await call('browse',{route:ops.browse.route+'?cursor='+encodeURIComponent(first.body.nextCursor+'x')});assert.equal(tampered.status,400);assert(!tampered.body.items);
 const filtered=await call('browse',{route:ops.browse.route+'?status=PREPARATION&unitId=NONE'});assert.equal(filtered.status,200);assert.equal(filtered.body.total,2);
 check('combined browse matches existing list and units, preserves filters and rejects tampered cursors');
 const alerts=await call('alerts');assert.equal(alerts.status,200);assert.equal(alerts.body.total,8);assert(alerts.body.notifications.every(n=>n.message!=='Must never be published'));
 const repeated=await call('alerts');assert.equal(repeated.status,200);assert.deepEqual(repeated.body,alerts.body);
 const stored=await call('browse',{route:'/api/notifications'});assert.deepEqual(stored.body,alerts.body);
 const csrfDenied=await call('alerts',{noCsrf:true});assert.equal(csrfDenied.status,403);assert(!csrfDenied.body.notifications);
 check('combined refresh creates due alerts once, matches stored inbox, excludes other recipients and requires CSRF');
 for(const kind of Object.keys(ops)){const denied=await call(kind,{expectedOrg:randomUUID()});assert.notEqual(denied.status,200);assert(!denied.body.items&&!denied.body.notifications)}
 check('both combined operations refuse crossed organization headers');
 const data=require('../../../backend/src/authorization/authorityDataRepository').createAuthorityDataRepository({coordinator:db.central.coordinator,catalogs:db.central.catalogs,policyVersion,recentMfaRequirement:requirement});
 let version=tenant.owner.version;
 async function grants(value){version=await data.change({organizationId:org,membershipId:tenant.owner.membershipId,expectedVersion:version,grants:value,assuranceRequirements:requirement})}
 for(const [kind,permission] of [['browse','application.read'],['alerts','notification.read']]){
  await grants(tenant.owner.grants.filter(g=>g.permission!==permission));
  try{const denied=await call(kind);assert.notEqual(denied.status,200);assert(!denied.body.items&&!denied.body.notifications)}finally{await grants(tenant.owner.grants)}
  check(kind+' refuses missing '+permission);
 }
 for(const permission of ['application.read','opportunity.read']){
  await grants(tenant.owner.grants.filter(g=>g.permission!==permission));
  try{const hidden=await call('alerts');assert.equal(hidden.status,200);assert.equal(hidden.body.total,0);assert.deepEqual(hidden.body.notifications,[])}finally{await grants(tenant.owner.grants)}
  check('notification visibility freshly excludes inaccessible '+permission);
 }
 const original=Client.prototype.query;
 for(const kind of Object.keys(ops)){
  let failed=false;
  Client.prototype.query=function(...args){if(!failed&&this.connectionParameters.user===tenant.credentials.login&&String(args[0]).startsWith('SELECT * FROM audit.append_event_v1')){failed=true;return Promise.reject(Object.assign(Error('SYNTHETIC_AUDIT_FAILURE'),{code:'SYNTHETIC_AUDIT_FAILURE'}))}return original.apply(this,args)};
  try{const denied=await call(kind);assert(failed);assert.equal(denied.status,503);assert(!denied.body.items&&!denied.body.notifications)}finally{Client.prototype.query=original}
  check(kind+' withholds data on synchronous audit failure');
 }
 // A new deadline creates a new event key without deleting any history.
 await tenant.pool.query("UPDATE opportunity_catalog.opportunity SET closing_date=(clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date+7 WHERE organization_id=$1 AND opportunity_id=$2",[org,tenant.opportunityId]);
 const creationCounts=async()=>({alerts:Number((await tenant.pool.query("SELECT count(*) n FROM opportunity_catalog.application_alert WHERE organization_id=$1 AND type LIKE 'DEADLINE_%'",[org])).rows[0].n),audit:Number((await tenant.pool.query("SELECT count(*) n FROM audit.event WHERE organization_id=$1 AND event_code='APPLICATION_ALERT_CREATED'",[org])).rows[0].n)});
 const beforeCreation=await creationCounts();let failedCreation=false;
 Client.prototype.query=function(...args){if(!failedCreation&&this.connectionParameters.user===tenant.credentials.login&&String(args[0]).startsWith('SELECT * FROM audit.append_event_v1')&&args[1]?.[2]==='APPLICATION_ALERT_CREATED'){failedCreation=true;return Promise.reject(Object.assign(Error('SYNTHETIC_CREATION_AUDIT_FAILURE'),{code:'SYNTHETIC_CREATION_AUDIT_FAILURE'}))}return original.apply(this,args)};
 try{const denied=await call('alerts');assert(failedCreation);assert.equal(denied.status,503);assert(!denied.body.notifications)}finally{Client.prototype.query=original}
 assert.deepEqual(await creationCounts(),beforeCreation);check('creation audit failure rolls back newly inserted deadline alerts');
 for(const kind of Object.keys(ops)){
  const results=await Promise.all(Array.from({length:4},()=>call(kind)));
  assert(results.every(r=>r.status===200&&r.body.total===(kind==='browse'?1000:8)));
  report.concurrent ||= {};report.concurrent[kind]=results.map(r=>({status:r.status,total:r.body.total}));
  check('four concurrent '+kind+' operations return complete authorized results');
 }
 const afterCreation=await creationCounts();assert.deepEqual(afterCreation,{alerts:beforeCreation.alerts+2,audit:beforeCreation.audit+2});report.creation={before:beforeCreation,after:afterCreation};check('concurrent first generation creates exactly two events and two audit entries; stale deadlines remain hidden');
 const memberships=require('../../../backend/src/security/membershipRepository').createMembershipRepository(db.central.pool,db.central.coordinator);
 for(const kind of Object.keys(ops)){
  const entered=defer(),release=defer(),order=[];let held=false,reading,revoking,blockedClient,committed=false;
  Client.prototype.query=function(...args){const sql=String(args[0]);
   if(!held&&this.connectionParameters.user===tenant.credentials.login&&(kind==='browse'?sql.includes('SELECT s.scope_id'):sql.startsWith('SELECT n.alert_id'))){held=true;blockedClient=this;entered.resolve();return release.promise.then(()=>original.apply(this,args))}
   if(this===blockedClient&&args[0]==='COMMIT')return original.apply(this,args).then(r=>{order.push('tenantCommit');return r});return original.apply(this,args)};
  try{
   reading=call(kind);await Promise.race([entered.promise,reading.then(()=>{throw Error('PROTECTED_OPERATION_NOT_HELD')})]);
   revoking=memberships.changeStatus({membershipId:tenant.owner.membershipId,status:'SUSPENDED',reason:'Synthetic combined page revocation'}).then(value=>{committed=true;order.push('revocationCommit');return value});revoking.catch(()=>{});
   let registered=false;const deadline=Date.now()+3000;
   while(Date.now()<deadline){registered=(await db.central.pool.query("SELECT EXISTS(SELECT 1 FROM public.authority_write_request WHERE state='WAITING' AND $1=ANY(scope_keys)) waiting",['MEMBER:'+tenant.owner.membershipId])).rows[0].waiting;if(registered)break;await new Promise(r=>setTimeout(r,25))}
   assert(registered);assert.equal(committed,false);release.resolve();const result=await reading;await revoking;
   if(result.status===200){assert(order.includes('tenantCommit'));assert(order.indexOf('tenantCommit')<order.indexOf('revocationCommit'))}else assert(!result.body.items&&!result.body.notifications);
   const denied=await call(kind);assert.notEqual(denied.status,200);assert(!denied.body.items&&!denied.body.notifications);
   report.revocation ||= {};report.revocation[kind]={held:true,registered:true,status:result.status,commitOrder:order};
   check(kind+' preserves protected commit ordering and refuses reads after revocation');
  }finally{release.resolve();Client.prototype.query=original;await Promise.allSettled([reading,revoking].filter(Boolean))}
  if(kind==='browse'){client=otherClient;tenant=client.tenant;org=tenant.organizationId;csrf=(await(await client.context.request.get(origin+'/api/auth/csrf')).json()).csrfToken;}
 }
};
