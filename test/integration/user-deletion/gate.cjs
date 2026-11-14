'use strict';
// Self-contained PostgreSQL cluster. Never connects to local development or staging databases.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),backend=path.join(root,'backend'),bin='C:/Program Files/PostgreSQL/18/bin';
const base=path.join(root,'.tmp','user-deletion-'+Date.now());
const run=(name,args)=>execFileSync(path.join(bin,name+'.exe'),args,{windowsHide:true,stdio:'ignore',timeout:120000});
const load=file=>require(path.join(backend,file));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function proof(pool,connection){
 await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
 await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
 const runner=load('scripts/runCentralMigrations'),manifest=load('src/security/centralMigrationManifest');
 await runner.applyCentralMigrationsWithManifest(pool,manifest.centralImportManifest,manifest.migrationSql);
 await runner.applyRegisteredBillingPdfsPackage(pool,'billing-private-documents-v1');
 await runner.applyRegisteredEmailTemplatesPackage(pool,'email-templates-v1');
 await runner.applyRegisteredCentralRuntimeReadPackage(pool,'central-runtime-read-v1');
 await runner.applyRegisteredOpportunityComplementPackage(pool,'opportunity-complement-v1');
 await pool.query(load('src/platformOnboarding/memberEmailSecurityPackage').load().sql);
 const ledger=(await pool.query('SELECT * FROM public.c4g_schema_migration ORDER BY version')).rows;
 await pool.query(fs.readFileSync(path.join(backend,'database/central/candidates/platform_user_deletion.up.sql'),'utf8'));
 const schema=load('src/security/centralSchemaManifest'),authority=load('src/security/authoritySecurityManifest');
 const snapshot=await schema.centralSchemaSnapshot(pool,{compactAuthority:true});
 const pins={schema:schema.schemaFingerprint(snapshot),authority:authority.digest(snapshot.authoritySecurity)};
 fs.writeFileSync(path.join(base,'fingerprints.json'),JSON.stringify(pins,null,2));console.log(JSON.stringify(pins));
 assert.deepEqual((await pool.query('SELECT * FROM public.c4g_schema_migration ORDER BY version')).rows,ledger);
 if(process.env.USER_DELETION_CALIBRATE==='1'){await require('./tenant.cjs')({admin:pool,connection,backend,base});return;}
 await schema.assertCentralSchema(pool,'053_opportunity_complement');
 await authority.assertAuthoritySecurity(pool,'053_opportunity_complement');
 await load('src/security/catalogReaderSchema').assertCatalogReaderSchema(pool);
 const {randomUUID}=require('node:crypto'),actor=randomUUID(),target=randomUUID(),other=randomUUID(),org=randomUUID(),member=randomUUID(),key=randomUUID(),subject=randomUUID();
 const issuer='https://identity.example.invalid/realms/c4g';
 for(const id of [actor,target,other])await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic account',$2,'ACTIVE')",[id,id+'@example.invalid']);
 await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),actor]);
 await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) VALUES('actor',$1,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour'),('target',$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')",[actor,target]);
 await pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Synthetic entity','Synthetic entity',$2,'COMPANY','ACTIVE','EUR','OPTIONAL')",[org,'org-'+org]);
 await pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'CONTRIBUTOR','ACTIVE',clock_timestamp())",[member,target,org]);
 await pool.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4)',[randomUUID(),target,issuer,subject]);
 const beforeOther=(await pool.query('SELECT * FROM public.global_user WHERE id=$1',[other])).rows;
 await pool.query('ALTER ROLE c4g_authority_runtime LOGIN');
 const runtimePool=new (load('node_modules/pg').Pool)({...connection,user:'c4g_authority_runtime'});
 try{
  const coordinator=load('src/security/authorityCoordinator').createAuthorityCoordinator({pool:runtimePool,permitSecret:'isolated-test-secret-at-least-32-characters'});
  let unavailable=true,identityCalls=0;
  const service=load('src/platformDirectory/deletion').createUserDeletion({coordinator,issuer,policyVersion:'v1',recentMfaRequirement:{mfa:true,maxAgeSeconds:300,acceptedAcr:['mfa'],acceptedAmr:['otp'],amrMode:'all'},
   identity:{async remove(value){identityCalls++;if(unavailable)throw Error('ISOLATED_FAILURE');return {...value,deleted:true};}},
   projection:{async anonymize(value){return {...value,anonymized:true};}},audit:load('src/platformOnboarding/audit').createOnboardingAudit()});
  const req={sessionID:'actor',user:{id:actor},authContext:{sessionId:'actor',evidence:{policyVersion:'v1',authTime:Date.now()/1000,acr:'mfa',amr:['otp']}}};
  const input={requestId:key,expectedRevision:1,confirmation:'ELIMINAR'};
  await assert.rejects(service.remove(target,input,req),/ISOLATED_FAILURE/);
  assert.equal((await pool.query('SELECT status FROM public.global_user WHERE id=$1',[target])).rows[0].status,'ARCHIVED');
  assert.equal((await pool.query("SELECT status FROM public.application_session WHERE sid='target'")).rows[0].status,'REVOKED');
  unavailable=false;assert.equal((await service.remove(target,input,req)).phase,'COMPLETE');
  assert.equal((await service.remove(target,input,req)).phase,'COMPLETE');assert.equal(identityCalls,2);
  assert.equal((await pool.query('SELECT display_name FROM public.global_user WHERE id=$1',[target])).rows[0].display_name,'Utilizador eliminado');
  assert.deepEqual((await pool.query('SELECT * FROM public.global_user WHERE id=$1',[other])).rows,beforeOther);
  assert.equal((await pool.query('SELECT status FROM public.organization_membership WHERE id=$1',[member])).rows[0].status,'REMOVED');
 }finally{await runtimePool.end();}
 await require('./tenant.cjs')({admin:pool,connection,backend,base});
}
(async()=>{fs.mkdirSync(base,{recursive:true});const port=await freePort(),data=path.join(base,'data');let started=false;
 try{run('initdb',['-D',data,'-U','c4g_f12_admin','-A','trust','--encoding=UTF8','--locale=C']);run('pg_ctl',['-D',data,'-l',path.join(base,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  const connection={host:'127.0.0.1',port,user:'c4g_f12_admin',database:'postgres'},pool=new (load('node_modules/pg').Pool)(connection);
  try{await proof(pool,connection);}finally{await pool.end();}
  console.log(JSON.stringify({pass:true,evidence:base,calibrationOnly:process.env.USER_DELETION_CALIBRATE==='1'}));
 }finally{if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
