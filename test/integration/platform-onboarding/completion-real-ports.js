'use strict';
const assert=require('node:assert/strict'),{Pool}=require('../../../backend/node_modules/pg');
function create({call,startWorker,publish}){
 let tenantLost=true,projectionLost=true,activationAuditFailure=true;const append=require('../../../backend/src/platformOnboarding/audit').createOnboardingAudit();
 return {
  onFailure:e=>console.log('COMPLETION_FAILURE '+JSON.stringify(e)),
  tenant:{async ensure(x){const r=await call('tenant',x);if(tenantLost){tenantLost=false;await startWorker();throw Error('LOST_TENANT_REPLY')}return r}},
  projection:{async ensure(x){const r=await call('projection',x);if(projectionLost){projectionLost=false;await startWorker();throw Error('LOST_PROJECTION_REPLY')}return r}},
  async publishCredentials(x){const api=await call('apiCredentials',x),worker=await call('workerCredentials',x);for(const credential of [api,worker]){const pool=new Pool({host:credential.host,port:credential.port,database:credential.database,user:credential.login,password:credential.password,max:1});try{const r=(await pool.query('SELECT current_database() name,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=session_user')).rows[0];assert.equal(r.name,credential.database);assert.equal(credential.tenantId,x.organizationId);assert(!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolbypassrls)}finally{await pool.end()}}publish(api);return {operationId:x.operationId,organizationId:x.organizationId,globalUserId:x.globalUserId,membershipId:x.membershipId,published:true};},
  async audit(c,e){if(e.eventCode==='PLATFORM_ADMISSION_COMPLETED'&&activationAuditFailure){activationAuditFailure=false;throw Error('ACTIVATION_AUDIT_UNAVAILABLE')}return append(c,e)}
 };
}
module.exports={create};
