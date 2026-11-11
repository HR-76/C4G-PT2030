'use strict';

// Only the owned native-PostgreSQL launcher may supply configuration on stdin.

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const {randomUUID}=require('node:crypto');

const {Pool}=require('../../../backend/node_modules/pg');

const {buildProjection,emptyExtension,stableId}=require('../../../backend/src/opportunities/catalogRead/model');

const {contentDigestV2}=require('../../../backend/src/opportunities/v2/digests');

const root=path.resolve(__dirname,'../../..');

const report={status:'RUNNING',checks:[],isolated:true,sourceConnections:false,applicationDatabaseAccess:false};

let phase='START';

const check=async(name,fn)=>{phase=name;console.log('PHASE '+name);await fn();report.checks.push({name,status:'PASS'});};

async function main(){

 assert.deepEqual(process.argv.slice(2),['--isolated']);

 const config=JSON.parse(fs.readFileSync(0,'utf8'));

 assert.equal(config.host,'127.0.0.1');assert(config.port>1024&&config.port!==5432);assert.match(config.database,/^gcni_catalog_[a-f0-9]{12}$/);

 const settings={host:config.host,port:config.port,user:config.user,password:config.password,database:'postgres',connectionTimeoutMillis:5000,query_timeout:30000,options:'-c timezone=UTC -c statement_timeout=25000 -c lock_timeout=5000'};

 const admin=new Pool({...settings,max:1});let pool;

 try{

  await check('OWNED_POSTGRES18_CLUSTER',async()=>{

   const r=(await admin.query("SELECT current_setting('data_directory') AS dir, current_setting('server_version') AS version")).rows[0];

   assert.equal(path.resolve(r.dir).toLowerCase(),path.resolve(config.dataDirectory).toLowerCase());assert.match(r.version,/^18\./);report.postgres=r.version;

   const owner=JSON.parse(fs.readFileSync(path.join(path.dirname(config.dataDirectory),'owner.json'),'utf8'));assert.equal(owner.gateId,config.gateId);

   await admin.query('CREATE DATABASE '+config.database+" ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");

   pool=new Pool({...settings,database:config.database,max:5});

  });

  await check('REAL_CENTRAL_BASELINE_AND_V2_CANDIDATE',async()=>{

   for(const role of ['c4g_central_owner','c4g_central_runtime','c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN ${role.startsWith('c4g_central_')?'INHERIT':'NOINHERIT'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);

   await pool.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');

   await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");

   const m=require('../../../backend/src/security/centralMigrationManifest');

   const entries=m.prearchiveManifest;

   await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,entries,m.migrationSql);

   report.baseline=entries.at(-1).version;report.baselineMode='full';



  });

  await check('ISOLATED_SOURCE_CONTROL_QUIESCED',async()=>{for(const state of ['SUSPEND_REQUESTED','QUIESCED'])await pool.query('UPDATE opportunity_catalog.eu_source_control_v2 SET state=$1,fence=fence+1,changed_by=$2,changed_at=clock_timestamp()',[state,randomUUID()]);});

  const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'snapshot-v2.json'),'utf8'));

  const opportunityId=stableId('gate-opp'),revisionId=stableId('gate-rev'),asOf='2027-01-20T12:00:00.000Z';

  const ext=emptyExtension(snapshot,{opportunityId,revisionId,extensionId:stableId('gate-ext'),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T11:00:00.000Z'});

  const projection=buildProjection(snapshot,ext,{asOf});const originalDigest=contentDigestV2(snapshot);

  await check('SEED_EXISTING_V2_REVISION',async()=>{

   const c=await pool.connect();try{await c.query('BEGIN');

    await c.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version,current_schema_version) VALUES($1,$2,1,1,'ACTIVE','VALIDATED_MANUAL','GCNI synthetic',NULL,NULL,NULL,$3,'opportunity-normalization-v2','opportunity-quality-v2.0',2)",[opportunityId,revisionId,originalDigest]);

    await c.query('INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,$4,$5,$6)',[revisionId,opportunityId,snapshot,{synthetic:true},{synthetic:true},originalDigest]);await c.query('COMMIT');

   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}

  });

  const original=(await pool.query('SELECT snapshot,content_digest,created_at::text FROM opportunity_catalog.revision WHERE revision_id=$1',[revisionId])).rows[0];

  await check('PACKAGE_FAILURE_ROLLS_BACK_SQL_AND_LEDGER',async()=>{

   const failing={async connect(){const c=await pool.connect();return {release:()=>c.release(),async query(sql,values){if(sql.startsWith('INSERT INTO public.c4g_schema_migration')&&values[0]==='047_catalog_read_admission_v1')throw Error('INJECTED_PACKAGE_FAILURE');return c.query(sql,values);}};}};

   await assert.rejects(require('./package.cjs').apply(failing),/INJECTED_PACKAGE_FAILURE/);

   assert.equal((await pool.query("SELECT to_regnamespace('catalog_read') IS NULL AS absent")).rows[0].absent,true);

   assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.c4g_schema_migration WHERE version LIKE '04%catalog_read%'")).rows[0].n,0);

  });

  await check('UPGRADE_FROM_PREVIOUS_ISOLATED_PACKAGE',async()=>{
   const pkg=require('./package.cjs'),c=await pool.connect();try{await c.query('BEGIN');for(const e of pkg.entries.slice(0,2)){const m=pkg.load(e.version,'up');await c.query(m.sql);await c.query('INSERT INTO public.c4g_schema_migration(version,checksum_sha256,irreversible) VALUES($1,$2,$3)',[e.version,m.checksum,e.irreversible]);}await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   report.upgrade=await pkg.apply(pool);assert.deepEqual(report.upgrade.applied,['048_catalog_read_service_v1']);
  });
  await check('ADDITIVE_CANDIDATE_NO_HISTORY_CHANGE',async()=>{

   report.package=await require('./package.cjs').apply(pool);

   assert.deepEqual((await pool.query('SELECT snapshot,content_digest,created_at::text FROM opportunity_catalog.revision WHERE revision_id=$1',[revisionId])).rows[0],original);

  });

  report.catalogFingerprint=await require('./package.cjs').fingerprint(pool);

  await check('REGISTERED_ISOLATED_PACKAGE_REPLAY',async()=>assert.deepEqual((await require('./package.cjs').apply(pool)).applied,[]));

  await check('PACKAGE_REJECTS_LEDGER_AND_PERMISSION_DRIFT',async()=>{

   const pkg=require('./package.cjs');

   for(const sql of ["GRANT UPDATE ON catalog_read.revision_projection TO c4g_catalog_projection_reader","ALTER TABLE catalog_read.revision_projection DISABLE TRIGGER projection_approval_required","GRANT SELECT(payload) ON catalog_read.revision_extension TO c4g_catalog_projection_reader"]){

    const c=await pool.connect();try{await c.query('BEGIN');await c.query(sql);await assert.rejects(pkg.admit(c),/DRIFT/);}finally{await c.query('ROLLBACK');c.release();}

   }

   const version=pkg.entries.at(-1).version,checksum=pkg.load(version,'up').checksum;

   try{await pool.query('UPDATE public.c4g_schema_migration SET checksum_sha256=$1 WHERE version=$2',['0'.repeat(64),version]);await assert.rejects(pkg.apply(pool),/metadata differs/);}finally{await pool.query('UPDATE public.c4g_schema_migration SET checksum_sha256=$1 WHERE version=$2',[checksum,version]);}

   await pkg.admit(pool);

  });

  const tx=async(role,fn)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE '+role);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};

  const writer=fn=>tx('c4g_catalog_projection_writer',fn),reader=fn=>tx('c4g_catalog_projection_reader',fn);

  const insertExt=(c,e)=>c.query('INSERT INTO catalog_read.revision_extension(extension_id,opportunity_id,revision_id,source_digest,acceptance_digest,recorded_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[e.extensionId,e.opportunityId,e.revisionId,e.sourceDigest,e.acceptanceDigest,e.recordedAt,e]);

  const approve=async(p,{ttlMillis=3600000,acceptanceDigest=ext.acceptanceDigest}={})=>{const aid=randomUUID();await tx('c4g_catalog_projection_approver',c=>c.query("INSERT INTO catalog_read.projection_approval(approval_id,projection_id,extension_id,acceptance_digest,payload_digest,expires_at,reason) VALUES($1,$2,$3,$4,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),clock_timestamp()+$6*interval '1 millisecond','Isolated fixture approval')",[aid,p.projectionId,p.extensionId,acceptanceDigest,p,ttlMillis]));return aid;};

  const insertProjection=(c,p)=>c.query('INSERT INTO catalog_read.revision_projection(projection_id,opportunity_id,revision_id,extension_id,mapping_version,as_of,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.projectionId,p.opportunityId,p.revisionId,p.extensionId,p.version,p.asOf,p]);

  await check('PERSIST_VALID_EXTENSION_AND_PROJECTION',async()=>{

   await writer(c=>insertExt(c,ext));await assert.rejects(writer(c=>insertProjection(c,projection)),{code:'42501'});await approve(projection);await writer(c=>insertProjection(c,projection));

   const stored=(await pool.query('SELECT payload FROM catalog_read.revision_projection WHERE projection_id=$1',[projection.projectionId])).rows[0].payload;assert.deepEqual(stored,projection);

  });

  await check('REPLAY_AND_CHANGED_REPLAY',async()=>{

   const retry=async p=>writer(async c=>{

    await c.query('INSERT INTO catalog_read.revision_projection(projection_id,opportunity_id,revision_id,extension_id,mapping_version,as_of,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(projection_id) DO NOTHING',[p.projectionId,p.opportunityId,p.revisionId,p.extensionId,p.version,p.asOf,p]);

    const row=(await c.query('SELECT payload=$2::jsonb AS identical FROM catalog_read.revision_projection WHERE projection_id=$1',[p.projectionId,p])).rows[0];if(!row.identical)throw Error('REPLAY_CONTENT_MISMATCH');

   });

   await retry(projection);const changed=structuredClone(projection);changed.detail.summary.title.value='Changed';await assert.rejects(retry(changed),{code:'42501'});

   assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_read.revision_projection')).rows[0].n,1);

  });

  const genA=randomUUID(),genB=randomUUID();

  await check('BUILDING_GENERATION_IS_INVISIBLE',async()=>{

   await writer(async c=>{await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,1)',[genA,asOf]);await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[genA,opportunityId,revisionId,projection.projectionId]);});

   assert.equal((await reader(c=>c.query('SELECT * FROM catalog_read.published_projection'))).rowCount,0);

   await assert.rejects(writer(c=>c.query('INSERT INTO catalog_read.active_generation VALUES(true,$1)',[genA])),{code:'23514'});

  });

  await check('ATOMIC_PUBLICATION_AND_SEALED_GENERATION',async()=>{

   await writer(async c=>{await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[genA]);await c.query('INSERT INTO catalog_read.active_generation VALUES(true,$1)',[genA]);});

   assert.equal((await reader(c=>c.query('SELECT * FROM catalog_read.published_projection'))).rowCount,1);

   await assert.rejects(writer(c=>c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[genA,opportunityId,revisionId,projection.projectionId])),{code:'55000'});

   await assert.rejects(writer(c=>c.query('UPDATE catalog_read.generation SET expected_count=2 WHERE generation_id=$1',[genA])),{code:'55000'});

  });

  await check('INCOMPLETE_PUBLICATION_ROLLS_BACK',async()=>{

   await assert.rejects(writer(async c=>{await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,2)',[genB,asOf]);await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[genB]);}),{code:'23514'});

   assert.equal((await pool.query('SELECT * FROM catalog_read.generation WHERE generation_id=$1',[genB])).rowCount,0);

  });

  await check('READER_HAS_NO_WRITE_OR_PRIVATE_BASE_TABLE_ACCESS',async()=>{

   for(const sql of ['SELECT * FROM catalog_read.revision_extension','SELECT * FROM catalog_read.revision_projection','SELECT * FROM opportunity_catalog.revision','UPDATE catalog_read.active_generation SET singleton=true','TRUNCATE catalog_read.revision_projection'])await assert.rejects(reader(c=>c.query(sql)),{code:'42501'});

   assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname LIKE 'c4g_catalog_projection_%'")).rows[0].n,0);

  });

  await check('IMMUTABLE_CONTENT_AND_CROSS_REVISION_REJECTION',async()=>{

   await assert.rejects(tx('c4g_catalog_projection_owner',c=>c.query('UPDATE catalog_read.revision_projection SET payload=payload')),{code:'55000'});

   await assert.rejects(tx('c4g_catalog_projection_owner',c=>c.query('DELETE FROM catalog_read.revision_extension')),{code:'55000'});

   await assert.rejects(tx('c4g_catalog_projection_owner',c=>c.query('TRUNCATE catalog_read.generation CASCADE')),{code:'55000'});

   const wrong=structuredClone(ext);wrong.extensionId=randomUUID();wrong.sourceDigest='b'.repeat(64);await assert.rejects(writer(c=>insertExt(c,wrong)),{code:'23514'});

   const wrongRevision=structuredClone(projection);wrongRevision.projectionId=randomUUID();wrongRevision.revisionId=randomUUID();wrongRevision.detail.summary.revisionId=wrongRevision.revisionId;

   await approve(wrongRevision);await assert.rejects(writer(c=>insertProjection(c,wrongRevision)),{code:'23503'});

  });

  await check('SECOND_GENERATION_PRESERVES_FIRST',async()=>{

   const p2=buildProjection(snapshot,ext,{asOf:'2027-01-20T12:01:00.000Z'});await approve(p2);

   await writer(async c=>{await insertProjection(c,p2);await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,1)',[genB,p2.asOf]);await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[genB,opportunityId,revisionId,p2.projectionId]);await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[genB]);await c.query('UPDATE catalog_read.active_generation SET generation_id=$1 WHERE singleton',[genB]);});

   assert.deepEqual((await reader(c=>c.query('SELECT payload FROM catalog_read.published_projection WHERE generation_id=$1',[genA]))).rows[0].payload,projection);

   assert.equal((await reader(c=>c.query('SELECT generation_id FROM catalog_read.current_generation'))).rows[0].generation_id,genB);

  });

  await check('CONCURRENT_READER_NEVER_SEES_UNCOMMITTED_PUBLICATION',async()=>{

   const c=await pool.connect(),g=randomUUID();

   try{

    await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_catalog_projection_writer');

    await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,1)',[g,asOf]);

    await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[g,opportunityId,revisionId,projection.projectionId]);

    await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[g]);

    await c.query('UPDATE catalog_read.active_generation SET generation_id=$1 WHERE singleton',[g]);

    assert.equal((await reader(r=>r.query('SELECT generation_id FROM catalog_read.current_generation'))).rows[0].generation_id,genB);

    assert.equal((await reader(r=>r.query('SELECT * FROM catalog_read.published_projection WHERE generation_id=$1',[g]))).rowCount,0);

    await c.query('ROLLBACK');

    assert.equal((await pool.query('SELECT * FROM catalog_read.generation WHERE generation_id=$1',[g])).rowCount,0);

   }finally{await c.query('ROLLBACK');c.release();}

  });

  await check('WRITER_CANNOT_APPROVE_OR_MUTATE_APPROVAL_HISTORY',async()=>{

   for(const sql of ["INSERT INTO catalog_read.projection_approval SELECT * FROM catalog_read.projection_approval","INSERT INTO catalog_read.approval_revocation SELECT * FROM catalog_read.approval_revocation","UPDATE catalog_read.projection_approval SET reason='Forged'","SELECT catalog_read.assert_projection_approved(NULL,NULL,NULL)"])

    await assert.rejects(writer(c=>c.query(sql)),{code:'42501'});

   await assert.rejects(tx('c4g_catalog_projection_owner',c=>c.query("UPDATE catalog_read.projection_approval SET reason='Changed'")),{code:'55000'});

  });

  let tick=2;

  const nextProjection=()=>buildProjection(snapshot,ext,{asOf:`2027-01-20T12:${String(tick++).padStart(2,'0')}:00.000Z`});

  const publish=async p=>writer(async c=>{const g=randomUUID();await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,1)',[g,p.asOf]);await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[g,p.opportunityId,p.revisionId,p.projectionId]);await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[g]);});

  await check('EXPIRED_REVOKED_AND_WRONG_ACCEPTANCE_REJECTED',async()=>{

   const expired=nextProjection();await approve(expired,{ttlMillis:30});await pool.query('SELECT pg_sleep(0.05)');await assert.rejects(writer(c=>insertProjection(c,expired)),{code:'42501'});

   const wrong=nextProjection();await approve(wrong,{acceptanceDigest:'b'.repeat(64)});await assert.rejects(writer(c=>insertProjection(c,wrong)),{code:'42501'});

   const revoked=nextProjection(),aid=await approve(revoked);await writer(c=>insertProjection(c,revoked));

   await tx('c4g_catalog_projection_approver',c=>c.query("INSERT INTO catalog_read.approval_revocation(approval_id,reason) VALUES($1,'Withdrawn in isolated test')",[aid]));

   await assert.rejects(publish(revoked),{code:'42501'});

  });

  await check('MATERIAL_CONFLICT_CANNOT_BE_PUBLISHED',async()=>{

   const e=structuredClone(ext);e.extensionId=randomUUID();const evid=projection.collections.evidence[0].id;

   e.conflicts.items=[{id:randomUUID(),fieldPath:'financing.support',scopeLabel:'Apoio',severity:'material',status:'unresolved',reason:'Synthetic divergence',alternatives:[{id:randomUUID(),valueText:'100',evidenceIds:[evid]},{id:randomUUID(),valueText:'200',evidenceIds:[evid]}],selectedAlternativeId:null,decision:null}];

   const p=buildProjection(snapshot,e,{asOf});await writer(c=>insertExt(c,e));await approve(p);await writer(c=>insertProjection(c,p));await assert.rejects(publish(p),{code:'23514'});

  });

  await check('REVOCATION_SERIALIZES_WITH_PUBLICATION',async()=>{

   const p=nextProjection(),aid=await approve(p);await writer(c=>insertProjection(c,p));const c=await pool.connect();

   try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_catalog_projection_writer');const g=randomUUID();await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,1)',[g,p.asOf]);await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)',[g,p.opportunityId,p.revisionId,p.projectionId]);await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1",[g]);

    await assert.rejects(tx('c4g_catalog_projection_approver',async a=>{await a.query("SET LOCAL lock_timeout='100ms'");await a.query("INSERT INTO catalog_read.approval_revocation(approval_id,reason) VALUES($1,'Concurrent withdrawal')",[aid]);}),{code:'55P03'});

   }finally{await c.query('ROLLBACK');c.release();}

   await tx('c4g_catalog_projection_approver',c=>c.query("INSERT INTO catalog_read.approval_revocation(approval_id,reason) VALUES($1,'Withdrawal after rollback')",[aid]));await assert.rejects(publish(p),{code:'42501'});

  });

  await check('REAL_LIMITED_LOGINS_AND_MEMBERSHIP_REVOCATION',async()=>{

   const connections=[];assert.match(config.password,/^[a-f0-9]{64}$/);

   try{

    for(const name of ['reader','writer','approver']){

     const login='gcni_gate_'+name,role='c4g_catalog_projection_'+name;

     await pool.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${config.password}'`);

     await pool.query(`GRANT ${role} TO ${login} WITH INHERIT FALSE, SET TRUE`);

     const p=new Pool({...settings,database:config.database,user:login,max:1});connections.push(p);

     const c=await p.connect();try{

      assert.equal((await c.query('SELECT rolsuper FROM pg_roles WHERE rolname=session_user')).rows[0].rolsuper,false);

      await assert.rejects(c.query('SELECT * FROM catalog_read.published_projection'),{code:'42501'});

      await c.query('BEGIN');await c.query('SET LOCAL ROLE '+role);

      if(name==='reader')assert.equal((await c.query('SELECT * FROM catalog_read.current_generation')).rowCount,1);

      else if(name==='writer')assert((await c.query('SELECT * FROM catalog_read.revision_projection')).rowCount>0);

      else {

       assert((await c.query('SELECT * FROM catalog_read.projection_approval')).rowCount>0);

       const audit=(await c.query("INSERT INTO catalog_read.projection_approval(approval_id,projection_id,extension_id,acceptance_digest,payload_digest,approved_by,approved_at,expires_at,reason) VALUES($1,$2,$3,$4,$5,'forged_actor','1970-01-01',clock_timestamp()+interval '1 hour','Actor binding test') RETURNING approved_by,approved_at",[randomUUID(),randomUUID(),ext.extensionId,ext.acceptanceDigest,'f'.repeat(64)])).rows[0];

       assert.equal(audit.approved_by,login);assert(audit.approved_at.getUTCFullYear()>2020);

      }

      await c.query('COMMIT');

      await assert.rejects(c.query('SET ROLE c4g_catalog_projection_owner'),{code:'42501'});

      await assert.rejects(c.query('SET ROLE '+(name==='writer'?'c4g_catalog_projection_approver':'c4g_catalog_projection_writer')),{code:'42501'});

      await pool.query(`REVOKE ${role} FROM ${login}`);await assert.rejects(c.query('SET ROLE '+role),{code:'42501'});

     }finally{c.release();}

    }

   }finally{for(const p of connections)await p.end();for(const name of ['reader','writer','approver'])await pool.query('DROP ROLE IF EXISTS gcni_gate_'+name);}

   await require('./package.cjs').admit(pool);

  });

  await check('REVOKED_APPROVAL_BLOCKS_REACTIVATION_PRESERVING_HISTORY',async()=>{

   const aid=(await pool.query('SELECT approval_id FROM catalog_read.projection_approval WHERE projection_id=$1',[projection.projectionId])).rows[0].approval_id;

   await tx('c4g_catalog_projection_approver',c=>c.query("INSERT INTO catalog_read.approval_revocation(approval_id,reason) VALUES($1,'Historical projection not eligible for reactivation')",[aid]));

   await assert.rejects(writer(c=>c.query('UPDATE catalog_read.active_generation SET generation_id=$1',[genA])),{code:'42501'});

   assert.equal((await reader(c=>c.query('SELECT generation_id FROM catalog_read.current_generation'))).rows[0].generation_id,genB);

   assert.deepEqual((await reader(c=>c.query('SELECT payload FROM catalog_read.published_projection WHERE generation_id=$1',[genA]))).rows[0].payload,projection);

  });

  await check('FINANCIAL_RANGES_PERSIST_EXACTLY',async()=>{

   const source=structuredClone(snapshot);

   source.financing.rates={state:'PRESENT',value:[{minimumPercent:'12.12345678',maximumPercent:'85',scope:'PME',conditions:'Região e dimensão'}],evidenceRefs:['budget'],reason:null};

   source.financing.eligibleCosts={state:'PRESENT',value:[{minimum:'0',maximum:'999999999999999999999999.12345678',currency:structuredClone(source.financing.support.value[0].currency),scope:'Operação',conditions:'Despesa validada'}],evidenceRefs:['budget'],reason:null};

   const rid=randomUUID(),e=emptyExtension(source,{...ext,revisionId:rid,extensionId:randomUUID()});

   const p=buildProjection(source,e,{asOf});

   await pool.query('INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,2,2,$3,$4,$5,$6)',[rid,opportunityId,source,{synthetic:true},{synthetic:true},contentDigestV2(source)]);

   await writer(c=>insertExt(c,e));await approve(p);await writer(c=>insertProjection(c,p));

   const stored=(await pool.query('SELECT payload FROM catalog_read.revision_projection WHERE projection_id=$1',[p.projectionId])).rows[0].payload;

   assert.deepEqual(stored,p);assert.match(stored.collections.fundingRules[1].conditions,/12.12345678%/);assert.match(stored.collections.fundingRules[2].conditions,/999999999999999999999999.12345678/);

   assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[rid])).rows[0].snapshot,source);

  });

  report.load=await require('./read-http-proof.cjs').run({pool,settings,config,check,writer,approve,insertExt,insertProjection});
  await check('FINAL_ADMISSION_AND_SOURCE_SUSPENSION',async()=>{

   await require('./package.cjs').admit(pool);

   assert.equal((await pool.query('SELECT state FROM opportunity_catalog.eu_source_control_v2')).rows[0].state,'QUIESCED');

   assert.equal((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_run')).rows[0].n,0);

  });

  await check('FINAL_CORE_HISTORY_UNCHANGED',async()=>assert.deepEqual((await pool.query('SELECT snapshot,content_digest,created_at::text FROM opportunity_catalog.revision WHERE revision_id=$1',[revisionId])).rows[0],original));

  report.status=report.load&&report.load.status!=='PASS'?'NOT_ACCEPTED':'PASS';

 }catch(error){report.status='FAIL';report.phase=phase;report.error={code:error.code||'GATE_FAILED',message:String(error.message).slice(0,1200),measured:error.measured};}

 finally{await Promise.allSettled([pool,admin].filter(Boolean).map(p=>p.end()));}

 console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=1;

}

main().catch(e=>{console.log(JSON.stringify({status:'FAIL',phase,error:{code:e.code||'START_FAILED',message:String(e.message).slice(0,1000)}}));process.exitCode=1;});

