'use strict';
const {uuid}=require('../platformOnboarding/contracts');
const {preflightTenant}=require('../security/tenantMigrationPreflight');
const {manifest}=require('../security/tenantMigrationManifest');
// Privileged administrative adapter. Not exposed to HTTP or constructed by default.
// Holds the same organization lock as profileEdit until the central source is committed.
async function migrateContacts({tenantPool,organizationId,databaseGenerationId,service,request}){
 uuid(organizationId);uuid(databaseGenerationId);
 await preflightTenant(tenantPool,{tenantId:organizationId,databaseGenerationId},manifest,{timeoutMs:15000});
 const c=await tenantPool.connect();
 try{
  await c.query('BEGIN');await c.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[organizationId]);
  const row=(await c.query('SELECT email,website,revision FROM organizational_scope.organization_card WHERE organization_id=$1 FOR UPDATE',[organizationId])).rows[0];
  const result=await service.adoptContacts(organizationId,{email:row?.email||'',website:row?.website||'',revision:Number(row?.revision||0)},request);
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
}
module.exports={migrateContacts};
