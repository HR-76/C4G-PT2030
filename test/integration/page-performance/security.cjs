'use strict';
const assert=require('node:assert/strict');
const {Client}=require('../../../backend/node_modules/pg');
const {policyVersion,requirement}=require('../http-oidc/fixture');
const defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),resolve:v=>resolve(v)};};
module.exports=async function verify({db,client,origin,check,report,metrics}){
 const tenant=client.tenant,route='/api/organizations/'+tenant.organizationId+'/dashboard/summary';
 report.securityRequests=[];
 async function get(expectedOrg=tenant.organizationId){
  const tag=require('node:crypto').randomUUID();
  const r=await client.context.request.get(origin+route,{headers:{'X-C4G-Organization':expectedOrg,'X-Contention-Request':tag},timeout:65000});
  const body=await r.json(),trace=metrics.take(tag);
  report.securityRequests.push({status:r.status(),code:body.error?.code||body.code,failures:trace?.failures});
  console.log('SECURITY_HTTP '+JSON.stringify(report.securityRequests.at(-1)));
  return {status:r.status(),body};
 }
 const initial=await get();assert.equal(initial.status,200);assert.equal(initial.body.report.total,1000);
 const crossed=await get('00000000-0000-4000-8000-000000000001');assert.notEqual(crossed.status,200);assert(!crossed.body.report);
 check('combined dashboard binds organization before publishing');
 const data=require('../../../backend/src/authorization/authorityDataRepository').createAuthorityDataRepository({coordinator:db.central.coordinator,catalogs:db.central.catalogs,policyVersion,recentMfaRequirement:requirement});
 let version=tenant.owner.version;
 async function grants(value){version=await data.change({organizationId:tenant.organizationId,membershipId:tenant.owner.membershipId,expectedVersion:version,grants:value,assuranceRequirements:requirement});}
 for(const permission of ['application.read','opportunity.read']){
  await grants(tenant.owner.grants.filter(g=>g.permission!==permission));
  try{const denied=await get();assert.notEqual(denied.status,200);assert(!denied.body.report);}
  finally{await grants(tenant.owner.grants);}
  check('combined dashboard refuses missing '+permission);
 }
 await grants(tenant.owner.grants.filter(g=>!['organization_directory.read','organizational_scope.read'].includes(g.permission)));
 try{const restricted=await get();assert.equal(restricted.status,200);assert.equal(restricted.body.report.unitsAvailable,false);assert.equal(restricted.body.unit_totals,null);assert.deepEqual(restricted.body.report.units,[]);}
 finally{await grants(tenant.owner.grants);}
 check('optional directory denial removes unit data');
 const original=Client.prototype.query;let failed=false;
 Client.prototype.query=function(...args){
  if(!failed&&this.connectionParameters.user===tenant.credentials.login&&String(args[0]).startsWith('SELECT * FROM audit.append_event_v1')){
   failed=true;return Promise.reject(Object.assign(Error('SYNTHETIC_AUDIT_FAILURE'),{code:'SYNTHETIC_AUDIT_FAILURE'}));
  }
  return original.apply(this,args);
 };
 try{const denied=await get();assert(failed);assert.equal(denied.status,503);assert(!denied.body.report);}
 finally{Client.prototype.query=original;}
 check('synchronous audit failure prevents combined dashboard publication');
 const entered=defer(),release=defer(),order=[];let held=false,reading,revoking,blockedClient,revocationCommitted=false;
 Client.prototype.query=function(...args){
  if(!held&&this.connectionParameters.user===tenant.credentials.login&&String(args[0]).startsWith('WITH catalog AS')&&args[1]?.[1]===tenant.organizationId){
   held=true;blockedClient=this;entered.resolve();return release.promise.then(()=>original.apply(this,args));
  }
  if(this===blockedClient&&args[0]==='COMMIT')return original.apply(this,args).then(value=>{order.push('tenantCommit');return value;});
  return original.apply(this,args);
 };
 try{
  reading=get();await Promise.race([entered.promise,reading.then(()=>{throw Error('DASHBOARD_NOT_HELD_AFTER_REPORT');})]);
  const memberships=require('../../../backend/src/security/membershipRepository').createMembershipRepository(db.central.pool,db.central.coordinator);
  revoking=memberships.changeStatus({membershipId:tenant.owner.membershipId,status:'SUSPENDED',reason:'Synthetic dashboard revocation'}).then(value=>{revocationCommitted=true;order.push('revocationCommit');return value;});revoking.catch(()=>{});
  let registered=false;const deadline=Date.now()+3000;
  while(Date.now()<deadline){
   registered=(await db.central.pool.query("SELECT EXISTS(SELECT 1 FROM public.authority_write_request WHERE state='WAITING' AND $1=ANY(scope_keys)) waiting",['MEMBER:'+tenant.owner.membershipId])).rows[0].waiting;
   if(registered)break;await new Promise(r=>setTimeout(r,25));
  }
  assert(registered,'revocation registers while the protected report has already been read');
  assert.equal(revocationCommitted,false,'the writer cannot commit across an active protected read');release.resolve();
  const result=await reading;await revoking;
  if(result.status===200){assert(order.includes('tenantCommit'));assert(order.indexOf('tenantCommit')<order.indexOf('revocationCommit'));}
  else assert(!result.body.report);
  report.dashboardRevocation={heldAfterReport:true,writerRegistered:true,status:result.status,commitOrder:order};
  const subsequent=await get();assert.notEqual(subsequent.status,200);assert(!subsequent.body.report);
  check('revocation waits for the protected dashboard commit and denies subsequent reads');
 }finally{release.resolve();Client.prototype.query=original;await Promise.allSettled([reading,revoking].filter(Boolean));}
};
