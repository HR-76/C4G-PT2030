'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
module.exports=async function tenantProof({admin,connection,backend,base}){
 const load=file=>require(path.join(backend,file));
 for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
 await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator; GRANT c4g_tenant_migrator TO c4g_f12_admin');
 await admin.query("CREATE DATABASE isolated_tenant ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");
 const pool=new (load('node_modules/pg').Pool)({...connection,database:'isolated_tenant',options:'-c timezone=UTC'});
 try{
  await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC; REVOKE ALL ON DATABASE isolated_tenant FROM PUBLIC; GRANT CONNECT,CREATE ON DATABASE isolated_tenant TO c4g_tenant_owner; GRANT CONNECT ON DATABASE isolated_tenant TO c4g_tenant_migrator,c4g_tenant_runtime');
  await pool.query('ALTER ROLE c4g_tenant_runtime IN DATABASE isolated_tenant SET search_path TO pg_catalog,c4g_app');
  const manifest=load('src/security/tenantMigrationManifest');
  await load('src/security/tenantMigrationRunner').createTenantMigrationRunner({pool,entries:manifest.chatRetentionManifest,observationPublisher:{async publish(){}},timeoutMs:120000,scheduler:{setTimeout,clearTimeout}}).migrate({tenantId:randomUUID(),databaseGenerationId:randomUUID(),expectedRevision:1,correlationId:'deletion-proof',idempotencyKey:'deletion-proof'});
  const sql=fs.readFileSync(path.join(backend,'database/tenant/migrations/041_account_identity_erasure.up.sql'),'utf8');
  await pool.query('BEGIN');try{await pool.query(sql);await pool.query('COMMIT');}catch(e){await pool.query('ROLLBACK');throw e;}
  const schema=load('src/security/tenantSchemaFingerprint');
  const evidence={schemaFingerprint:schema.tenantSchemaFingerprint(await schema.tenantSchemaSnapshot(pool)),sqlChecksum:manifest.checksumSql(sql)};
  fs.writeFileSync(path.join(base,'tenant-fingerprints.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({tenant:evidence}));
  const org=randomUUID(),otherOrg=randomUUID(),person=randomUUID(),member=randomUUID(),subject=randomUUID(),request=randomUUID();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
   await client.query("INSERT INTO organizational_scope.person(organization_id,person_id,name,email,created_by,updated_by) VALUES($1,$2,'Synthetic name','synthetic@example.invalid',$3,$3)",[org,person,subject]);
   await client.query("INSERT INTO organizational_scope.person_profile(organization_id,person_id,membership_id,biography,keywords,updated_by) VALUES($1,$2,$3,'Synthetic biography','Synthetic keywords',$4)",[org,person,member,subject]);
   await client.query("INSERT INTO organizational_scope.directory_receipt(organization_id,idempotency_key,subject_id,operation,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,'PERSON_CREATE',$4,$5,$6)",[org,randomUUID(),subject,person,'a'.repeat(64),JSON.stringify({personId:person,name:'Synthetic name',email:'synthetic@example.invalid',revision:1})]);
   await client.query('COMMIT');
   await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[otherOrg]);await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
   await assert.rejects(client.query('SELECT organizational_scope.erase_account_identity($1,$2,$3,$4)',[org,member,subject,request]),/ACCOUNT_ERASURE_BINDING_INVALID/);await client.query('ROLLBACK');
   await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
   await client.query('SELECT organizational_scope.erase_account_identity($1,$2,$3,$4)',[org,member,subject,request]);
   const row=(await client.query('SELECT * FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[org,person])).rows[0];assert.equal(row.name,'Utilizador eliminado');assert.equal(row.email,'');assert.equal(row.active,false);
   const receipt=(await client.query('SELECT result_projection FROM organizational_scope.directory_receipt WHERE organization_id=$1 AND resource_id=$2',[org,person])).rows[0].result_projection;assert.deepEqual(receipt,{personId:person,revision:1});
   await client.query('SELECT organizational_scope.erase_account_identity($1,$2,$3,$4)',[org,member,subject,request]);
   assert.deepEqual((await client.query('SELECT * FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[org,person])).rows[0],row);
   await client.query('SAVEPOINT protected');await assert.rejects(client.query("UPDATE organizational_scope.person SET name='Restore identity',revision=revision+1 WHERE organization_id=$1 AND person_id=$2",[org,person]),/ACCOUNT_IDENTITY_ERASED/);await client.query('ROLLBACK TO SAVEPOINT protected');
   await client.query('COMMIT');
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 }finally{await pool.end();}
};
