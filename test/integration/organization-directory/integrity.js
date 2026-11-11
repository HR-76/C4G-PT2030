'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
async function run(){
 const root=path.resolve(__dirname,'../../..');
 for(const [name,port] of [['c4g-directory-probe',5566],['c4g-directory-pg18',5568]]){
  const config=JSON.parse(fs.readFileSync(path.join(root,`.tmp/organization-directory/${name}.json`)));assert.equal(config.host,'127.0.0.1');assert.equal(config.port,port);
  const pool=new Pool({...config,database:'c4g_directory_probe'}),c=await pool.connect();
  try{
   await c.query('BEGIN');await c.query(fs.readFileSync(path.join(root,'backend/database/tenant/migrations/025_organization_directory.up.sql'),'utf8'));
   await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');const org=randomUUID(),unit=randomUUID(),person=randomUUID(),actor=randomUUID();
   await c.query("SELECT set_config('app.organization_id',$1,true)",[org]);
   await c.query(`INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id)
    VALUES($1,$2,'UNIT','Synthetic','{}','HUMAN',$3,'HUMAN',$3)`,[unit,org,actor]);
   await c.query("INSERT INTO organizational_scope.person(organization_id,person_id,name,created_by,updated_by) VALUES($1,$2,'Synthetic',$3,$3)",[org,person,actor]);
   await c.query('SAVEPOINT missing_primary');await c.query('INSERT INTO organizational_scope.person_unit VALUES($1,$2,$3,false)',[org,person,unit]);
   await assert.rejects(()=>c.query('SET CONSTRAINTS ALL IMMEDIATE'),/DIRECTORY_PRIMARY_UNIT_REQUIRED/);await c.query('ROLLBACK TO SAVEPOINT missing_primary');
   await c.query('INSERT INTO organizational_scope.person_unit VALUES($1,$2,$3,true)',[org,person,unit]);await c.query('SET CONSTRAINTS ALL IMMEDIATE');
   await c.query('SAVEPOINT invalid_archive');
   await assert.rejects(()=>c.query(`UPDATE organizational_scope.scope SET lifecycle='ARCHIVED',revision=revision+1,archived_at=transaction_timestamp(),archived_by_actor_id=$2,archive_reason_code='REORGANIZED' WHERE scope_id=$1`,[unit,actor]),/DIRECTORY_UNIT_HAS_PEOPLE/);
   await c.query('ROLLBACK TO SAVEPOINT invalid_archive');
   await c.query('SAVEPOINT immutable_identity');await assert.rejects(()=>c.query('UPDATE organizational_scope.person SET person_id=$1,revision=revision+1 WHERE person_id=$2',[randomUUID(),person]),/DIRECTORY_IMMUTABLE_FIELD/);await c.query('ROLLBACK TO SAVEPOINT immutable_identity');
   await c.query('SAVEPOINT stale_revision');await assert.rejects(()=>c.query("UPDATE organizational_scope.person SET name='Changed' WHERE person_id=$1",[person]),/DIRECTORY_IMMUTABLE_OR_STALE/);await c.query('ROLLBACK TO SAVEPOINT stale_revision');
   await c.query("SELECT set_config('app.organization_id',$1,true)",[randomUUID()]);assert.equal((await c.query('SELECT * FROM organizational_scope.person_unit')).rowCount,0);
   await c.query('ROLLBACK');console.log(`POSTGRES_${port===5568?18:17}_DIRECTORY_CONSTRAINTS_RLS_PASS`);
  }finally{await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end()}
 }
}
run().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1});
