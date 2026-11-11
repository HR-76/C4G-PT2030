"use strict";
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {buildProjection,emptyExtension}=require('../../../backend/src/opportunities/catalogRead/model');
const {contentDigestV2}=require('../../../backend/src/opportunities/v2/digests');
const source=require('../catalog-read/snapshot-v2.json');
async function prepare(db,report,{maxPoolConnections=10}={}){
 const pool=db.central.pool;
 const manifest=require('../../../backend/src/security/centralMigrationManifest');
 await pool.query('ALTER ROLE c4g_f12_admin SUPERUSER');
 const c=await pool.connect();
 try{await c.query('SET SESSION AUTHORIZATION c4g_f12_admin');const installer={connect:async()=>({query:(...args)=>c.query(...args),release(){}})};await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(installer,manifest.knownManifest,manifest.migrationSql);}
 finally{await c.query('RESET SESSION AUTHORIZATION');c.release();await pool.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN');}
 await require('../catalog-read/package.cjs').apply(pool);
 for(const state of ['SUSPEND_REQUESTED','QUIESCED'])await pool.query('UPDATE opportunity_catalog.eu_source_control_v2 SET state=$1,fence=fence+1,changed_by=$2,changed_at=clock_timestamp()',[state,randomUUID()]);
 const base=new URL(db.central.connectionString);const pools=[];const credentials={};
 for(const [name,role] of [['gcni_catalog_reader','c4g_catalog_projection_reader'],['gcni_catalog_authority','c4g_catalog_projection_membership']]){
  const password=randomBytes(32).toString('hex');credentials[name==='gcni_catalog_reader'?'catalog':'authority']=password;await pool.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);await pool.query(`GRANT ${role} TO ${name} WITH INHERIT FALSE, SET TRUE`);const url=new URL(base);url.username=name;url.password=password;pools.push(new Pool({connectionString:url.toString(),max:maxPoolConnections,connectionTimeoutMillis:5000,query_timeout:30000}));
 }
 report.catalogPermissions={catalog:'dedicated NOINHERIT reader',authority:'dedicated NOINHERIT membership reader',maxPoolConnections};
 return {credentials,target:{host:base.hostname,port:Number(base.port),database:base.pathname.slice(1)},catalogPool:pools[0],authorityPool:pools[1],authorityLogin:'gcni_catalog_authority',seed:count=>seed(pool,count),async close(){await Promise.all(pools.map(p=>p.end()))}};
}
async function seed(pool,count){
 const generation=randomUUID(),asOf=new Date().toISOString(),start=performance.now();let firstId,totalBytes=0;
 const initial=await pool.connect();try{await initial.query('BEGIN');await initial.query('SET LOCAL ROLE c4g_catalog_projection_writer');await initial.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,$3)',[generation,asOf,count]);await initial.query('COMMIT');}catch(e){await initial.query('ROLLBACK');throw e;}finally{initial.release();}
 // Build a batch at a time. Every row passes normal immutable projection and approval triggers.
 for(let offset=0;offset<count;offset+=50){
  const batch=[];
  for(let i=offset;i<Math.min(count,offset+50);i++){
   const s=structuredClone(source);s.description.title.value='Ensaio GCNI '+String(i).padStart(5,'0');const opportunityId=randomUUID(),revisionId=randomUUID();firstId ||= opportunityId;
   const e=emptyExtension(s,{opportunityId,revisionId,extensionId:randomUUID(),acceptanceDigest:'a'.repeat(64),recordedAt:asOf});const p=buildProjection(s,e,{asOf});batch.push({s,e,p,opportunityId,revisionId,digest:contentDigestV2(s)});
  }
  const c=await pool.connect();try{
   await c.query('BEGIN');
   for(const r of batch){await c.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,content_digest,normalization_version,quality_rule_version,current_schema_version) VALUES($1,$2,1,1,'ACTIVE','VALIDATED_MANUAL','Isolated load fixture',$3,'opportunity-normalization-v2','opportunity-quality-v2.0',2)",[r.opportunityId,r.revisionId,r.digest]);await c.query('INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,$4,$4,$5)',[r.revisionId,r.opportunityId,r.s,{synthetic:true},r.digest]);}
   await c.query('SET LOCAL ROLE c4g_catalog_projection_writer');
   for(const {e} of batch)await c.query('INSERT INTO catalog_read.revision_extension(extension_id,opportunity_id,revision_id,source_digest,acceptance_digest,recorded_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[e.extensionId,e.opportunityId,e.revisionId,e.sourceDigest,e.acceptanceDigest,e.recordedAt,e]);
   await c.query('SET LOCAL ROLE c4g_catalog_projection_approver');
   for(const {p} of batch)await c.query("INSERT INTO catalog_read.projection_approval(approval_id,projection_id,extension_id,acceptance_digest,payload_digest,expires_at,reason) VALUES($1,$2,$3,$4,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),clock_timestamp()+interval '30 minutes','Owned synthetic acceptance fixture')",[randomUUID(),p.projectionId,p.extensionId,'a'.repeat(64),p]);
   await c.query('SET LOCAL ROLE c4g_catalog_projection_writer');
   for(const {p} of batch){await c.query('INSERT INTO catalog_read.revision_projection(projection_id,opportunity_id,revision_id,extension_id,mapping_version,as_of,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.projectionId,p.opportunityId,p.revisionId,p.extensionId,p.version,p.asOf,p]);await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[generation,p.opportunityId,p.revisionId,p.projectionId]);}
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  if((offset+50)%1000===0)console.log('SEED '+(offset+50));
 }
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_catalog_projection_writer');await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[generation]);const activated=await c.query('INSERT INTO catalog_read.active_generation(singleton,generation_id) VALUES(true,$1) ON CONFLICT(singleton) DO UPDATE SET generation_id=EXCLUDED.generation_id',[generation]);if(activated.rowCount!==1)throw Error('ISOLATED_GENERATION_NOT_ACTIVATED');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 totalBytes=Number((await pool.query('SELECT sum(octet_length(payload::text))::text AS bytes FROM catalog_read.published_projection WHERE generation_id=$1',[generation])).rows[0].bytes);
 return {count,firstId,storedPayloadBytes:totalBytes,seedMs:Math.round(performance.now()-start)};
}
module.exports={prepare,seed};
