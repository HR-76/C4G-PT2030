'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {randomUUID}=require('node:crypto');

function fixture({uncertain=false,refuseRecovery=false}={}){
 const filename=path.resolve(__dirname,'../src/opportunityInterests/composition.js'),nativeRequire=createRequire(filename);
 const org=randomUUID(),actor={id:randomUUID(),membershipId:randomUUID(),membershipVersion:1,organizationId:org};
 const state={leases:[],commands:[],reconciles:[],resolves:0,sql:[],guards:[],refuse:false};
 const handle={},context={actor,correlationId:randomUUID()};
 const coordinator={withAuthority:async fn=>fn(),registerRecovery(){},assert(){},complete:async()=>{},
  bindAuthority:()=>({protect:async(_client,args)=>{state.guards.push(args);if(state.refuse)throw Object.assign(Error(),{code:'NOT_AUTHORIZED'});return {token:'guard'};}}),
  reconcile:async token=>{state.reconciles.push(token);if(refuseRecovery)state.refuse=true;}};
 const client={query:async sql=>{state.sql.push(sql);return {rows:[]};}};
 const mocks={
  '../authorization/authorityDataRepository':{createAuthorityDataRepository:()=>({})},
  '../security/authenticatedAuthority':{createTaxonomySessionAuthority:()=>({captureAuthenticatedRequest:async()=>handle,resolve:async()=>{state.resolves++;return context;}})},
  '../authorization/resourceAuthorization':{createTaxonomyAuthorization:()=>({authorize:async()=>({allowed:true})})},
  '../security/tenantRuntime':{createTenantRuntime:({operationCatalog})=>({resolve:async args=>{
   const contract=operationCatalog.resolveAdapter(args.operationAdapter);state.leases.push(contract);
   return {execute:async input=>{const result=await args.operationAdapter.queryModule.execute({client,input});
    if(uncertain&&state.leases.length===1)throw Object.assign(Error(),{internalCode:'COMMIT_UNCERTAIN'});return result;}};
  }})},
  '../security/tenantLeaseExecutor':{preparedAuthorityBinding:()=>({transactionId:'tx'})},
  '../security/tenantAuthorityRecovery':{createTenantAuthorityRecovery:()=>({})},
  '../security/tenantRuntimeErrors':{tenantFailure:code=>Object.assign(Error(),{internalCode:code})},
  '../organizationalProfile/editorialUiAudit':{createEditorialUiAudit:()=>({accept:async()=>{}})},
  '../organizationalProfile/pq1UiTokens':{createPq1UiTokens:()=>({})},
  '../audit/appendService':{createAppendService:()=>({append:async()=>{}})},
  '../audit/event':{createAuditEvent:value=>value},
  '../audit/postgresAppendRepository':{PostgresAppendRepository:class{}},
  './repository':{createOpportunityInterestRepository:deps=>({register:async(_client,input)=>{
   await deps.protect({operationCode:'OPPORTUNITY_INTEREST_REGISTER',resource:{id:org}});
   state.commands.push(input);return {interestId:'same-result'};
  }})}
 };
 const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(name=>mocks[name]||nativeRequire(name),module,module.exports);
 const catalogs={operationCatalog:{resolve:code=>({effect:code.endsWith('_READ')?'READ':'WRITE'})},permissionCatalog:{}};
 const service=module.exports.createOpportunityInterestComposition({authorityCoordinator:coordinator,authorizationCatalogs:catalogs,tenantRuntimeDependencies:{}});
 const input={opportunityId:randomUUID(),centralRevisionId:randomUUID(),unitIds:[],idempotencyKey:randomUUID()};
 return {org,state,service,input};
}

test('composition rejects caller organization mismatch before tenant admission',async()=>{
 const f=fixture();await assert.rejects(f.service.execute('register',f.input,null,{headers:{'x-c4g-organization':randomUUID()}}),{code:'RESOURCE_NOT_AVAILABLE'});
 assert.equal(f.state.leases.length,0);assert.equal(f.state.commands.length,0);
});

test('commit uncertainty reconciles and reauthorizes the identical normalized intention',async()=>{
 const f=fixture({uncertain:true});const result=await f.service.execute('register',f.input,null,{headers:{'x-c4g-organization':f.org}});
 assert.equal(result.interestId,'same-result');assert.deepEqual(f.state.reconciles,['guard']);assert.equal(f.state.commands.length,2);
 assert.deepEqual(f.state.commands[0],f.state.commands[1]);assert.equal(f.state.guards.length,2);assert(f.state.resolves>=4);
 for(const contract of f.state.leases){assert.deepEqual(contract.compatibleSchemaVersions,['033_organizational_opportunity_interests','034_application_snapshot_v2']);assert(contract.requiredCapabilities.includes('ORGANIZATIONAL_OPPORTUNITY_INTERESTS'));}
 assert(f.state.sql.every(sql=>!sql.includes('public.organization_membership')));
});

test('revoked write authority after uncertainty stops recovery before a second mutation',async()=>{
 const f=fixture({uncertain:true,refuseRecovery:true});
 await assert.rejects(f.service.execute('register',f.input,null,{headers:{'x-c4g-organization':f.org}}),{code:'NOT_AUTHORIZED'});
 assert.equal(f.state.commands.length,1);assert.equal(f.state.guards.length,2);
});
