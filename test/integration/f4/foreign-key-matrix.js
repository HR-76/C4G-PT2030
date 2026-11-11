const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {Pool,config,withDatabase}=require('./matrix-support');const {preflightCentral}=require('../../../backend/src/security/centralMigrationPreflight');
const suffix=`${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const fks=[
 ['tenant','tenant_organization_fk',['organization_id'],'organization',['id']],
 ['tenant_database_generation','tenant_database_generation_tenant_fk',['tenant_id'],'tenant',['tenant_id']],
 ['organization_connection_version','organization_connection_version_tenant_fk',['tenant_id'],'tenant',['tenant_id']],
 ['organization_connection_version','organization_connection_version_generation_fk',['tenant_id','database_generation_id','database_ref'],'tenant_database_generation',['tenant_id','database_generation_id','database_ref']],
 ['organization_connection','organization_connection_tenant_fk',['tenant_id'],'tenant',['tenant_id']],
 ['organization_connection','organization_connection_version_fk',['tenant_id','current_connection_version'],'organization_connection_version',['tenant_id','connection_version']],
 ['tenant_schema_state','tenant_schema_state_tenant_id_fkey',['tenant_id'],'tenant',['tenant_id']],
 ['organization_provisioning','organization_provisioning_organization_id_fkey',['organization_id'],'organization',['id']],
 ['organization_provisioning','organization_provisioning_tenant_fk',['tenant_id','organization_id'],'tenant',['tenant_id','organization_id']],
 ['tenant_health_observation','tenant_health_observation_tenant_id_connection_version_fkey',['tenant_id','connection_version'],'organization_connection_version',['tenant_id','connection_version']]
].map(([table,name,source,target,destination])=>({table,name,source,target,destination}));
const catalogSql=`SELECT con.conname name,src.relname source_table,dst.relname target_table,
 array_agg(sa.attname::text ORDER BY sk.ordinality) source_columns,array_agg(da.attname::text ORDER BY sk.ordinality) target_columns,
 con.confmatchtype match_type,con.confupdtype update_action,con.confdeltype delete_action,con.condeferrable deferrable,
 con.condeferred initially_deferred,con.convalidated validated
 FROM pg_constraint con JOIN pg_class src ON src.oid=con.conrelid JOIN pg_class dst ON dst.oid=con.confrelid
 JOIN pg_namespace ns ON ns.oid=src.relnamespace JOIN unnest(con.conkey) WITH ORDINALITY sk(attnum,ordinality) ON true
 JOIN unnest(con.confkey) WITH ORDINALITY dk(attnum,ordinality) ON dk.ordinality=sk.ordinality
 JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=sk.attnum JOIN pg_attribute da ON da.attrelid=dst.oid AND da.attnum=dk.attnum
 WHERE ns.nspname='public' AND con.contype='f' AND src.relname=$1 AND con.conname=$2 GROUP BY con.oid,src.relname,dst.relname`;
function definition(fk,variant){return `FOREIGN KEY (${(variant.source||fk.source).join(',')}) REFERENCES public.${variant.target||fk.target} (${(variant.destination||fk.destination).join(',')}) MATCH ${variant.match||'SIMPLE'} ON UPDATE ${variant.update||'RESTRICT'} ON DELETE ${variant.delete||'RESTRICT'} ${variant.timing||'NOT DEFERRABLE INITIALLY IMMEDIATE'}`;}
const mutations=[
 ['name',fk=>({name:`${fk.name}_drift`})],['match',()=>({match:'FULL'})],['update',()=>({update:'CASCADE'})],['delete',()=>({delete:'CASCADE'})],
 ['deferrability',()=>({timing:'DEFERRABLE INITIALLY IMMEDIATE'})],['initially_deferred',()=>({timing:'DEFERRABLE INITIALLY DEFERRED'})],['validation',()=>({notValid:true})]
];
async function main(){const admin=new Pool(config('postgres'));let passed=0;const notRepresentable=[];try{
 await withDatabase(admin,`c4g_f41_fk_inventory_${suffix}`,async pool=>{for(const fk of fks){const result=await pool.query(catalogSql,[fk.table,fk.name]);assert.equal(result.rowCount,1,`${fk.table}.${fk.name}`);const row=result.rows[0];assert.equal(row.source_table,fk.table);assert.equal(row.target_table,fk.target);assert.deepEqual(row.source_columns,fk.source);assert.deepEqual(row.target_columns,fk.destination);assert.deepEqual({match:row.match_type,update:row.update_action,delete:row.delete_action,deferrable:row.deferrable,deferred:row.initially_deferred,validated:row.validated},{match:'s',update:'r',delete:'r',deferrable:false,deferred:false,validated:true});passed++;}});
 for(const fk of fks)for(const [property,make] of mutations){const variant=make(fk);await withDatabase(admin,`c4g_f41_fk_${passed}_${suffix}`,async pool=>{const newName=variant.name||fk.name;await pool.query(`ALTER TABLE public.${fk.table} DROP CONSTRAINT ${fk.name}, ADD CONSTRAINT ${newName} ${definition(fk,variant)}${variant.notValid?' NOT VALID':''}`);const before=(await pool.query(catalogSql,[fk.table,newName])).rows[0];await assert.rejects(()=>preflightCentral(pool),/schema drift/);const after=(await pool.query(catalogSql,[fk.table,newName])).rows[0];assert.deepEqual(after,before,`${fk.name}:${property} was repaired unexpectedly`);});passed++;}
 const simpleAlternatives={tenant:['tenant_id','tenant','tenant_id'],tenant_database_generation:['database_generation_id','organization','id'],organization_connection_version:['database_generation_id','organization','id'],tenant_schema_state:null,organization_provisioning:['tenant_id','tenant','tenant_id']};
 for(const fk of fks){if(fk.source.length===1&&simpleAlternatives[fk.table]){const [source,target,destination]=simpleAlternatives[fk.table];await withDatabase(admin,`c4g_f41_fk_source_${passed}_${suffix}`,async pool=>{await pool.query(`ALTER TABLE public.${fk.table} DROP CONSTRAINT ${fk.name}, ADD CONSTRAINT ${fk.name} ${definition(fk,{source:[source]})}`);await assert.rejects(()=>preflightCentral(pool),/schema drift/);});passed++;await withDatabase(admin,`c4g_f41_fk_target_${passed}_${suffix}`,async pool=>{await pool.query(`ALTER TABLE public.${fk.table} DROP CONSTRAINT ${fk.name}, ADD CONSTRAINT ${fk.name} ${definition(fk,{target,destination:[destination]})}`);await assert.rejects(()=>preflightCentral(pool),/schema drift/);});passed++;}else notRepresentable.push(`${fk.name}: independent source/target substitution has no existing type-compatible unique key`);
  if(fk.source.length>1&&fk.source.every((column,index)=>column===fk.destination[index])){notRepresentable.push(`${fk.name}: reversing mixed-type columns is rejected by PostgreSQL, or needs an extra UNIQUE and would not be isolated`);}else if(fk.source.length>1)notRepresentable.push(`${fk.name}: destination reordering lacks a reversed UNIQUE candidate key`);
 }
 }finally{await admin.end();}console.log(`F4.1 foreign-key matrix passed: ${passed} catalog/drift cases; ${notRepresentable.length} source/destination/order variants not independently representable.`);for(const reason of notRepresentable)console.log(`NOT REPRESENTABLE: ${reason}`);}
main().catch(error=>{console.error(error);process.exitCode=1;});
