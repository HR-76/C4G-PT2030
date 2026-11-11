'use strict';
// Creates only a randomly named disposable container; never connects to APP DBs.
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {load}=require('../src/applications/statusEmails/migration');
const name='c4g-status-email-'+randomUUID();
function docker(args,input){return execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});}
async function main(){let created=false;try{
 docker(['run','--detach','--name',name,'--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);created=true;
 let ready=false;for(let i=0;i<40;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,250));}}if(!ready)throw Error('POSTGRES_NOT_READY');
 const prefix=`CREATE ROLE c4g_opportunity_tenant_owner; CREATE ROLE c4g_opportunity_tenant_runtime;
 CREATE SCHEMA opportunity_catalog AUTHORIZATION c4g_opportunity_tenant_owner;
 CREATE SCHEMA organization_profile; GRANT USAGE ON SCHEMA organization_profile,opportunity_catalog TO c4g_opportunity_tenant_owner,c4g_opportunity_tenant_runtime;
 CREATE FUNCTION organization_profile.guard_authoring_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
 SET ROLE c4g_opportunity_tenant_owner;
 CREATE TABLE opportunity_catalog.application_change(organization_id uuid,application_id uuid,revision bigint,PRIMARY KEY(organization_id,application_id,revision)); RESET ROLE;
 INSERT INTO opportunity_catalog.application_change VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',2);`;
 const checks=`
 BEGIN; SET LOCAL ROLE c4g_opportunity_tenant_runtime;
 SELECT set_config('app.organization_id','00000000-0000-4000-8000-000000000001',true);
 INSERT INTO opportunity_catalog.application_status_event VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',2,'{"organizationId":"00000000-0000-4000-8000-000000000001","applicationId":"00000000-0000-4000-8000-000000000002"}');
 INSERT INTO opportunity_catalog.application_status_delivery(organization_id,delivery_id,event_id,membership_id) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005');
 DO $$ BEGIN
 BEGIN INSERT INTO opportunity_catalog.application_status_event SELECT * FROM opportunity_catalog.application_status_event; RAISE EXCEPTION 'duplicate accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 END $$;
 SELECT set_config('app.organization_id','00000000-0000-4000-8000-000000000009',true);
 DO $$ BEGIN IF EXISTS(SELECT 1 FROM opportunity_catalog.application_status_event) OR EXISTS(SELECT 1 FROM opportunity_catalog.application_status_delivery) THEN RAISE EXCEPTION 'tenant leak'; END IF; END $$;
 ROLLBACK;
 DO $$ BEGIN IF EXISTS(SELECT 1 FROM opportunity_catalog.application_status_event) OR EXISTS(SELECT 1 FROM opportunity_catalog.application_status_delivery) THEN RAISE EXCEPTION 'rollback failed'; END IF; END $$;`;
 docker(['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],prefix+load().sql+checks);
 console.log('PASS disposable PostgreSQL: migration, runtime role, uniqueness, isolation, rollback');
 }finally{if(created)docker(['rm','--force','--volumes',name]);}}
main().catch(()=>{console.error('STATUS_EMAIL_SCHEMA_GATE_FAILED');process.exitCode=1});
