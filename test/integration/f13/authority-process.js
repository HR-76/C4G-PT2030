'use strict';
// Spawned only by the disposable authority gate. No credentials are printed.
const {Pool}=require('../../../backend/node_modules/pg');
const {createAuthorityCoordinator}=require('../../../backend/src/security/authorityCoordinator');
const {createPgSessionRegistry}=require('../../../backend/src/security/sessionRegistry');
const {createMembershipRepository}=require('../../../backend/src/security/membershipRepository');
const {createProductionCatalogs}=require('../../../backend/src/authorization/catalogs');
const {createTaxonomyRuntimeComposition}=require('../../../backend/src/organizationalProfile/taxonomyComposition');
const {createTaxonomyTelemetry}=require('../../../backend/src/organizationalProfile/taxonomyTelemetry');
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
const {runtimeFixture}=require('./runtime-fixture');
async function main(){
  if(process.env.F13_S2_DISPOSABLE_PROOF!=='C4G_F13_S2_DISPOSABLE_V1'||!process.send)throw new Error('DISPOSABLE_CHILD_REQUIRED');
  const input=JSON.parse(process.env.F13_AUTHORITY_CHILD),central=new Pool({connectionString:input.central,max:4}),tenant=new Pool({connectionString:input.tenant,max:2});
  let signal=false,enabled=false;
  const pool={async connect(){const client=await tenant.connect();return{release:error=>client.release(error),async query(sql,values){const result=await client.query(sql,values);
    if(enabled&&!signal&&((input.phase==='BEFORE_COMMIT'&&sql==='RESET ROLE')||(input.phase==='AFTER_COMMIT'&&sql==='COMMIT'))){signal=true;process.send('PREPARED');await new Promise(()=>{});}return result;}};}};
  const authorityPool=new Pool({connectionString:input.authority,max:4});
  const coordinator=createAuthorityCoordinator({pool:authorityPool,permitSecret:input.permitSecret});
  if(input.phase==='WRITER_BEFORE_APPLY'){
    await coordinator.write([coordinator.sessionKey(input.user.sid)],async()=>{
      process.send('PREPARED');await new Promise(()=>{});
    },Date.now()+1000);
    return;
  }
  const evidence=await preflightTenant(pool,{tenantId:input.organizationId,databaseGenerationId:input.generationId},manifest,{timeoutMs:10000});
  const fixture=await runtimeFixture({pool,evidence,sessions:{memberships:new Map()}});fixture.dependencies.membershipRepository=createMembershipRepository(central,coordinator);
  const store={get(sid,callback){coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[sid]).then(result=>callback(null,result.rows[0]?.sess),callback);}};
  const composition=createTaxonomyRuntimeComposition({sessionStore:store,sessionRegistry:createPgSessionRegistry(central,coordinator),authorityCoordinator:coordinator,
    authorizationCatalogs:createProductionCatalogs({catalogVersion:'f13'}),assurancePolicyVersion:'c4g-assurance-v1',authorityLeaseMs:1000,
    telemetry:createTaxonomyTelemetry({metrics:{record(){}}})});
  const bound=composition.bindTenant({pool,organizationId:input.organizationId,tenantId:input.organizationId,tenantCapabilityEvidence:evidence,
    tenantRuntimeDependencies:fixture.dependencies,authorizationAuditPort:{async accept(){return'ACCEPTED';}}});
  const handle=await bound.captureAuthenticatedRequest(input.user.request);enabled=true;await bound.service.createRelease(input.command,handle);
}
main().catch(error=>{process.stderr.write(`${error.code||error.message}\n`);process.exit(1);});
