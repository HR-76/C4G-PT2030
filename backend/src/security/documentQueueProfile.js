'use strict';
const ROLE='c4g_document_queue_runtime';
const ATTRIBUTES='NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
const TABLES=Object.freeze({version:['SELECT'],queue:['SELECT'],job:['INSERT'],job_common:['DELETE','INSERT','SELECT'],instance:['DELETE','INSERT','SELECT','UPDATE']});
const UPDATE=Object.freeze(['blocked','completed_on','heartbeat_on','output','pending_dependencies','retry_count','started_on','state']);
const QUEUES=Object.freeze(['c4g.document.expire-upload','c4g.document.reconcile','c4g.document.scan']);
const options='-c role='+ROLE;
function identifier(value){if(!/^[a-z][a-z0-9_]{0,62}$/.test(value||''))throw Error('DOCUMENT_QUEUE_LOGIN_INVALID');return '"'+value+'"';}
async function assertSchema(client){
 const version=(await client.query('SELECT version FROM pgboss.version')).rows;
 if(version.length!==1||Number(version[0].version)!==45)throw Error('DOCUMENT_QUEUE_SCHEMA_INCOMPATIBLE');
 const queues=(await client.query('SELECT name,table_name,partition,dead_letter,policy FROM pgboss.queue ORDER BY name')).rows;
 for(const name of QUEUES){const q=queues.find(row=>row.name===name);if(!q||q.table_name!=='job_common'||q.partition||q.dead_letter||q.policy!=='standard')throw Error('DOCUMENT_QUEUE_CONFIGURATION_DRIFT');}
 // This operational profile is for the documentary queue schema, not arbitrary workloads.
 if(queues.length!==QUEUES.length)throw Error('DOCUMENT_QUEUE_CONFIGURATION_DRIFT');
}
async function grants(client,role){
 const r=await client.query(`WITH who AS (SELECT oid FROM pg_roles WHERE rolname=$1)
 SELECT 'schema:'||n.nspname||':'||a.privilege_type AS grant,a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=(SELECT oid FROM who)
 UNION ALL SELECT 'table:'||n.nspname||'.'||c.relname||':'||a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=(SELECT oid FROM who)
 UNION ALL SELECT 'column:'||n.nspname||'.'||c.relname||'.'||t.attname||':'||a.privilege_type,a.is_grantable FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a WHERE a.grantee=(SELECT oid FROM who)
 UNION ALL SELECT 'function:'||p.oid::regprocedure::text||':'||a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=(SELECT oid FROM who)
 UNION ALL SELECT 'type:'||t.oid::regtype::text||':'||a.privilege_type,a.is_grantable FROM pg_type t CROSS JOIN LATERAL aclexplode(t.typacl) a WHERE a.grantee=(SELECT oid FROM who)
 UNION ALL SELECT 'default:'||d.oid::text||':'||a.privilege_type,a.is_grantable FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee=(SELECT oid FROM who)`,[role]);return r.rows;
}
async function validateDocumentQueueProfile(client,{login,requireSelected=false}){
 identifier(login);
 const rows=(await client.query('SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[[login,ROLE]])).rows;
 if(rows.length!==2||rows.some(({rolname,rolcanlogin,...flags})=>rolcanlogin!==(rolname===login)||Object.values(flags).some(Boolean)))throw Error('DOCUMENT_QUEUE_ATTRIBUTES_DRIFT');
 const edges=(await client.query('SELECT p.rolname parent,c.rolname member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid JOIN pg_roles c ON c.oid=m.member WHERE c.rolname=ANY($1::text[])',[[login,ROLE]])).rows;
 if(edges.length!==1||edges[0].member!==login||edges[0].parent!==ROLE||edges[0].admin_option||edges[0].inherit_option||!edges[0].set_option)throw Error('DOCUMENT_QUEUE_MEMBERSHIP_DRIFT');
 const bad=(await client.query(`WITH who AS (SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])) SELECT
 EXISTS(SELECT 1 FROM pg_class WHERE relowner IN(SELECT oid FROM who)) OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner IN(SELECT oid FROM who))
 OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner IN(SELECT oid FROM who)) OR EXISTS(SELECT 1 FROM pg_database WHERE datdba IN(SELECT oid FROM who))
 OR EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole IN(SELECT oid FROM who))
 OR has_database_privilege($2,current_database(),'CREATE,TEMP') OR has_database_privilege($3,current_database(),'CREATE,TEMP') AS bad`,[[login,ROLE],login,ROLE])).rows[0];
 if(bad?.bad!==false)throw Error('DOCUMENT_QUEUE_OWNERSHIP_DRIFT');
 const expected=['schema:pgboss:USAGE',...Object.entries(TABLES).flatMap(([t,ps])=>ps.map(p=>'table:pgboss.'+t+':'+p)),...UPDATE.map(c=>'column:pgboss.job_common.'+c+':UPDATE')].sort();
 const actual=await grants(client,ROLE);
 if(actual.some(r=>r.is_grantable)||JSON.stringify(actual.map(r=>r.grant).sort())!==JSON.stringify(expected)||(await grants(client,login)).length)throw Error('DOCUMENT_QUEUE_ACL_DRIFT');
 if(requireSelected){const state=(await client.query('SELECT session_user,current_user')).rows[0];if(state?.session_user!==login||state.current_user!==ROLE)throw Error('DOCUMENT_QUEUE_ROLE_REQUIRED');}
 return Object.freeze({role:ROLE,login,grants:expected});
}
async function provisionDocumentQueueProfile(client,{login,password}){
 identifier(login);if(/^c4g_/.test(login))throw Error('DOCUMENT_QUEUE_DEDICATED_LOGIN_REQUIRED');
 await client.query('BEGIN');try{
 await client.query('SELECT pg_advisory_xact_lock(43000045)');await assertSchema(client);
 const existing=(await client.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[[ROLE,login]])).rows;let state;
 if(!existing.length){
  if(typeof password!=='string'||password.length<24)throw Error('DOCUMENT_QUEUE_PASSWORD_REQUIRED');
  await client.query(`CREATE ROLE ${ROLE} NOLOGIN ${ATTRIBUTES}`);
  await client.query(`CREATE ROLE ${identifier(login)} LOGIN ${ATTRIBUTES} PASSWORD '${password.replace(/'/g,"''")}'`);
  await client.query(`GRANT ${ROLE} TO ${identifier(login)} WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);
  await client.query(`GRANT USAGE ON SCHEMA pgboss TO ${ROLE}`);
  for(const [table,permissions] of Object.entries(TABLES))await client.query(`GRANT ${permissions.join(',')} ON pgboss.${table} TO ${ROLE}`);
  await client.query(`GRANT UPDATE(${UPDATE.join(',')}) ON pgboss.job_common TO ${ROLE}`);
  const db=(await client.query('SELECT current_database() name')).rows[0].name;
  await client.query(`GRANT CONNECT ON DATABASE ${identifier(db)} TO ${identifier(login)}`);state='PROVISIONED';
 }else{if(existing.length!==2)throw Error('DOCUMENT_QUEUE_PARTIAL_PROFILE');state='ALREADY_CONFORMING';}
 const profile=await validateDocumentQueueProfile(client,{login});await client.query('COMMIT');return{state,...profile};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
module.exports={ROLE,TABLES,UPDATE,QUEUES,options,assertSchema,validateDocumentQueueProfile,provisionDocumentQueueProfile};
