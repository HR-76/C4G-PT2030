'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const secret=()=>randomBytes(32).toString('hex');
const requirement={mfa:false,maxAgeSeconds:300,acceptedAcr:['c4g-loa1'],acceptedAmr:['pwd'],amrMode:'any'};
const policyVersion='c4g-user-mfa-v1';
async function keycloak(origin){
 const base=process.env.HTTP_PROOF_KEYCLOAK;
 assert.equal(new URL(base).hostname,'localhost');
 for(let i=0;;i++){
  try{if((await fetch(base+'/realms/master/.well-known/openid-configuration',{signal:AbortSignal.timeout(2000)})).ok)break;}catch{}
  if(i>=120)throw Error('KEYCLOAK_NOT_READY');
  await new Promise(r=>setTimeout(r,1000));
 }
 const login=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'proof-admin',password:process.env.KC_BOOTSTRAP_ADMIN_PASSWORD}),signal:AbortSignal.timeout(15000)});
 assert.equal(login.status,200,'Keycloak bootstrap login');
 const token=(await login.json()).access_token,realm='c4g-http-proof',clientId='http-proof';
 const admin=async(p,method='GET',body)=>{
  const r=await fetch(base+'/admin/realms'+p,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert(r.ok,'Keycloak configuration '+r.status);
  const text=await r.text();return text?JSON.parse(text):null;
 };
 await admin('','POST',{realm,enabled:true,sslRequired:'all',registrationAllowed:false,attributes:{'acr.loa.map':JSON.stringify({'c4g-loa1':1,'c4g-loa2':2})}});
 const kc=(p,m,b)=>admin('/'+realm+'/'+p,m,b);
 const flow=await require('../../../backend/scripts/localPlatform/identityFlow').configureOptionalFlow(kc,{installationId:randomUUID()},clientId);
 await kc('clients','POST',{clientId,enabled:true,publicClient:true,protocol:'openid-connect',standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:[origin+'/api/auth/oidc/callback'],webOrigins:[origin],attributes:{'pkce.code.challenge.method':'S256','default.acr.values':'c4g-loa1','minimum.acr.value':'c4g-loa1'},authenticationFlowBindingOverrides:{browser:flow},protocolMappers:[{name:'amr',protocol:'openid-connect',protocolMapper:'oidc-amr-mapper',config:{'id.token.claim':'true','access.token.claim':'true'}}]});
 return {issuer:base+'/realms/'+realm,clientId,async user(username){
  const password=secret()+'aZ9!';
  await kc('users','POST',{username,firstName:'Synthetic',lastName:'HTTP',email:username+'@example.invalid',enabled:true,emailVerified:true,credentials:[{type:'password',value:password,temporary:false}]});
  return {username,password,subject:(await kc('users?username='+username+'&exact=true'))[0].id};
 }};
}
async function databaseFixture(report){
 const source=new URL(process.env.HTTP_PROOF_ADMIN_URL);
 assert.equal(source.hostname,'127.0.0.1');assert.equal(source.pathname,'/postgres');assert(!['5432','5433'].includes(source.port));
 assert.match(process.env.HTTP_PROOF_RUN||'',/^[a-f0-9]{32}$/);
 const admin=new Pool({connectionString:source.toString(),max:2});
 let central,reader,runtime;
 const tenantPools=[];
 try{
  central=await require('../f13/central-authority-fixture').centralAuthorityFixture(source.toString(),{validateHistoricalRoundTrip:false});
  report.postgres=(await admin.query('SELECT version() AS version')).rows[0].version;
  report.centralMigration=require('../../../backend/src/security/centralMigrationManifest').manifest.at(-1).version;
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO proof_admin');
  const connection={host:source.hostname,port:Number(source.port),user:source.username,password:decodeURIComponent(source.password)};
  const reservations=new Map();
  const provisioner=require('../../../backend/src/platformOnboarding/postgresProvisioner').createPostgresProvisioner({adminPool:admin,centralPool:central.pool,connection,ownershipKey:secret(),journal:{async reserve(id,input,create){if(!reservations.has(id))reservations.set(id,create());return reservations.get(id);}},regionCode:'EU',residencyPolicyVersion:'http-proof-v1'});
  const data=require('../../../backend/src/authorization/authorityDataRepository').createAuthorityDataRepository({coordinator:central.coordinator,catalogs:central.catalogs,policyVersion,recentMfaRequirement:requirement});
  async function actor(kc,organizationId,username,profileCode='ORG_ADMIN'){
   const identity=await kc.user(username),id=randomUUID(),membershipId=randomUUID();
   await central.pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE')",[id,username,username+'@example.invalid']);
   await central.pool.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4)',[randomUUID(),id,kc.issuer,identity.subject]);
   await central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,$4,'ACTIVE',clock_timestamp())",[membershipId,id,organizationId,profileCode]);
   const permissions=profileCode==='CONTRIBUTOR'?['application.read','opportunity.read']:
    ['opportunity.read','application.read','application.create','application.edit','application.transition','organization_directory.read','organization_directory.edit','personal_profile.read','organizational_scope.read','notification.read'];
   const grants=permissions.map(permission=>({permission,scope:{type:'ORGANIZATION',id:organizationId,organizationId}}));
   const version=await data.change({organizationId,membershipId,expectedVersion:0,grants,assuranceRequirements:requirement});
   return {...identity,id,membershipId,organizationId,grants,version};
  }
  async function tenant(kc,n){
   const organizationId=randomUUID();
   await central.pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code,data_residency_code) VALUES($1,$2,$2,$3,'RESEARCH','ACTIVE','EUR','USER_OPTIONAL','EU')",[organizationId,'Synthetic '+n,'http-proof-'+n]);
   const owner=await actor(kc,organizationId,'owner-'+n);
   const x={operationId:randomUUID(),organizationId,globalUserId:owner.id,membershipId:owner.membershipId,input:{adminName:owner.username,adminEmail:owner.username+'@example.invalid'}};
   await provisioner.ensure(x);await provisioner.project(x);
   const credentials=await provisioner.apiCredentials(x),pool=new Pool({...connection,database:credentials.database,max:2});tenantPools.push(pool);
   const repo=new(require('../../../backend/src/opportunities/tenantRepository').TenantOpportunityRepository)({pool,organizationId,identityFactory:require('../../../backend/src/opportunities/identity').createIdentityFactory()});
   const opportunity=await repo.create({schemaVersion:1,requestId:randomUUID(),snapshot:{schemaVersion:1,title:'Synthetic computer science innovation '+n,funderName:'Synthetic funder',provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',summary:'Artificial intelligence and computer science research',fundingAmountMin:'0',fundingAmountMax:'100',currencyCode:'EUR',closingDate:'2027-12-31'},provenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'HTTP_PROOF',observedAt:new Date().toISOString()}},{actor:{type:'HUMAN',reference:owner.id}});
   return {organizationId,owner,pool,credentials,opportunityId:opportunity.opportunityId};
  }
  // Bootstrap read-only central reader, following existing isolated integration gates.
  // This is NOT a claim that production central reader privileges have been approved.
  const readerPassword=secret();
  await admin.query(`CREATE ROLE c4g_http_reader LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await admin.query('GRANT pg_read_all_data TO c4g_http_reader');
  const readerUrl=new URL(central.connectionString);readerUrl.username='c4g_http_reader';readerUrl.password=readerPassword;
  reader=new Pool({connectionString:readerUrl.toString(),max:8});
  const catalogPassword=secret();await admin.query(`CREATE ROLE c4g_catalog_http LOGIN PASSWORD '${catalogPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
  await admin.query('GRANT c4g_catalog_reader TO c4g_catalog_http WITH INHERIT FALSE, SET TRUE');
  const catalogUrl=new URL(central.connectionString);catalogUrl.username='c4g_catalog_http';catalogUrl.password=catalogPassword;
  async function configure(tenants){
   const env={OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify(tenants.map(x=>x.credentials)),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:'EU',policyVersion:'http-proof-v1'}]),CATALOG_DATABASE_URL:catalogUrl.toString()};
   runtime=require('../../../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:reader,authorityCoordinator:central.coordinator,env});
   return {env,runtime};
  }
  return {central,reader,actor,tenant,configure,data,async close(){await runtime?.poolManager.closeAll();await Promise.all(tenantPools.map(x=>x.end()));await reader?.end();await central.close({retain:true});await admin.end();}};
 }catch(error){await reader?.end();await central?.close({retain:true});await admin.end();throw error;}
}
module.exports={keycloak,databaseFixture,secret,requirement,policyVersion};
