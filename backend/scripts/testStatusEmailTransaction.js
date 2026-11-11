'use strict';
const {execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {Client}=require('pg'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCapture}=require('../src/applications/statusEmails/capture');
const {createProducer}=require('../src/applications/statusEmails/producer');
const {createApplicationRepository}=require('../src/applications/repository');
const {load}=require('../src/applications/statusEmails/migration');
const profile=process.argv.includes('--member')?'CONTRIBUTOR':'ORG_ADMIN';
const name='c4g-status-tx-'+randomUUID(),password=randomUUID();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function docker(args){return execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});}
async function main(){let created=false;const clients=[];try{
 docker(['run','-d','--name',name,'-e','POSTGRES_PASSWORD='+password,'-p','127.0.0.1::5432','postgres:17-alpine']);created=true;
 let ready=false;for(let i=0;i<50;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,200));}}if(!ready)throw Error('not ready');
 const port=Number(docker(['port',name,'5432/tcp']).trim().split(':').at(-1));
 async function connect(database,user='postgres'){const c=new Client({host:'127.0.0.1',port,user,password,database});await c.connect();clients.push(c);return c;}
 const admin=await connect('postgres');await admin.query('CREATE DATABASE central_fixture');await admin.query('CREATE DATABASE tenant_fixture');
 const central=await connect('central_fixture'),tenant=await connect('tenant_fixture');
 await central.query(`CREATE TABLE organization(id uuid PRIMARY KEY,display_name text,status text);
 CREATE TABLE global_user(id uuid PRIMARY KEY,primary_email text,status text);
 CREATE TABLE organization_membership(id uuid PRIMARY KEY,organization_id uuid,global_user_id uuid,status text,valid_from timestamptz,valid_until timestamptz);`);
 await central.query("INSERT INTO organization VALUES($1,'Fixture','ACTIVE');",[id(1)]);
 for(const n of [3,4,5,6]){await central.query("INSERT INTO global_user VALUES($1,$2,'ACTIVE')",[id(n),`user${n}@example.invalid`]);await central.query("INSERT INTO organization_membership VALUES($1,$2,$3,$4,'2020-01-01',NULL)",[id(n+10),id(1),id(n),n===6?'SUSPENDED':'ACTIVE']);}
 await tenant.query(`CREATE ROLE c4g_opportunity_tenant_owner; CREATE ROLE c4g_opportunity_tenant_runtime; CREATE ROLE c4g_tenant_owner; CREATE ROLE c4g_tenant_runtime;
 CREATE SCHEMA opportunity_catalog AUTHORIZATION c4g_opportunity_tenant_owner; CREATE SCHEMA organization_profile;
 CREATE FUNCTION organization_profile.guard_authoring_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
 CREATE TABLE organization_profile.pq1_evaluation(organization_id uuid,evaluation_id uuid,opportunity_id uuid,PRIMARY KEY(organization_id,evaluation_id));
 SET ROLE c4g_opportunity_tenant_owner;
 CREATE TABLE opportunity_catalog.opportunity(organization_id uuid,opportunity_id uuid,PRIMARY KEY(organization_id,opportunity_id)); RESET ROLE;`);
 const root=path.join(__dirname,'../database/tenant/migrations');
 let appSql=fs.readFileSync(path.join(root,'021_application_first_slice.up.sql'),'utf8');appSql=appSql.slice(0,appSql.lastIndexOf('DO $$ DECLARE tab text; name text;'));
 await tenant.query(appSql);await tenant.query(fs.readFileSync(path.join(root,'001_f9_async_execution.up.sql'),'utf8'));await tenant.query(load().sql);
 await tenant.query(`CREATE TABLE opportunity_catalog.application_participant(organization_id uuid,application_id uuid,membership_id uuid,active boolean);
 GRANT USAGE ON SCHEMA opportunity_catalog,async_exec TO c4g_opportunity_tenant_runtime;
 GRANT SELECT ON opportunity_catalog.application_participant TO c4g_opportunity_tenant_runtime;
 `);
 await tenant.query('INSERT INTO opportunity_catalog.opportunity VALUES($1,$2)',[id(1),id(7)]);
 await tenant.query("INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,created_by) VALUES($1,$2,$3,'Fixture',$4,'2027-01-01',$5)",[id(1),id(2),id(7),id(14),id(3)]);
 for(const member of [13,14,15,16])await tenant.query('INSERT INTO opportunity_catalog.application_participant VALUES($1,$2,$3,true)',[id(1),id(2),id(member)]);
 const centralSource=fs.readFileSync(path.join(__dirname,'../database/central/migrations/025_entity_admission_completion.up.sql'),'utf8');
 const start=centralSource.indexOf('CREATE OR REPLACE FUNCTION authority_api.execute('),end=centralSource.indexOf('$authority$;',start)+'$authority$;'.length;
 assert.ok(start>=0&&end>start);
 await central.query(`CREATE ROLE c4g_authority_owner NOLOGIN NOINHERIT; CREATE ROLE c4g_authority_coordinator NOLOGIN NOINHERIT; CREATE ROLE c4g_authority_runtime LOGIN NOINHERIT PASSWORD '${password}'; GRANT c4g_authority_coordinator TO c4g_authority_runtime;
 CREATE SCHEMA authority_api AUTHORIZATION c4g_authority_owner;
 GRANT SELECT ON public.organization,public.global_user,public.organization_membership TO c4g_authority_owner;
 GRANT USAGE ON SCHEMA authority_api TO c4g_authority_coordinator;`);
 await central.query(centralSource.slice(start,end));
 await central.query(`ALTER FUNCTION authority_api.execute(text,text[],text) OWNER TO c4g_authority_owner;
 REVOKE ALL ON FUNCTION authority_api.execute(text,text[],text) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION authority_api.execute(text,text[],text) TO c4g_authority_coordinator;`);
 await central.query(require('../src/applications/statusEmails/securityPackage').load('central').sql);
 await tenant.query(require('../src/applications/statusEmails/securityPackage').load('tenant').sql);
 const restrictedCentral=await connect('central_fixture','c4g_authority_runtime');await restrictedCentral.query('SET ROLE c4g_authority_coordinator');
 await assert.rejects(restrictedCentral.query('SELECT * FROM public.global_user'),e=>e.code==='42501');
 await assert.rejects(restrictedCentral.query("SELECT authority_api.execute('unknown',ARRAY[]::text[],NULL)"),e=>e.code==='42501');
 const protocol=require('../src/security/authorityProtocolQueries');
 await assert.rejects(protocol.execute(restrictedCentral,'SELECT * FROM public.global_user'),e=>e.code==='42501');
 const capture=createCapture({centralPool:{query:(sql,values)=>protocol.execute(restrictedCentral,sql,values)},organizationId:id(1),actorUserId:id(3),assertAuthorized:async()=>{}});
 let broken=false,unavailable=false;
 const producer=createProducer({mode:'isolated',isolated:true,capture:async(c,e)=>{if(unavailable)throw Error('authority unavailable');return capture(c,e)}});
 const repository=createApplicationRepository({organizationId:id(1),actor:{id:id(3)},protect:async()=>{},audit:async()=>{},recordStatusEmail:async(c,e)=>{await producer(c,e);if(broken)throw Error('after outbox')}});
 async function transition(input){await tenant.query('BEGIN');try{await tenant.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await tenant.query("SELECT set_config('app.organization_id',$1,true)",[id(1)]);const value=await repository.transition(tenant,id(2),input);await tenant.query('COMMIT');return value}catch(e){await tenant.query('ROLLBACK');throw e;}}
 const input={status:'PREPARATION',reason:'test',expectedRevision:1,idempotencyKey:id(30)};
 await transition(input);await transition(input);
 async function count(table){return Number((await tenant.query('SELECT count(*) AS n FROM '+table)).rows[0].n)}
 assert.equal(await count('opportunity_catalog.application_status_event'),1);assert.equal(await count('opportunity_catalog.application_status_delivery'),2);assert.equal(await count('async_exec.outbox'),2);assert.equal(await count('opportunity_catalog.application_receipt'),1);
 const snapshot=(await tenant.query('SELECT snapshot FROM opportunity_catalog.application_status_event')).rows[0].snapshot;assert.deepEqual(snapshot.candidateMembershipIds,[id(14),id(15)]);assert.equal(snapshot.actorUserId,id(3));
 const next={status:'CANCELLED',reason:'test rollback',expectedRevision:2,idempotencyKey:id(31)};
 broken=true;await assert.rejects(transition(next),/after outbox/);broken=false;unavailable=true;await assert.rejects(transition(next),/authority unavailable/);unavailable=false;
 assert.equal(await count('opportunity_catalog.application_status_event'),1);assert.equal(await count('async_exec.outbox'),2);assert.equal(await count('opportunity_catalog.application_change'),1);assert.equal((await tenant.query('SELECT status FROM opportunity_catalog.application')).rows[0].status,'PREPARATION');
 await central.query("UPDATE organization_membership SET status='SUSPENDED' WHERE id=$1",[id(15)]);await transition(next);
 assert.equal(await count('async_exec.outbox'),3);assert.equal(await count('opportunity_catalog.application_status_delivery'),3);
 const envelopes=(await tenant.query('SELECT envelope FROM async_exec.outbox')).rows.map(r=>r.envelope);for(const e of envelopes)assert.deepEqual(Object.keys(e.payload),['deliveryId']);
 await admin.query(`CREATE ROLE status_tenant_login LOGIN NOINHERIT PASSWORD '${password}'; GRANT c4g_opportunity_tenant_runtime TO status_tenant_login`);
 const restrictedTenant=await connect('tenant_fixture','status_tenant_login');await restrictedTenant.query('SET ROLE c4g_opportunity_tenant_runtime');
 for(const sql of ['SELECT * FROM async_exec.outbox','INSERT INTO async_exec.outbox DEFAULT VALUES','DELETE FROM async_exec.outbox',"UPDATE async_exec.outbox SET state='FAILED'"]){await assert.rejects(restrictedTenant.query(sql),e=>e.code==='42501');}
 await restrictedTenant.query("SELECT set_config('app.organization_id',$1,false)",[id(99)]);
 const e=envelopes[0];
 await assert.rejects(restrictedTenant.query('SELECT opportunity_catalog.enqueue_status_delivery($1,$2,$3,$4::jsonb,$5,now())',[id(1),e.payload.deliveryId,randomUUID(),JSON.stringify(e),'a'.repeat(64)]),err=>err.code==='42501');
 await tenant.query(require('../src/applications/statusEmails/securityPackage').load('simulation').sql);
 const {createSimulationStore}=require('../src/applications/statusEmails/simulationStore');
 const {createSimulatedConsumer}=require('../src/applications/statusEmails/consumer');
 const {createRecipientAuthority}=require('../src/applications/statusEmails/recipientAuthority');
 const {createTransport}=require('../src/applications/statusEmails/transport');
 await tenant.query(require('../src/applications/statusEmails/securityPackage').load('worker').sql);
 await admin.query(`CREATE ROLE status_worker_login LOGIN NOINHERIT PASSWORD '${password}'; GRANT c4g_status_simulation_worker TO status_worker_login`);
 const worker=await connect('tenant_fixture','status_worker_login');await worker.query('SET ROLE c4g_status_simulation_worker');
 const store=createSimulationStore({isolated:true,transaction:async(org,work)=>{await worker.query('BEGIN');try{await worker.query("SELECT set_config('app.organization_id',$1,true)",[org]);const result=await work(worker);await worker.query('COMMIT');return result}catch(e){await worker.query('ROLLBACK');throw e;}}});
 await central.query('CREATE TABLE recipient_policy(membership_id uuid PRIMARY KEY,snapshot jsonb NOT NULL)');
 for(const member of [14,15])await central.query('INSERT INTO recipient_policy VALUES($1,$2)',[id(member),{organizationId:id(1),membershipVersion:1,authorizationVersion:1,profileCode:member===14?profile:'CONTRIBUTOR',grants:member===14?['application.read','opportunity.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:id(1),organizationId:id(1)}})):[],sodRules:[],supportGrant:null}]);
 const authorize=require('../src/applications/statusEmails/policyAuthority').createPolicyAuthority({catalogs:require('../src/authorization/productionAuthorization').validateProductionAuthorizationBootstrap(),policyVersion:'isolated-policy',recentMfaRequirement:{mfa:false,maxAgeSeconds:300,acceptedAcr:[],acceptedAmr:[],amrMode:'all'},
 load:async subject=>{const r=(await central.query('SELECT m.*,p.snapshot FROM organization_membership m JOIN recipient_policy p ON p.membership_id=m.id WHERE m.id=$1 AND m.organization_id=$2',[subject.membershipId,subject.organizationId])).rows[0];return r?{membership:{id:r.id,globalUserId:r.global_user_id,organizationId:r.organization_id,membershipVersion:1,status:r.status,validUntil:r.valid_until?new Date(r.valid_until).getTime():Infinity},snapshot:r.snapshot}:null;},
 resource:async({subject,resourceId,operationCode})=>require('../src/applications/repository').resource(resourceId,subject.organizationId,operationCode==='APPLICATION_READ'?'APPLICATION':operationCode==='OPPORTUNITY_READ'?'OPPORTUNITY':'PREQUALIFICATION_EVALUATION')});
 const resolver=createRecipientAuthority({
 identity:async({organizationId,membershipId})=>{const r=(await central.query(`SELECT m.*,u.primary_email,u.status AS user_status,o.status AS org_status FROM organization_membership m JOIN global_user u ON u.id=m.global_user_id JOIN organization o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.id=$2`,[organizationId,membershipId])).rows[0];return r?{organizationId,membershipId,userId:r.global_user_id,email:r.primary_email,organizationActive:r.org_status==='ACTIVE',userActive:r.user_status==='ACTIVE',membershipActive:r.status==='ACTIVE',validFrom:r.valid_from.toISOString(),validUntil:r.valid_until?.toISOString()||null}:null;},
 application:async({organizationId,applicationId,membershipId})=>{const r=(await tenant.query('SELECT * FROM opportunity_catalog.application WHERE organization_id=$1 AND application_id=$2',[organizationId,applicationId])).rows[0];return r?{organizationId,applicationId,responsibleMembershipId:r.responsible_membership_id,activeParticipant:(await tenant.query('SELECT 1 FROM opportunity_catalog.application_participant WHERE organization_id=$1 AND application_id=$2 AND membership_id=$3 AND active',[organizationId,applicationId,membershipId])).rowCount>0,opportunityId:r.opportunity_id,evaluationId:r.evaluation_id}:null;},
 authorize
 });
 const transport=createTransport({mode:'simulated',isolated:true,outcome:({call})=>call===1?'TIMEOUT_AFTER_ACCEPTANCE':'ACCEPTED'});
 const consumer=createSimulatedConsumer({isolated:true,organizationId:id(1),store,resolve:resolver,transport,publicOrigin:'https://fixture.example.invalid'});
 const jobs=(await tenant.query('SELECT envelope FROM async_exec.outbox ORDER BY created_at,outbox_id')).rows.map(r=>r.envelope);
 const memberJobs=[];for(const job of jobs){const member=(await tenant.query('SELECT membership_id FROM opportunity_catalog.application_status_delivery WHERE delivery_id=$1',[job.payload.deliveryId])).rows[0].membership_id;if(member===id(14))memberJobs.push(job);else {assert.equal((await consumer.handler(job)).code,'SUCCESS');}}
 assert.equal((await consumer.handler(memberJobs[0])).code,'RETRYABLE');
 // Same simulated provider instance remembers acceptance; restart consumer/store.
 const resumed=createSimulatedConsumer({isolated:true,organizationId:id(1),store,resolve:resolver,transport,publicOrigin:'https://fixture.example.invalid'});
 assert.equal((await resumed.handler(memberJobs[0])).code,'SUCCESS');assert.equal(transport.stats().accepted,1);
 assert.equal((await resumed.handler(memberJobs[0])).code,'SUCCESS');assert.equal(transport.stats().accepted,1);
 await central.query("UPDATE organization_membership SET status='SUSPENDED' WHERE id=$1",[id(14)]);
 assert.equal((await resumed.handler(memberJobs[1])).code,'SUCCESS');assert.equal(transport.stats().accepted,1);
 const states=(await tenant.query('SELECT state FROM opportunity_catalog.application_status_simulation')).rows.map(r=>r.state);assert.equal(states.filter(v=>v==='ACCEPTED').length,1);assert.equal(states.filter(v=>v==='SKIPPED').length,2);
 // Fresh scenario, independent SQL connections and durable reservation.
 await central.query("UPDATE organization_membership SET status='ACTIVE' WHERE id=$1",[id(14)]);
 const freshApp=id(70),freshEvent=id(71),freshDelivery=id(72);
 await tenant.query("INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,created_by) VALUES($1,$2,$3,'Fixture',$4,'2027-01-01',$5)",[id(1),freshApp,id(7),id(14),id(3)]);
 await tenant.query("INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,reason,actor_subject_id) VALUES($1,$2,2,'TRANSITION','INTENTION','PREPARATION','Fixture',$3,'2027-01-01','test',$4)",[id(1),freshApp,id(14),id(3)]);
 const freshSnapshot={...snapshot,applicationId:freshApp,candidateMembershipIds:[id(14)]};
 await tenant.query('INSERT INTO opportunity_catalog.application_status_event VALUES($1,$2,$3,2,$4)',[id(1),freshEvent,freshApp,freshSnapshot]);
 await tenant.query('INSERT INTO opportunity_catalog.application_status_delivery(organization_id,delivery_id,event_id,membership_id) VALUES($1,$2,$3,$4)',[id(1),freshDelivery,freshEvent,id(14)]);
 async function newStore(){const connection=await connect('tenant_fixture','status_worker_login');await connection.query('SET ROLE c4g_status_simulation_worker');return {connection,store:createSimulationStore({isolated:true,transaction:async(org,work)=>{await connection.query('BEGIN');try{await connection.query("SELECT set_config('app.organization_id',$1,true)",[org]);const value=await work(connection);await connection.query('COMMIT');return value}catch(e){await connection.query('ROLLBACK');throw e;}}})};}
 const left=await newStore(),right=await newStore();const instant=new Date();
 const template=require('../src/applications/statusEmails/template').render(freshSnapshot,{publicOrigin:'https://fixture.example.invalid'});
 const message={to:'user4@example.invalid',subject:template.subject,html:template.html,text:template.text};
 const races=await Promise.all([left.store.reserve(id(1),freshDelivery,message,instant),right.store.reserve(id(1),freshDelivery,message,instant)]);
 assert.deepEqual(races.map(r=>r.status).sort(),['BUSY','RESERVED']);
 const first=races.find(r=>r.status==='RESERVED');
 assert.equal((await right.store.reserve(id(1),freshDelivery,message,new Date(instant.getTime()+29999))).status,'BUSY');
 const afterExpiry=new Date(instant.getTime()+30000);
 const takeover=await right.store.reserve(id(1),freshDelivery,message,afterExpiry);assert.equal(takeover.status,'RESERVED');assert.equal(takeover.fence,first.fence+1);
 assert.equal(await left.store.finish(id(1),freshDelivery,first.fence,'ACCEPTED','STALE'),false);
 // Lost process/connection after committed reservation; next connection restores it.
 await right.connection.end();clients.splice(clients.indexOf(right.connection),1);
 const restarted=await newStore();const recoveredTime=new Date(instant.getTime()+60000);
 const freshJob={...memberJobs[0],payload:{deliveryId:freshDelivery}};
 const recoveryTransport=createTransport({mode:'simulated',isolated:true});
 const recovery=createSimulatedConsumer({isolated:true,organizationId:id(1),store:restarted.store,resolve:resolver,transport:recoveryTransport,publicOrigin:'https://fixture.example.invalid',now:()=>recoveredTime});
 assert.equal((await recovery.handler(freshJob)).code,'SUCCESS');assert.equal(recoveryTransport.stats().accepted,1);
 assert.equal(await left.store.finish(id(1),freshDelivery,takeover.fence,'FAILED','STALE'),false);
 assert.equal((await recovery.handler(freshJob)).code,'SUCCESS');assert.equal(recoveryTransport.stats().accepted,1);
 assert.equal((await restarted.store.load(id(1),freshDelivery)).state,'ACCEPTED');
 const processEvent=id(81),processDelivery=id(82);
 await tenant.query("INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,reason,actor_subject_id) VALUES($1,$2,3,'TRANSITION','PREPARATION','CANCELLED','Fixture',$3,'2027-01-01','process test',$4)",[id(1),freshApp,id(14),id(3)]);
 await tenant.query('INSERT INTO opportunity_catalog.application_status_event VALUES($1,$2,$3,3,$4)',[id(1),processEvent,freshApp,{...freshSnapshot,revision:3,fromStatus:'PREPARATION',toStatus:'CANCELLED'}]);
 await tenant.query('INSERT INTO opportunity_catalog.application_status_delivery(organization_id,delivery_id,event_id,membership_id) VALUES($1,$2,$3,$4)',[id(1),processDelivery,processEvent,id(14)]);
 await require('./statusEmailProcessProbe').runProbe({config:{host:'127.0.0.1',port,user:'status_worker_login',password,database:'tenant_fixture'},job:{...freshJob,payload:{deliveryId:processDelivery}},instant:recoveredTime.getTime()+1000,resolve:resolver,
 revoke:()=>central.query("UPDATE organization_membership SET status='SUSPENDED' WHERE id=$1",[id(14)]),restore:()=>central.query("UPDATE organization_membership SET status='ACTIVE' WHERE id=$1",[id(14)])});
 const acceptanceEvent=id(91),acceptanceDelivery=id(92);
 await tenant.query("INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,reason,actor_subject_id) VALUES($1,$2,4,'TRANSITION','PREPARATION','CANCELLED','Fixture',$3,'2027-01-01','acceptance window',$4)",[id(1),freshApp,id(14),id(3)]);
 await tenant.query('INSERT INTO opportunity_catalog.application_status_event VALUES($1,$2,$3,4,$4)',[id(1),acceptanceEvent,freshApp,{...freshSnapshot,revision:4,fromStatus:'PREPARATION',toStatus:'CANCELLED'}]);
 await tenant.query('INSERT INTO opportunity_catalog.application_status_delivery(organization_id,delivery_id,event_id,membership_id) VALUES($1,$2,$3,$4)',[id(1),acceptanceDelivery,acceptanceEvent,id(14)]);
 await require('./statusEmailProcessProbe').runProbe({config:{host:'127.0.0.1',port,user:'status_worker_login',password,database:'tenant_fixture'},job:{...freshJob,payload:{deliveryId:acceptanceDelivery}},instant:recoveredTime.getTime()+100000,resolve:resolver,acceptance:true,
 inspect:async expected=>{const r=(await tenant.query('SELECT state FROM opportunity_catalog.application_status_simulation WHERE organization_id=$1 AND delivery_id=$2',[id(1),acceptanceDelivery])).rows;assert.equal(r.length,1);assert.equal(r[0].state,expected);}});
 console.log('PASS independent worker connections: one reservation, busy lease, exact expiry takeover, stale fence rejected, connection restart and single simulated acceptance.');
 await worker.query("SELECT set_config('app.organization_id',$1,false)",[id(1)]);
 for(const sql of ['SELECT * FROM async_exec.outbox','DELETE FROM opportunity_catalog.application_status_simulation',"UPDATE opportunity_catalog.application_status_simulation SET message='{}'","UPDATE opportunity_catalog.application SET title='forbidden'"]){await assert.rejects(worker.query(sql),e=>e.code==='42501');}
 await worker.query("SELECT set_config('app.organization_id',$1,false)",[id(99)]);assert.equal((await worker.query('SELECT * FROM opportunity_catalog.application_status_simulation')).rowCount,0);
 if(process.argv.includes('--browser')){
  const delivered=(await tenant.query("SELECT s.message,e.application_id FROM opportunity_catalog.application_status_simulation s JOIN opportunity_catalog.application_status_event e USING(organization_id,event_id) WHERE s.state='ACCEPTED' AND e.application_id=$1 ORDER BY e.revision LIMIT 1",[id(2)])).rows[0];
  const row=(await tenant.query('SELECT * FROM opportunity_catalog.application WHERE application_id=$1',[delivered.application_id])).rows[0];
  await require('./statusEmailBrowserProbe').run({profile,message:delivered.message,record:require('../src/applications/repository').project(row),organizationId:id(1),userId:id(4),canRead:async()=>await authorize({subject:{organizationId:id(1),membershipId:id(14),userId:id(4)},operationCode:'APPLICATION_READ',resourceId:row.application_id,applicationId:row.application_id})==='ALLOW',revokeAccess:()=>central.query("UPDATE recipient_policy SET snapshot=jsonb_set(snapshot,'{grants}','[]'::jsonb) WHERE membership_id=$1",[id(14)])});
 }
 console.log('PASS real policy engine and restricted worker: no outbox access, mutation of application/message, delete or tenant leakage.');
 console.log('PASS simulated consumer: persistent ledger, revoked memberships, recipient grants, lost response, retry and duplicate.');
 console.log('PASS restricted protocol and outbox: direct table access, unknown SQL and cross-tenant enqueue denied.');
 console.log('PASS: central capture + tenant repository + real outbox; commit, receipt replay, rollback after outbox, unavailable authority, suspension, reference-only payload. No emails.');
 }finally{for(const c of clients.reverse())await c.end();if(created)docker(['rm','-f','-v',name]);}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
