 'use strict';
const {createDurableExposureControl}=require('./pgPolicyStore');
const {createRehearsalMonitor}=require('./rehearsalMonitor');
const {fail}=require('./readErrors');
const capabilities=new WeakSet(),claimed=new WeakSet();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function createAdminOnlyRehearsalControl({isolated,controlledAdmission,organizationId,userId,store,sink,clock=()=>Date.now()}){
 if((isolated!==true&&!require('./controlledTarget').matchesAdmin(controlledAdmission,{organizationId,userId}))||!uuid.test(organizationId)||!uuid.test(userId)||store?.durable!==true)throw Error('EXPLICIT_ADMIN_REHEARSAL_REQUIRED');
 const monitor=createRehearsalMonitor({sink,clock});monitor.heartbeat();
 function validatePolicy(p){
  if(p?.mode==='OFF'){if(p.organizations?.length||p.roles?.length||p.expiresAt!==null)throw Error('ADMIN_REHEARSAL_POLICY_INVALID');return;}
  if(p?.mode!=='COHORT'||p.organizations?.length!==1||p.organizations[0]!==organizationId||p.roles?.length!==1||p.roles[0]!=='ORG_ADMIN')throw Error('ADMIN_REHEARSAL_COHORT_MISMATCH');
 }
 const boundStore={durable:true,async read(){const p=await store.read();validatePolicy(p);return p;},compareAndSet:store.compareAndSet};
 const control=createDurableExposureControl({store:boundStore,clock,healthy:monitor.healthy});
 const keys=(value,allowed)=>{if(!value||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('ADMIN_REHEARSAL_SCOPE_FIXED');};
 const operator=Object.freeze({
  async enable(args){keys(args,['expectedRevision','leaseMs']);if(monitor.snapshot().alerts.length)throw Error('CONTROL_MONITOR_NOT_READY');const p=await control.operator.enable({...args,organizations:[organizationId],roles:['ORG_ADMIN']});monitor.control('enable',p);return p;},
  async disable(args){keys(args,['expectedRevision']);const p=await control.operator.disable(args);monitor.control('disable',p);return p;},
  async withdraw(args){keys(args,['expectedRevision','generationId']);const p=await control.operator.withdraw(args);monitor.control('withdraw',p);return p;},
  async resume(args){keys(args,['expectedRevision']);if(monitor.snapshot().alerts.length)throw Error('CONTROL_MONITOR_NOT_READY');return control.operator.resume(args);},
  status:control.operator.status
 });
 const reader=Object.freeze({begin(a){if(a?.organizationId!==organizationId||a.baseRoleCode!=='ORG_ADMIN')fail('ACCESS_DENIED');return control.reader.begin(a);},check(t,a,g){if(a?.organizationId!==organizationId||a.baseRoleCode!=='ORG_ADMIN')fail('ACCESS_DENIED');return control.reader.check(t,a,g);}});
 const result=Object.freeze({reader,operator,monitor,validatePolicy,matchesPrincipal:principal=>principal?.user?.id===userId});capabilities.add(result);return result;
}
function claimAdminOnlyRehearsalControl(value){if(!capabilities.has(value)||claimed.has(value))throw Error('FRESH_ADMIN_REHEARSAL_CONTROL_REQUIRED');claimed.add(value);return value;}
module.exports={createAdminOnlyRehearsalControl,claimAdminOnlyRehearsalControl};
