'use strict';
// Explicit, additive local account operation. No realm reset or existing password changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Pool}=require('pg'),cfg=require('./config'),{identityAdmin}=require('./optionalIdentity');
function parse(args){
 const values={};for(let i=0;i<args.length;i++){const key=args[i];if(!['--email','--name','--apply'].includes(key)||Object.hasOwn(values,key))throw Error('ACCOUNT_ARGUMENT_INVALID');values[key]=key==='--apply'?true:args[++i];}
 const email=values['--email'],name=values['--name'];
 if(typeof email!=='string'||email!==email.toLowerCase()||! /^[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)||email.length>200||typeof name!=='string'||!name.trim()||name.length>100)throw Error('ACCOUNT_ARGUMENT_INVALID');
 return {email,name:name.trim(),apply:Boolean(values['--apply'])};
}
async function main(){
 const {email,name,apply}=parse(process.argv.slice(2)),config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json')));
 assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.port,5432);assert.equal(state.identity.realm,'c4g-native-local');assert.equal(state.identity.origin,'http://localhost:3000');
 const env=require('dotenv').parse(fs.readFileSync(path.join(cfg.root,'.tmp/f2-integration/.env'))),admin=await identityAdmin(env),realm=await admin(state.identity.realm);
 assert.equal(realm.attributes?.['c4g.local.installation'],state.installationId);
 const kc=(route,method,body)=>admin(state.identity.realm+'/'+route,method,body);
 const directory=path.join(cfg.folder,'named-admins'),file=path.join(directory,email.replace('@','-at-')+'.json');
 let record=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 if(record)assert(record.email===email&&record.installationId===state.installationId&&record.issuer===state.identity.issuer);
 let users=await kc('users?username='+encodeURIComponent(email)+'&exact=true');
 const emailUsers=await kc('users?email='+encodeURIComponent(email)+'&exact=true');
 if(users.length>1||emailUsers.some(u=>!users.some(x=>x.id===u.id))||users.length&&(!record||users[0].id!==record.subject))throw Error('ACCOUNT_ALREADY_EXISTS_REVIEW_REQUIRED');
 const pool=new Pool(cfg.connection(config,config.centralDatabase));
 const authority=new Pool({...cfg.connection(config,config.centralDatabase),user:'c4g_authority_runtime',password:state.authorityPassword});
 try{
  const admitted=await require('../../src/security/centralMigrationPreflight').preflightCentral(pool);
  if(!require('../../src/security/centralMigrationManifest').supportsCentralVersion(admitted.currentVersion,'028_catalog_identity_authority'))throw Error('IDENTITY_SCHEMA_REQUIRED');
  const coordinator=require('../../src/security/authorityCoordinator').createAuthorityCoordinator({pool:authority,permitSecret:state.permitSecret});
  const collisions=(await pool.query('SELECT id FROM public.global_user WHERE lower(primary_email)=lower($1)',[email])).rows;
  if(collisions.some(u=>u.id!==record?.globalUserId))throw Error('ACCOUNT_EMAIL_ALREADY_BOUND');
  if(!apply){console.log(JSON.stringify({status:'READY',existing:users.length===1,platformRole:'C4G_ADMIN',privateMembershipsPlanned:0}));return;}
  fs.mkdirSync(directory,{recursive:true});
  const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=identity.stdout.match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
  assert.equal(spawnSync('icacls',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true}).status,0);
  if(!record){record={installationId:state.installationId,email,username:email,displayName:name,issuer:state.identity.issuer,globalUserId:randomUUID(),identityRefId:randomUUID(),assignmentId:randomUUID(),password:randomBytes(24).toString('base64url')+'aA7!',temporary:true,subject:null,createdAt:new Date().toISOString(),status:'PREPARED'};cfg.saveState(record,file);}
  if(!users.length){
   const parts=name.split(/\s+/);const subject=await kc('users','POST',{username:email,email,emailVerified:false,enabled:true,firstName:parts[0],lastName:parts.slice(1).join(' ')||'C4G',
    attributes:{'c4g.local.installation':[state.installationId]},requiredActions:['UPDATE_PASSWORD'],credentials:[{type:'password',value:record.password,temporary:true}]});
   record.subject=subject;record.status='IDENTITY_CREATED';cfg.saveState(record,file);users=[await kc('users/'+subject)];
  }
  assert.equal(users[0].attributes?.['c4g.local.installation']?.[0],state.installationId);assert.equal(users[0].username,email);assert.equal(users[0].email,email);assert.equal(users[0].enabled,true);
  const digest=async(table,where='',values=[])=>createHash('sha256').update(JSON.stringify((await pool.query(`SELECT to_jsonb(t)::text row FROM public.${table} t ${where} ORDER BY to_jsonb(t)::text`,values)).rows)).digest('hex');
  const before={memberships:await digest('organization_membership'),grants:await digest('authority_f5_state'),users:await digest('global_user','WHERE id<>$1',[record.globalUserId]),admins:await digest('platform_admin_assignment','WHERE global_user_id<>$1',[record.globalUserId])};
  const client=await pool.connect();try{
   await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(43001306,1)');
   await client.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(id) DO NOTHING",[record.globalUserId,record.displayName,email]);
   await client.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO NOTHING',[record.identityRefId,record.globalUserId,record.issuer,record.subject]);
   const linked=(await client.query('SELECT global_user_id FROM public.auth_identity_ref WHERE issuer=$1 AND subject=$2',[record.issuer,record.subject])).rows[0];assert.equal(linked?.global_user_id,record.globalUserId);
   await client.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE') ON CONFLICT(id) DO NOTHING",[record.assignmentId,record.globalUserId]);
   const role=(await client.query('SELECT global_user_id,role_code,status FROM public.platform_admin_assignment WHERE id=$1',[record.assignmentId])).rows[0];assert.deepEqual(role,{global_user_id:record.globalUserId,role_code:'C4G_ADMIN',status:'ACTIVE'});
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  const resolved=await require('../../src/security/identityRepository').createIdentityRepository(coordinator).resolve({iss:record.issuer,sub:record.subject});assert.equal(resolved?.id,record.globalUserId);assert.deepEqual(resolved.platformRoles,['C4G_ADMIN']);
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.organization_membership WHERE global_user_id=$1',[record.globalUserId])).rows[0].n,0);
  assert.deepEqual({memberships:await digest('organization_membership'),grants:await digest('authority_f5_state'),users:await digest('global_user','WHERE id<>$1',[record.globalUserId]),admins:await digest('platform_admin_assignment','WHERE global_user_id<>$1',[record.globalUserId])},before);
  record.status='READY';record.verifiedAt=new Date().toISOString();cfg.saveState(record,file);
  console.log(JSON.stringify({status:'READY',platformRole:'C4G_ADMIN',passwordChangeRequired:users[0].requiredActions.includes('UPDATE_PASSWORD'),privateMemberships:0,previousAccountsAndGrantsPreserved:true,privateAccessFile:path.relative(cfg.root,file)}));
 }finally{await authority.end();await pool.end()}
}
if(require.main===module)main().catch(e=>{console.error(e.code||(/^[A-Z0-9_]+$/.test(e.message)?e.message:'NAMED_ADMIN_PROVISION_FAILED'));process.exitCode=1});
module.exports={parse};
