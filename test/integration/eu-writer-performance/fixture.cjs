'use strict';
// Disposable fixture only. Installation/seed use the isolated owner; HTTP uses
// existing authority, catalog-reader and tenant capability contracts.
const assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const secret=()=>randomBytes(32).toString('hex');
const requirement=Object.freeze({mfa:false,maxAgeSeconds:300,acceptedAcr:['c4g-loa1'],acceptedAmr:['pwd'],amrMode:'any'});
const policyVersion='c4g-user-mfa-v1';
const seedSpecDefault=Object.freeze({schemaVersion:1,id:'eu-writer-performance-seed-v1',instant:'2026-10-31T00:00:00.000Z',deadline:'2027-12-31',applicationsPerTenant:1000,peoplePerTenant:250,tenants:2});
const hash=value=>createHash('sha256').update(value).digest('hex');
function uuid(name){const b=createHash('sha256').update(name).digest().subarray(0,16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=b.toString('hex');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
function opportunityIds(spec,index){
 let sequence=0;
 return require('../../../backend/src/opportunities/identity').createIdentityFactory({clock:()=>Date.parse(spec.instant),randomBytes:n=>createHash('sha256').update(`${spec.id}/tenant/${index}/opportunity/${sequence++}`).digest().subarray(0,n)});
}
function seedPlan(input=seedSpecDefault){
 assert.deepEqual(Object.keys(input).sort(),Object.keys(seedSpecDefault).sort(),'SEED_SPEC_KEYS_INVALID');
 assert.equal(input.schemaVersion,1);assert.match(input.id,/^[a-z][a-z0-9-]{3,80}$/);
 assert.equal(new Date(input.instant).toISOString(),input.instant,'SEED_INSTANT_INVALID');
 assert.match(input.deadline,/^\d{4}-\d{2}-\d{2}$/);assert.equal(new Date(input.deadline).toISOString().slice(0,10),input.deadline);
 assert.equal(input.tenants,2);assert.equal(input.applicationsPerTenant,1000);assert.equal(input.peoplePerTenant,250);
 const spec=Object.fromEntries(Object.keys(seedSpecDefault).map(k=>[k,input[k]]));
 const tenants=Array.from({length:2},(_,index)=>{
  const id=name=>uuid(`${spec.id}/tenant/${index}/${name}`),ids=opportunityIds(spec,index);
  return {index,organizationId:id('organization'),userId:id('user'),membershipId:id('membership'),identityRefId:id('identity-ref'),operationId:id('provision'),migrationId:id('migration034'),requestId:id('opportunity-create'),provenanceId:id('provenance'),privateOpportunityId:ids.next(),privateRevisionId:ids.next(),username:`eu-trial-owner-${index}`,
   applications:Array.from({length:spec.applicationsPerTenant},(_,n)=>({id:id(`application/${n}`),title:`Synthetic ${index} application ${String(n+1).padStart(6,'0')}`})),
   people:Array.from({length:spec.peoplePerTenant-1},(_,n)=>({id:id(`person/${n}`),name:`Synthetic ${index} person ${n+1}`,email:`person${n+1}-tenant${index}@example.invalid`}))};
 });
 return {spec,tenants,digest:hash(JSON.stringify({spec,tenants})),identityAlgorithm:'SHA256_NAMESPACE_UUID4_AND_FIXED_TIME_UUID7',operationalFields:'Database generation IDs, credentials, actual Keycloak subjects/issuer, OIDC/session epochs and immutable installation/audit timestamps are ephemeral; they are not business seed fields. The actual identity binding is validated and recorded separately by digest.'};
}
function operationalIdentityDigest(seed,issuer,users){
 const source=new URL(issuer);assert.equal(source.protocol,'https:');assert.equal(source.hostname,'localhost');assert(!source.username&&!source.password);assert(Array.isArray(users)&&users.length===seed.tenants.length);
 assert.equal(new Set(users.map(user=>user.subject)).size,users.length);
 const bindings=seed.tenants.map((plan,index)=>{const user=users[index];assert.equal(user.username,plan.username);assert.match(user.subject,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);return {organizationId:plan.organizationId,globalUserId:plan.userId,membershipId:plan.membershipId,issuer,subject:user.subject};});
 return hash(JSON.stringify(bindings));
}
function validateFixtureInput(input){
 const source=new URL(input.adminUrl),kc=new URL(input.keycloakBase);
 assert(['postgres:','postgresql:'].includes(source.protocol));assert.equal(source.hostname,'127.0.0.1');assert.equal(source.pathname,'/postgres');
 assert.equal(source.username,'proof_admin');assert(source.password);assert(Number(source.port)>1024&&!['5432','5433'].includes(source.port));assert.equal(source.search,'');assert.equal(source.hash,'');
 assert.equal(kc.protocol,'https:');assert.equal(kc.hostname,'localhost');assert(Number(kc.port)>1024);assert.equal(kc.pathname,'/');assert.equal(kc.search,'');assert.equal(kc.hash,'');assert(!kc.username&&!kc.password);
 assert.match(input.runId||'',/^[a-f0-9]{32}$/);assert(['042','043'].includes(input.centralRevision||'043'));assert(typeof input.keycloakPassword==='string'&&input.keycloakPassword.length>0);
 return {...input,centralRevision:input.centralRevision||'043',source,keycloakBase:kc.origin,seed:seedPlan(input.seedSpec)};
}
async function createKeycloak({base,password,runId,seed}){
 for(let i=0;;i++){
  try{if((await fetch(base+'/realms/master/.well-known/openid-configuration',{signal:AbortSignal.timeout(2000)})).ok)break;}catch{}
  assert(i<120,'KEYCLOAK_NOT_READY');await new Promise(r=>setTimeout(r,1000));
 }
 const login=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'proof-admin',password}),signal:AbortSignal.timeout(15000)});
 assert.equal(login.status,200,'KEYCLOAK_BOOTSTRAP_FAILED');const token=(await login.json()).access_token;
 const realm='c4g-eu-trial-'+runId,clientId='eu-writer-performance';
 async function admin(route,method='GET',body){
  const response=await fetch(base+'/admin/realms'+route,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert(response.ok,'KEYCLOAK_CONFIGURATION_'+response.status);const text=await response.text();return text?JSON.parse(text):null;
 }
 await admin('','POST',{realm,enabled:true,sslRequired:'all',registrationAllowed:false,attributes:{'acr.loa.map':JSON.stringify({'c4g-loa1':1,'c4g-loa2':2})}});
 const kc=(route,method,body)=>admin('/'+realm+'/'+route,method,body),users=[];
 for(const tenant of seed.tenants){const password=secret()+'aZ9!';
  await kc('users','POST',{username:tenant.username,firstName:'Synthetic',lastName:'EU trial',email:tenant.username+'@example.invalid',enabled:true,emailVerified:true,credentials:[{type:'password',value:password,temporary:false}]});
  const rows=await kc('users?username='+tenant.username+'&exact=true');assert.equal(rows.length,1);assert.equal(rows[0].username,tenant.username);assert.match(rows[0].id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  users.push({username:tenant.username,password,subject:rows[0].id});
 }
 let configured=false;
 return {issuer:base+'/realms/'+realm,clientId,users,async configureClient(origin){
  assert(!configured,'KEYCLOAK_CLIENT_ALREADY_CONFIGURED');const target=new URL(origin);assert.equal(target.protocol,'https:');assert.equal(target.hostname,'localhost');assert(Number(target.port)>1024);assert.equal(target.origin,origin);
  const flow=await require('../../../backend/scripts/localPlatform/identityFlow').configureOptionalFlow(kc,{installationId:uuid(seed.spec.id+'/identity-flow')},clientId);
  await kc('clients','POST',{clientId,enabled:true,publicClient:true,protocol:'openid-connect',standardFlowEnabled:true,directAccessGrantsEnabled:false,redirectUris:[origin+'/api/auth/oidc/callback'],webOrigins:[origin],attributes:{'pkce.code.challenge.method':'S256','default.acr.values':'c4g-loa1','minimum.acr.value':'c4g-loa1'},authenticationFlowBindingOverrides:{browser:flow},protocolMappers:[{name:'amr',protocol:'openid-connect',protocolMapper:'oidc-amr-mapper',config:{'id.token.claim':'true','access.token.claim':'true'}}]});configured=true;
 }};
}
async function seedTenant(tenant,plan,spec){
 const {pool,organizationId,owner,opportunityId}=tenant,client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  await client.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,created_by,total_budget,organization_budget,created_at,updated_at)
   SELECT $1,x.id,$2,x.title,$3,$4,$5,100.01,50.01,$6,$6 FROM unnest($7::uuid[],$8::text[]) x(id,title)`,[organizationId,opportunityId,owner.membershipId,spec.deadline,owner.id,spec.instant,plan.applications.map(x=>x.id),plan.applications.map(x=>x.title)]);
  await client.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,to_status,title,responsible_membership_id,deadline,actor_subject_id,total_budget,organization_budget,recorded_at)
   SELECT organization_id,application_id,revision,'CREATE',status,title,responsible_membership_id,deadline,created_by,total_budget,organization_budget,$2 FROM opportunity_catalog.application WHERE organization_id=$1`,[organizationId,spec.instant]);
  await client.query(`INSERT INTO organizational_scope.person(organization_id,person_id,name,email,created_by,updated_by,created_at,updated_at)
   SELECT $1,x.id,x.name,x.email,$2,$2,$3,$3 FROM unnest($4::uuid[],$5::text[],$6::text[]) x(id,name,email)`,[organizationId,owner.id,spec.instant,plan.people.map(x=>x.id),plan.people.map(x=>x.name),plan.people.map(x=>x.email)]);
  const areas=require('../../../backend/src/organizationDirectory/thematicAreas').classify({title:'Artificial intelligence and computer science research'}).map(x=>x.id);assert(areas.length);
  await client.query(`INSERT INTO organizational_scope.person_profile(organization_id,person_id,area_ids,updated_by) SELECT organization_id,person_id,$2,$3 FROM organizational_scope.person p WHERE organization_id=$1 AND NOT EXISTS(SELECT 1 FROM organizational_scope.person_profile f WHERE f.organization_id=p.organization_id AND f.person_id=p.person_id)`,[organizationId,areas,owner.id]);
  await client.query('UPDATE organizational_scope.person_profile SET area_ids=$2,revision=revision+1,updated_at=$3 WHERE organization_id=$1 AND area_ids<>$2',[organizationId,areas,spec.instant]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 // Head timestamps influence private list ordering, so freeze them in fixture
 // setup. Immutable historical rows keep their real installation timestamps.
 await pool.query('UPDATE opportunity_catalog.opportunity SET created_at=$2,updated_at=$2 WHERE organization_id=$1',[organizationId,spec.instant]);
 for(const table of ['opportunity_catalog.application','opportunity_catalog.application_change','organizational_scope.person','organizational_scope.person_profile'])await pool.query('ANALYZE '+table);
 const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM opportunity_catalog.application) applications,(SELECT count(*)::int FROM organizational_scope.person) people,(SELECT count(*)::int FROM opportunity_catalog.opportunity) private_opportunities`)).rows[0];
 assert.deepEqual(counts,{applications:1000,people:250,private_opportunities:1});
}
async function quiesceFixtureSource(pool,actorId){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const [from,to,fence] of [['ACTIVE','SUSPEND_REQUESTED',1],['SUSPEND_REQUESTED','QUIESCED',2]]){
   const result=await client.query(`UPDATE opportunity_catalog.eu_source_control_v2 SET state=$1,fence=fence+1,changed_by=$2,changed_at=clock_timestamp() WHERE family='EU_FUNDING_TENDERS' AND state=$3 AND fence=$4 RETURNING state,fence`,[to,actorId,from,fence]);
   assert.equal(result.rowCount,1,'FIXTURE_SOURCE_TRANSITION_REFUSED');assert.equal(result.rows[0]?.state,to);assert.equal(result.rows[0]?.fence,fence+1);
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function createFixture(input){
 const cfg=validateFixtureInput(input),{Pool}=require('../../../backend/node_modules/pg'),report=input.report||{},check=input.check||((_name,work)=>work());
 const admin=new Pool({connectionString:cfg.source.toString(),max:2}),tenants=[];let central,reader,runtime,keycloak,closed=false;
 const ownership={isolated:true,runId:cfg.runId,centralDatabase:'c4g_f13_authority_synthetic_central'};
 async function close(){if(closed)return;closed=true;const errors=[];for(const action of [()=>runtime?.poolManager.closeAll(),...tenants.map(t=>()=>t.pool.end()),()=>reader?.end(),()=>central?.close({retain:true}),()=>admin.end()])try{await action();}catch(error){errors.push(error);}if(errors.length)throw Error('FIXTURE_POOL_CLEANUP_FAILED');}
 try{
  await check('FIXTURE_CENTRAL_REGISTERED_INSTALLATION',async()=>{
   assert.equal(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num)>=180000,true,'POSTGRES18_REQUIRED');
   assert.equal(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num)<190000,true,'POSTGRES18_REQUIRED');
   central=await require('../f13/central-authority-fixture').centralAuthorityFixture(cfg.source.toString(),{validateHistoricalRoundTrip:false});
   const migration=require('../../../backend/scripts/runCentralMigrations'),pkg=require('../../../backend/src/security/opportunityV2MigrationPackage');
   await admin.query('ALTER ROLE c4g_f12_admin SUPERUSER');const installer=await central.pool.connect();
   try{await installer.query('SET SESSION AUTHORIZATION c4g_f12_admin');const installerPool={connect:async()=>({query:(...args)=>installer.query(...args),release(){}})};
    await migration.applyRegisteredCentralPackage(installerPool,pkg.PACKAGE_ID);
    if(cfg.centralRevision==='043')await migration.applyRegisteredEuWriterPackage(installerPool,require('../../../backend/src/security/opportunityEuWriterMigrationPackage').PACKAGE_ID);
   }finally{await installer.query('RESET SESSION AUTHORIZATION').catch(()=>{});installer.release();await admin.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN');}
   await quiesceFixtureSource(central.pool,cfg.seed.tenants[0].userId);
   reader=new Pool({connectionString:central.authorityConnectionString,max:8});
  });
  await check('FIXTURE_REAL_KEYCLOAK_IDENTITIES',async()=>{keycloak=await createKeycloak({base:cfg.keycloakBase,password:cfg.keycloakPassword,runId:cfg.runId,seed:cfg.seed});});
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO proof_admin');
  const connection={host:cfg.source.hostname,port:Number(cfg.source.port),user:cfg.source.username,password:decodeURIComponent(cfg.source.password)},reservations=new Map();
  const provisioner=require('../../../backend/src/platformOnboarding/postgresProvisioner').createPostgresProvisioner({adminPool:admin,centralPool:central.pool,connection,ownershipKey:secret(),journal:{async reserve(id,_input,create){if(!reservations.has(id))reservations.set(id,create());return reservations.get(id);}},regionCode:'EU',residencyPolicyVersion:'eu-writer-trial-v1'});
  const data=require('../../../backend/src/authorization/authorityDataRepository').createAuthorityDataRepository({coordinator:central.coordinator,catalogs:central.catalogs,policyVersion,recentMfaRequirement:requirement});
  for(const plan of cfg.seed.tenants)await check('FIXTURE_TENANT_'+plan.index+'_034_AND_SEED',async()=>{
   const organizationId=plan.organizationId,identity=keycloak.users[plan.index],owner={...identity,id:plan.userId,membershipId:plan.membershipId,organizationId};
   await central.pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code,data_residency_code) VALUES($1,$2,$2,$3,'RESEARCH','ACTIVE','EUR','USER_OPTIONAL','EU')",[organizationId,'Synthetic EU trial '+plan.index,'eu-writer-trial-'+plan.index]);
   await central.pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE')",[owner.id,owner.username,owner.username+'@example.invalid']);
   await central.pool.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4)',[plan.identityRefId,owner.id,keycloak.issuer,owner.subject]);
   await central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',$4)",[owner.membershipId,owner.id,organizationId,cfg.seed.spec.instant]);
   owner.grants=['opportunity.read','application.read','application.create','application.edit','application.transition','organization_directory.read','organization_directory.edit','personal_profile.read','organizational_scope.read','notification.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:organizationId,organizationId}}));
   owner.version=await data.change({organizationId,membershipId:owner.membershipId,expectedVersion:0,grants:owner.grants,assuranceRequirements:requirement});
   const provision={operationId:plan.operationId,organizationId,globalUserId:owner.id,membershipId:owner.membershipId,input:{adminName:owner.username,adminEmail:owner.username+'@example.invalid'}};
   await provisioner.ensure(provision);await provisioner.project(provision);
   const credentials=await provisioner.apiCredentials(provision),pool=new Pool({...connection,database:credentials.database,max:2});
   const tenant={index:plan.index,organizationId,owner,pool,credentials,expected:{applications:1000,people:250,privateOpportunities:1}};tenants.push(tenant);
   const snapshot=await require('../../../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central.pool).resolveSnapshotByOrganization(organizationId,'API');
   tenant.identity={tenantId:snapshot.tenantId,databaseGenerationId:snapshot.databaseGenerationId};
   const publisher=require('../../../backend/src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(require('../../../backend/src/security/tenantSchemaRepository').createTenantSchemaRepository(central.pool));
   const runner=require('../../../backend/src/security/tenantMigrationRunner').createRegisteredTenantMigrationRunner({packageId:require('../../../backend/src/security/opportunityV2MigrationPackage').PACKAGE_ID,pool,observationPublisher:publisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}});
   const migrated=await runner.migrate({...tenant.identity,expectedRevision:snapshot.schema.revision,correlationId:plan.migrationId,idempotencyKey:plan.migrationId});assert.equal(migrated.evidence.currentVersion,'034_application_snapshot_v2');
   const repo=new(require('../../../backend/src/opportunities/tenantRepository').TenantOpportunityRepository)({pool,organizationId,identityFactory:opportunityIds(cfg.seed.spec,plan.index),clock:()=>new Date(cfg.seed.spec.instant)});
   const opportunity=await repo.create({schemaVersion:1,requestId:plan.requestId,snapshot:{schemaVersion:1,title:'Synthetic computer science innovation '+plan.index,funderName:'Synthetic funder',provenanceId:plan.provenanceId,lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',summary:'Artificial intelligence and computer science research',fundingAmountMin:'0',fundingAmountMax:'100',currencyCode:'EUR',closingDate:cfg.seed.spec.deadline},provenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'EU_WRITER_PERFORMANCE',observedAt:cfg.seed.spec.instant}},{actor:{type:'HUMAN',reference:owner.id}});
   assert.equal(opportunity.opportunityId,plan.privateOpportunityId);assert.equal(opportunity.revisionId,plan.privateRevisionId);tenant.opportunityId=opportunity.opportunityId;
   await seedTenant(tenant,plan,cfg.seed.spec);
  });
  const catalogPassword=secret();await admin.query(`CREATE ROLE c4g_catalog_eu_trial LOGIN PASSWORD '${catalogPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
  await admin.query('GRANT c4g_catalog_reader TO c4g_catalog_eu_trial WITH INHERIT FALSE, SET TRUE');
  const catalogUrl=new URL(central.connectionString);catalogUrl.username='c4g_catalog_eu_trial';catalogUrl.password=catalogPassword;
  const runtimeEnv={OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify(tenants.map(t=>t.credentials)),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:'EU',policyVersion:'eu-writer-trial-v1'}]),CATALOG_DATABASE_URL:catalogUrl.toString()};
  runtime=require('../../../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:reader,authorityCoordinator:central.coordinator,env:runtimeEnv});
  runtime.directoryRepository=require('../../../backend/src/security/tenantDirectoryReader').createTenantDirectoryReader({coordinator:central.coordinator,organizations:tenants.map(t=>t.organizationId),workload:'API'});
  async function assertSchemas(){
   const observed=await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(reader);assert(observed.currentVersion.startsWith(cfg.centralRevision+'_'));
   const entries=require('../../../backend/src/security/tenantMigrationManifest').registeredManifest,versions=[];
   for(const tenant of tenants){const evidence=await require('../../../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant.pool,tenant.identity,entries,{timeoutMs:15000});assert.equal(evidence.currentVersion,'034_application_snapshot_v2');const snapshot=await runtime.directoryRepository.resolveSnapshotByOrganization(tenant.organizationId,'API');assert.equal(snapshot.schema.currentVersion,evidence.currentVersion);assert.equal(snapshot.schema.schemaFingerprint,evidence.schemaFingerprint);versions.push(evidence.currentVersion);}
   return {central:observed.currentVersion,centralFingerprint:observed.fingerprint,tenants:versions};
  }
  async function assertWriterIdle(){const row=(await central.pool.query("SELECT state,(SELECT count(*)::int FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')) pending FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS'")).rows[0];assert.equal(row?.state,'QUIESCED');assert.equal(row.pending,0);return {...row,runtimeEnabled:false};}
  async function verifyDatabaseIsolation(){
   const detail={};await require('../http-oidc/sqlProof').roles(tenants[0],tenants[1],central,()=>{},detail);
   const restricted=(await reader.query("SELECT NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) restricted,NOT pg_has_role(session_user,'pg_read_all_data','MEMBER') no_broad_reader FROM pg_roles WHERE rolname=session_user")).rows[0];assert(restricted.restricted&&restricted.no_broad_reader);
   await assert.rejects(()=>reader.query('SELECT * FROM public.global_user'),error=>error.code==='42501');
   return {verified:true,limitedCentralLogin:'c4g_authority_runtime',directory:'SCOPED_AUTHORITY_READER',catalogRole:'c4g_catalog_reader',tenantRoleProofs:detail.roles};
  }
  const schemas=await assertSchemas(),writerState=await assertWriterIdle();
  report.fixture={centralRevision:cfg.centralRevision,schemas,writerState,seedDigest:cfg.seed.digest,seedSpec:cfg.seed.spec,operationalIdentityDigest:operationalIdentityDigest(cfg.seed,keycloak.issuer,keycloak.users),tenants:tenants.map(t=>({index:t.index,organizationId:t.organizationId,opportunityId:t.opportunityId,expected:t.expected})),runtimeRoles:{authority:'c4g_authority_runtime',readiness:'c4g_authority_runtime',catalog:'c4g_catalog_reader',tenant:'c4g_tenant_api_capabilities'},directory:'SCOPED_AUTHORITY_READER',operationalSeedLimit:cfg.seed.operationalFields};
  return {central,reader,tenants,runtime,runtimeEnv,keycloak,seed:cfg.seed,writerState,centralRevision:cfg.centralRevision,ownership,assertSchemas,assertWriterIdle,verifyDatabaseIsolation,close};
 }catch(error){try{await close();}catch{error.fixtureCleanupFailed=true;}throw error;}
}
module.exports={createFixture,seedSpecDefault,seedPlan,validateFixtureInput,quiesceFixtureSource,operationalIdentityDigest,requirement,policyVersion};
