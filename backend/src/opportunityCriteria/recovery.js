'use strict';
const {createPolicyEngine}=require('../authorization/policyEngine');
const {snapshotDigest}=require('../security/tenantAuthorityRecovery');
const {fail,projectReceipt}=require('./contracts');
// The existing recovery observation is read-only and cannot wait on the source
// transaction's audit stream. No second write guard or caller-selected pool.
async function lookup({s,authority,data,catalogs,coordinator,deps,clock,policyVersion,recentMfaRequirement}){
 const org=s.context.actor.organizationId,operation=s.input.operation==='SAVE_REVISION'?'CRITERIA_SAVE':'CRITERIA_CONFIRM';
 const outcome=(status,receipt=null)=>({status,receipt,reason:status==='UNKNOWN'?'NO_CONCLUSIVE_EVIDENCE':status==='RESOLVING'?'TRANSACTION_PENDING':status==='FAILED_FINAL'?'ROLLED_BACK':null,retryAfterSeconds:status==='RESOLVING'?5:null,correlationId:s.context.correlationId});
 const policy=createPolicyEngine({permissionCatalog:catalogs.permissionCatalog,profileCatalog:catalogs.profileCatalog,assurancePolicyVersion:policyVersion,recentMfaRequirement});
 async function authorize(){const context=await authority.resolve(s.handle),snapshot=await data.authorizationDataPort.load(context.actor),membership=await data.membershipPort.revalidate(context.actor);
  for(const [code,type]of [['OPPORTUNITY_READ','OPPORTUNITY'],['OPPORTUNITY_CRITERIA_READ','OPPORTUNITY_CRITERIA_SET']]){
   const resource={id:s.id,organizationId:org,resourceType:type,status:'ACTIVE',scopeType:'RESOURCE',scopeId:s.id,unitId:null,ancestorUnitIds:[],teamIds:[],distinctFromActorIds:[]};
   if(!snapshot||!membership||!policy.evaluate({actor:context.actor,membership,snapshot:{...snapshot,grants:snapshot.grants.filter(g=>(!g.resourceId||g.resourceId===s.id)&&(!g.resourceType||g.resourceType===type))},resource,operation:catalogs.operationCatalog.resolve(code),assuranceEvidence:context.assuranceEvidence,now:clock.now(),exactResourceScope:false}).allowed)fail('NOT_AUTHORIZED');
  }
 }
 let allocation,secret,open=false;
 try{
  await authorize();const physical=await deps.directoryRepository.resolveSnapshotByOrganization(org,'API');if(!physical)return outcome('UNKNOWN');
  secret=await deps.credentialProvider.resolve({credentialRef:physical.credentialRef,tenantId:org,workload:'API',connectionVersion:physical.connectionVersion,correlationId:s.context.correlationId});
  const credentialLease=secret;secret=null;allocation=await deps.poolManager.acquire({tenantId:org,workload:'API',connectionVersion:physical.connectionVersion,workloadClass:'OPERATIONAL',credentialLease,correlationId:s.context.correlationId});
  const client=allocation.client;await client.query('BEGIN TRANSACTION READ ONLY');open=true;await client.query("SET LOCAL statement_timeout TO '2000ms'");
  await deps.bindingVerifier.verify({client,snapshot:physical,requiredCapabilities:['OPPORTUNITY_EVIDENCED_CRITERIA','F7_AUDIT_LEDGER'],correlationId:s.context.correlationId});
  await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);
  const available=(await client.query('SELECT opportunity_id FROM opportunity_catalog.opportunity WHERE organization_id=$1 AND opportunity_id=$2',[org,s.id])).rows[0];if(!available)fail('RESOURCE_NOT_AVAILABLE');
  if(operation==='CRITERIA_SAVE'&&s.input.resourceId!==s.id)return outcome('UNKNOWN');
  if(operation==='CRITERIA_CONFIRM'&&!(await client.query('SELECT r.revision_id FROM opportunity_catalog.criteria_revision r JOIN opportunity_catalog.criteria_set c USING(organization_id,set_id) WHERE r.organization_id=$1 AND r.revision_id=$2 AND c.opportunity_id=$3',[org,s.input.resourceId,s.id])).rows.length)return outcome('UNKNOWN');
  const guards=(await coordinator.pool.query(require('../security/authorityProtocolQueries').criteriaLookupQuery,[org,s.context.actor.id,s.input.requestId,operation,s.input.resourceId])).rows;
  if(!guards.length||guards.length>100||new Set(guards.map(g=>g.intention_digest)).size!==1||guards.some(g=>g.source_binding.snapshotDigest!==snapshotDigest(physical)))return outcome('UNKNOWN');
  for(let i=0;i<guards.length;i++)if(['PREPARED','TENANT_COMMIT_UNKNOWN'].includes(guards[i].state)){
   if(new Date(guards[i].deadline)>clock.now()){await authorize();return outcome('RESOLVING');}
   try{guards[i]=await coordinator.recover(guards[i].guard_id,false,Date.now()+2000);}catch{return outcome('UNKNOWN');}
  }
  const row=(await client.query('SELECT intention_digest,result_projection FROM opportunity_catalog.criteria_receipt WHERE organization_id=$1 AND subject_id=$2 AND operation=$3 AND request_id=$4 AND resource_id=$5',[org,s.context.actor.id,operation,s.input.requestId,s.input.resourceId])).rows[0];
  await authorize();
  if(row&&row.intention_digest===guards[0].intention_digest&&guards.some(g=>g.state==='TENANT_COMMITTED'||g.reconciliation_result==='COMMITTED'))return outcome('CONFIRMED',projectReceipt(row.result_projection));
  // A unique digest bound to this subject, resource and request plus terminal
  // rollback proves failure. An absent receipt alone remains UNKNOWN.
  if(!row&&guards.every(g=>g.state==='ABORTED'||g.reconciliation_result==='ROLLED_BACK'))return outcome('FAILED_FINAL');
  return outcome('UNKNOWN');
 }catch(e){if(['NOT_AUTHORIZED','RESOURCE_NOT_AVAILABLE'].includes(e.code))throw e;if(['AUTHORITY_REQUIRED','AUTHORITY_STALE'].includes(e.code))fail('NOT_AUTHORIZED');return outcome('UNKNOWN');}
 finally{if(allocation){if(open)await allocation.client.query('ROLLBACK').catch(()=>{});await allocation.release({discard:true}).catch(()=>{});}if(secret)await secret.dispose();}
}
module.exports={lookup};
