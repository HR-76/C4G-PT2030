'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('../../../backend/node_modules/pg'),fs=require('node:fs'),path=require('node:path');
async function verify({central,origin,http,p,select,a,aCredentials,adminId}){
 const url=new URL(process.env.F13_S2_ADMIN_URL);assert.equal(url.port,'5598');url.pathname='/'+aCredentials.database;const pool=new Pool({connectionString:url.toString()});
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-registration'),checks=[];
 try{
  await select(a.organizationId);
  const initial=await http(p,'/api/organization-directory');assert.equal(initial.status,200);assert.equal(initial.data.contactSource,'LEGACY');
  const edited=await http(p,'/api/organization-directory','PUT',{description:'Descrição privada preservada',email:'old@example.org',website:'https://example.org',expectedRevision:initial.data.profile.revision,idempotencyKey:randomUUID()});assert.equal(edited.status,200,JSON.stringify(edited.data));
  const before=(await pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows;
  const sid=(await central.pool.query("SELECT sid FROM public.application_session WHERE global_user_id=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1",[adminId])).rows[0].sid,request={user:{id:adminId},sessionID:sid,authContext:{sessionId:sid}};
  const generation=(await pool.query('SELECT database_generation_id FROM c4g_system.tenant_identity')).rows[0].database_generation_id;
  const registration=require('../../../backend/src/entityAdmission/registrationService').createRegistrationService({coordinator:central.coordinator});
  const migrate=()=>require('../../../backend/src/entityAdmission/contactMigration').migrateContacts({tenantPool:pool,organizationId:a.organizationId,databaseGenerationId:generation,service:registration,request});
  // Both migration and ordinary writes must wait for the same tenant lock.
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[a.organizationId]);
  const concurrent=Promise.allSettled([
   http(p,'/api/organization-directory','PUT',{description:'Descrição privada preservada',email:'racing@example.org',website:'https://example.org',expectedRevision:edited.data.revision,idempotencyKey:randomUUID()}),migrate()
  ]);
  await new Promise(resolve=>setTimeout(resolve,100));await blocker.query('COMMIT');blocker.release();
  const race=await concurrent;assert(race.every(r=>r.status==='fulfilled'));assert([200,409].includes(race[0].value.status));
  const expectedEmail=race[0].value.status===200?'racing@example.org':'old@example.org';
  await migrate();
  const current=await http(p,'/api/organization-directory');assert.equal(current.status,200,JSON.stringify(current.data));assert.equal(current.data.contactSource,'CENTRAL');assert.equal(current.data.profile.description,'Descrição privada preservada');assert.equal(current.data.registration.fields.institutionalEmail,expectedEmail);checks.push('Verified physical binding, migration/edit race and idempotent migration; description and old columns preserved');
  const intent={expectedRevision:current.data.registration.revision,requestId:randomUUID(),fields:{institutionalEmail:'new@example.org',institutionalPhone:'+351210000000',website:'https://example.org/new'}};
  const saved=await http(p,'/api/organization-directory/registration/contacts','PUT',intent);assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.deepEqual((await http(p,'/api/organization-directory/registration/contacts','PUT',intent)).data,saved.data);
  assert.equal((await http(p,'/api/organization-directory/registration/contacts','PUT',{...intent,requestId:randomUUID()})).status,409);checks.push('Real session and F5 authorization, contacts revision and exact retry');
  const ownerId=(await http(p,'/api/auth/session')).data.user.id;
  const membership=(await central.pool.query('SELECT selected_membership_id FROM public.application_session WHERE global_user_id=$2 AND selected_organization_id=$1 AND status=\'ACTIVE\' ORDER BY created_at DESC LIMIT 1',[a.organizationId,ownerId])).rows[0].selected_membership_id;
  const f5=(await central.pool.query('SELECT * FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2',[a.organizationId,membership])).rows[0];
  await central.data.change({organizationId:a.organizationId,membershipId:membership,expectedVersion:Number(f5.authorization_version),newPolicyVersion:f5.policy_version,assuranceRequirements:f5.assurance_requirements,grants:f5.grants.filter(g=>g.permission!=='organization_directory.edit')});
  assert.equal((await http(p,'/api/organization-directory/registration/contacts','PUT',intent)).status,403);
  const revision=(await central.pool.query('SELECT authorization_version FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2',[a.organizationId,membership])).rows[0].authorization_version;
  await central.data.change({organizationId:a.organizationId,membershipId:membership,expectedVersion:Number(revision),newPolicyVersion:f5.policy_version,assuranceRequirements:f5.assurance_requirements,grants:f5.grants});checks.push('Revoked edit grant denies even a successful command replay');
  const stale=await http(p,'/api/organization-directory','PUT',{description:'Outra descrição',email:'legacy-overwrite@example.org',website:'https://example.org',expectedRevision:current.data.profile.revision,idempotencyKey:randomUUID()});assert.equal(stale.status,409);
  const description=await http(p,'/api/organization-directory/description','PUT',{description:'Descrição atualizada',expectedRevision:current.data.profile.revision,idempotencyKey:randomUUID()});assert.equal(description.status,200,JSON.stringify(description.data));
  assert.equal((await pool.query('SELECT email FROM organizational_scope.organization_card WHERE organization_id=$1',[a.organizationId])).rows[0].email,expectedEmail);
  assert.equal((await migrate()).fields.institutionalEmail,'new@example.org');
  assert.deepEqual((await pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows,before);checks.push('Old contact writes denied; description save preserves legacy contact evidence, applications and tasks');
  await p.setViewportSize({width:1440,height:1000});await p.goto(origin+'/perfil-organizacao');await p.getByRole('heading',{name:'Ficha administrativa'}).waitFor();await p.getByRole('button',{name:'Editar contactos'}).click();await p.getByRole('button',{name:'Guardar contactos'}).waitFor();await p.screenshot({path:path.join(out,'profile-1440.png'),fullPage:true});
  await p.getByLabel('Email institucional',{exact:true}).fill('ui@example.org');await p.getByRole('button',{name:'Guardar contactos'}).click();await p.getByRole('button',{name:'Editar contactos'}).waitFor();await p.getByText('ui@example.org',{exact:true}).first().waitFor();
  // The visible refresh already exercises the real GET. Confirm persistence
  // independently, without racing another session-authority update from the UI.
  assert.equal((await central.pool.query('SELECT fields FROM public.organization_registration WHERE organization_id=$1',[a.organizationId])).rows[0].fields.institutionalEmail,'ui@example.org');
  await p.screenshot({path:path.join(out,'profile-saved-1440.png'),fullPage:true});checks.push('Existing entity profile edits and displays the canonical contact; central persistence independently confirmed');
  fs.writeFileSync(path.join(out,'profile-verification.json'),JSON.stringify({result:'PASS',checks},null,2));console.log('PASS canonical organization profile and separate contact writes');
 }finally{await pool.end()}
}
module.exports={verify};
