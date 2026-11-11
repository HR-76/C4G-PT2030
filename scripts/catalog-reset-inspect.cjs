'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Pool}=require('../backend/node_modules/pg');
const cfg=require('../backend/scripts/localPlatform/config');
const {target}=require('../backend/scripts/localPlatform/prepareOpportunityInterests');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
async function main(){
 const config=cfg.readConfig();target(config,JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))));
 const report={};
 for(const database of [config.centralDatabase,config.tenantDatabase]){
  const pool=new Pool({...cfg.connection(config,database),max:1,options:'-c default_transaction_read_only=on -c statement_timeout=20000'});
  try{
   const tables=(await pool.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname='opportunity_catalog' ORDER BY 2")).rows;
   for(const t of tables)t.count=Number((await pool.query(`SELECT count(*) AS n FROM ${quote(t.schema)}.${quote(t.name)}`)).rows[0].n);
   const foreignKeys=(await pool.query("SELECT conrelid::regclass::text AS child,confrelid::regclass::text AS parent,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND (connamespace='opportunity_catalog'::regnamespace OR confrelid IN(SELECT oid FROM pg_class WHERE relnamespace='opportunity_catalog'::regnamespace)) ORDER BY 1,2")).rows;
   const triggers=(await pool.query("SELECT tgrelid::regclass::text AS table_name,tgname AS name,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace='opportunity_catalog'::regnamespace) ORDER BY 1,2")).rows;
   const references=(await pool.query("SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE column_name IN('opportunity_id','central_opportunity_id','opportunity_revision_id','central_revision_id') ORDER BY 1,2,3")).rows;
   const pending=database===config.centralDatabase?(await pool.query("SELECT id,name,state,start_after,data->>'jobType' AS job_type,data->'payload'->>'runId' AS run_id,ARRAY(SELECT jsonb_object_keys(data)) AS data_keys FROM pgboss.job WHERE state::text IN('created','retry','active') AND (data->>'jobType'='funding_tenders.refresh' OR name LIKE '%funding%')")).rows:[];
   for(const job of pending){job.run=(await pool.query('SELECT status,error_code,finished_at,lease_until FROM opportunity_catalog.funding_run WHERE run_id=$1',[job.run_id])).rows[0];}
   report[database]={tables,foreignKeys,triggers,references,pending};
  }finally{await pool.end();}
 }
 fs.writeFileSync(path.join(cfg.root,'output/catalog-reset-inventory.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([db,r])=>[db,{opportunities:r.tables.find(t=>t.name==='opportunity').count,pending:r.pending,externalReferences:r.references.filter(x=>x.table_schema!=='opportunity_catalog')}])),null,2));
}
main().catch(e=>{console.error(JSON.stringify({code:e.code||'CATALOG_INSPECTION_FAILED'}));process.exitCode=1;});
