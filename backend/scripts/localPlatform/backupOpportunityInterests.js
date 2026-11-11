'use strict';
// Backup only. Restores are restricted to a newly initialized local cluster.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createHash,randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const cfg=require('./config');
const {target,baselineManifest}=require('./prepareOpportunityInterests');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
const {preflightTenant}=require('../../src/security/tenantMigrationPreflight');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../src/security/tenantSchemaFingerprint');
const BIN='C:/Program Files/PostgreSQL/18/bin';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function args(argv){assert.deepEqual(argv,['--backup-and-restore']);}
function run(exe,argv,env={},input){
 const r=spawnSync(exe,argv,{env:{...process.env,...env},input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:32*1024*1024,
  stdio:path.basename(exe).toLowerCase()==='pg_ctl.exe'?'ignore':'pipe'});
 if(r.status!==0)throw Error('BACKUP_TOOL_FAILED_'+path.basename(exe).replace(/[^a-z0-9]/gi,'_').toUpperCase());
 return r.stdout;
}
function pg(exe,argv,connection,input){return run(path.join(BIN,exe+'.exe'),argv,connection?{PGPASSWORD:connection.password,PGOPTIONS:'-c timezone=UTC'}:{},input);}
const connectionArgs=c=>['--no-password','-h',c.host,'-p',String(c.port),'-U',c.user];
function protect(folder){
 fs.mkdirSync(folder);
 const sid=run('whoami',['/user','/fo','csv','/nh']).match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
 run('icacls',[folder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
 // Verify the effective DACL before placing any private data here.
 const escaped=folder.replaceAll("'","''");
 const check=run('powershell',['-NoProfile','-Command',`$a=Get-Acl -LiteralPath '${escaped}'; if(-not $a.AreAccessRulesProtected){exit 2}; foreach($r in $a.Access){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($s -notin @('${sid}','S-1-5-18') -or $r.AccessControlType -ne 'Allow'){exit 3}}`]);
 return check;
}
async function snapshot(client){
 const tables=(await client.query(`SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2`)).rows;
 const data={};
 for(const t of tables){const name=quote(t.nspname)+'.'+quote(t.relname);
  const rows=(await client.query(`SELECT to_jsonb(t)::text AS value FROM ${name} t`)).rows.map(r=>r.value).sort();
  data[name]={count:rows.length,digest:hash(JSON.stringify(rows))};
 }
 const sequences={};
 const names=(await client.query(`SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' ORDER BY 1,2`)).rows;
 for(const t of names){const name=quote(t.schemaname)+'.'+quote(t.sequencename);sequences[name]=(await client.query(`SELECT last_value::text,is_called FROM ${name}`)).rows[0];}
 const largeObjects=(await client.query('SELECT count(*)::int AS count FROM pg_largeobject_metadata')).rows[0].count;
 // Do not silently omit a data class from verification.
 assert.equal(largeObjects,0);
 return {data,sequences,largeObjects};
}
function assertCopy(a,b){assert.deepEqual(b,a,'BACKUP_RESTORE_CONTENT_MISMATCH');}
function aclSupplement(expected,actual){
 const a=new Set(expected.map(JSON.stringify)),b=new Set(actual.map(JSON.stringify));
 assert(actual.every(row=>a.has(JSON.stringify(row))),'RESTORE_ACL_EXTRA');
 return expected.filter(row=>!b.has(JSON.stringify(row))).map(row=>{
  assert(['band_policy','derivation_policy'].includes(row.object_name)
   && row.grantee==='c4g_organization_profile_owner' && row.is_grantable===false
   && ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(row.privilege_type),'RESTORE_ACL_UNEXPECTED');
  return `GRANT ${row.privilege_type} ON TABLE organization_profile.${quote(row.object_name)} TO c4g_organization_profile_owner;\n`;
 }).join('');
}
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
async function ready(pool){for(let i=0;i<40;i++){try{await pool.query('SELECT 1');return;}catch{await new Promise(r=>setTimeout(r,250));}}throw Error('ISOLATED_POSTGRES_NOT_READY');}
function ownedCluster(folder,cluster,marker){
 assert.equal(path.dirname(path.resolve(cluster)),path.resolve(folder));
 assert.equal(path.basename(cluster),'restore-cluster');
 assert.equal(fs.readFileSync(path.join(folder,'restore-owner.txt'),'utf8'),marker);
}
async function main(argv=process.argv.slice(2)){
 args(argv);const config=cfg.readConfig(),runtimeFile=path.join(cfg.folder,'runtime.json');
 const state=JSON.parse(fs.readFileSync(runtimeFile));target(config,state);
 const marker=randomUUID(),folder=path.join(cfg.folder,'interest-backup-'+marker),cluster=path.join(folder,'restore-cluster');
 protect(folder);fs.writeFileSync(path.join(folder,'restore-owner.txt'),marker);
 const report={status:'IN_PROGRESS',createdAt:new Date().toISOString(),backup:path.relative(cfg.root,folder),aclRestricted:true,databases:{},configuration:{},cleanup:false};
 const publicFile=path.join(cfg.root,'output/organizational-opportunity-interest/backup-restore-'+marker+'.json');
 const sources={},restored={};let admin,started=false;
 const temporary={host:'127.0.0.1',port:await freePort(),user:'postgres',password:randomBytes(32).toString('hex')};
 assert.notEqual(temporary.port,config.port);
 const privateFiles=['backend/.env','.tmp/local-platform/runtime.json','.tmp/local-platform/admissions/worker.json',
  '.tmp/local-platform/members/worker.json','.tmp/local-platform/members/http.json',
  '.tmp/local-platform/members/c4g-activation.properties','.tmp/f2-integration/.env'];
 const copies=[];
 try{
  for(const relative of privateFiles){const source=path.join(cfg.root,relative);if(!fs.existsSync(source))continue;
   const destination=path.join(folder,'configuration',relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);
   copies.push({relative,source,destination,digest:fileHash(source)});assert.equal(fileHash(destination),fileHash(source));
  }
  assert.equal(copies.filter(f=>f.relative==='backend/.env'||f.relative.endsWith('/runtime.json')).length,2);
  for(const [name,database] of [['central',config.centralDatabase],['tenant',config.tenantDatabase]]){
   const pool=sources[name]=new Pool({...cfg.connection(config,database),max:1,options:'-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000'});
   const version=(await pool.query('SHOW server_version_num')).rows[0].server_version_num;assert.equal(Math.floor(Number(version)/10000),18);
   const client=await pool.connect();
   try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const id=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;assert.match(id,/^[0-9A-F-]+$/i);
    const before=await snapshot(client);const file=path.join(folder,name+'.dump');
    pg('pg_dump',[...connectionArgs(config),'--format=custom','--create','--snapshot='+id,'--lock-wait-timeout=15000','-f',file,database],config);
    pg('pg_restore',['--list',file]);
    const schema=name==='tenant'?await tenantSchemaSnapshot(client):null;
    report.databases[name]={database,bytes:fs.statSync(file).size,sha256:fileHash(file),tables:Object.keys(before.data).length,rows:Object.values(before.data).reduce((sum,t)=>sum+t.count,0)};
    cfg.saveState({before,schema},path.join(folder,name+'-inventory.json'));
    await client.query('ROLLBACK');
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  // No password hashes leave the source cluster. Login secrets remain in protected configuration copies.
  const roles=pg('pg_dumpall',[...connectionArgs(config),'--roles-only','--no-role-passwords'],config);
  fs.writeFileSync(path.join(folder,'roles.sql'),roles);
  const passFile=path.join(folder,'restore-password');fs.writeFileSync(passFile,temporary.password);
  pg('initdb',['-D',cluster,'-U','postgres','--pwfile='+passFile,'--auth=scram-sha-256','--encoding=UTF8','--locale-provider=icu','--icu-locale=und']);
  fs.appendFileSync(path.join(cluster,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${temporary.port}\ntimezone='UTC'\n`);
  ownedCluster(folder,cluster,marker);
  pg('pg_ctl',['-D',cluster,'-l',path.join(folder,'restore-server.log'),'-w','-t','30','start']);started=true;
  admin=new Pool({...temporary,database:'postgres',max:1,connectionTimeoutMillis:2000});await ready(admin);
  // initdb already creates postgres. Keep every other dumped role and membership.
  const restoreRoles=roles.replace(/^CREATE ROLE postgres;\r?\n/m,'');assert.notEqual(restoreRoles,roles);
  pg('psql',[...connectionArgs(temporary),'-d','postgres','-v','ON_ERROR_STOP=1'],temporary,restoreRoles);
  for(const name of ['central','tenant']){
   const item=report.databases[name],file=path.join(folder,name+'.dump');assert.equal(fileHash(file),item.sha256);
   pg('pg_restore',[...connectionArgs(temporary),'--exit-on-error','--create','-d','postgres',file],temporary);
   const pool=restored[name]=new Pool({...temporary,database:item.database,max:1,options:'-c timezone=UTC',connectionTimeoutMillis:5000});
   const expected=JSON.parse(fs.readFileSync(path.join(folder,name+'-inventory.json')));
   assertCopy(expected.before,await snapshot(pool));item.dataMatches=true;
   if(name==='tenant'){
    const observed=await tenantSchemaSnapshot(pool);
    const supplement=aclSupplement(expected.schema.organizationProfileSecurity.authoringAcl,observed.organizationProfileSecurity.authoringAcl);
    fs.writeFileSync(path.join(folder,'tenant-restore-acl.sql'),supplement);
    if(supplement)await pool.query(supplement);
    item.aclSupplement={statements:supplement.split('\n').filter(Boolean).length,sha256:hash(supplement)};
    assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(pool)),tenantSchemaFingerprint(expected.schema));
    const proof=await preflightTenant(pool,{tenantId:state.tenantId,databaseGenerationId:state.generationId},baselineManifest('030_organization_notices'),{timeoutMs:30000});
    item.version=proof.currentVersion;item.fingerprint=proof.schemaFingerprint;
   }else{const proof=await preflightCentral(pool);item.version=proof.currentVersion;item.fingerprint=proof.fingerprint;}
   item.preflight=true;
   // Live consumers remain running. Their later writes do not invalidate the
   // exported snapshot, but make a fresh backup mandatory before activation.
   const latest=await snapshot(sources[name]);
   item.sourceStillMatches=JSON.stringify(expected.before)===JSON.stringify(latest);
   item.sourceChangedTables=Object.keys({...expected.before.data,...latest.data}).filter(key=>JSON.stringify(expected.before.data[key])!==JSON.stringify(latest.data[key]));
  }
  for(const item of copies){assert.equal(fileHash(item.source),item.digest);assert.equal(fileHash(item.destination),item.digest);report.configuration[item.relative]={copied:true,sha256:item.digest};}
  report.activationRequiresFreshBackup=Object.values(report.databases).some(item=>!item.sourceStillMatches);
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'BACKUP_RESTORE_VALIDATION_FAILED';throw error;}
 finally{
  await Promise.allSettled([...Object.values(sources),...Object.values(restored),admin].filter(Boolean).map(p=>p.end()));
  try{if(fs.existsSync(path.join(cluster,'postmaster.pid'))){ownedCluster(folder,cluster,marker);pg('pg_ctl',['-D',cluster,'-m','fast','-w','-t','30','stop']);}
   assert(!fs.existsSync(path.join(cluster,'postmaster.pid')));report.cleanup=true;
  }catch{report.cleanup=false;report.status='FAIL';report.failure='ISOLATED_CLUSTER_STOP_FAILED';}
  report.completedAt=new Date().toISOString();cfg.saveState(report,path.join(folder,'verification.json'));cfg.saveState(report,publicFile);
  console.log(JSON.stringify({status:report.status,cleanup:report.cleanup,backup:report.backup,evidence:path.relative(cfg.root,publicFile)}));
 }
 if(report.status!=='PASS')throw Error(report.failure||'BACKUP_RESTORE_FAILED');
 return report;
}
if(require.main===module)main().catch(()=>{console.error('BACKUP_RESTORE_FAILED_SEE_SANITIZED_REPORT');process.exitCode=1;});
module.exports={args,assertCopy,aclSupplement,ownedCluster,main};
