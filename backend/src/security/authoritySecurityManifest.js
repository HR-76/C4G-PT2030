'use strict';
const {createHash}=require('node:crypto');
// Expand each explicit ACL once per fresh statement. Authority recipients select
// protected objects; they never filter the PUBLIC/third-party rows we return.
// Default ACLs apply only to selected objects whose ACL is NULL, not empty.
const SQL=`WITH authority_roles AS MATERIALIZED (
 SELECT oid FROM pg_roles WHERE rolname LIKE 'c4g_authority_%'
), schema_acl AS MATERIALIZED (
 SELECT n.oid schema_oid,a.grantee,a.privilege_type,a.is_grantable
 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
 WHERE n.nspacl IS NOT NULL
), relation_acl AS MATERIALIZED (
 SELECT c.oid relation_oid,a.grantee,a.privilege_type,a.is_grantable
 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
 WHERE c.relacl IS NOT NULL
), column_acl AS MATERIALIZED (
 SELECT t.attrelid relation_oid,t.attname column_name,a.grantee,a.privilege_type,a.is_grantable
 FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
 WHERE t.attacl IS NOT NULL
), function_acl AS MATERIALIZED (
 SELECT p.oid function_oid,a.grantee,a.privilege_type,a.is_grantable
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
 WHERE p.proacl IS NOT NULL
), protected_schemas AS MATERIALIZED (
 SELECT n.oid,n.nspname,n.nspowner,n.nspacl FROM pg_namespace n
 WHERE n.nspname IN('authority_api','public')
  OR n.nspowner IN (SELECT oid FROM authority_roles)
  OR n.oid IN (SELECT a.schema_oid FROM schema_acl a JOIN authority_roles ar ON ar.oid=a.grantee)
), protected_relations AS MATERIALIZED (
 SELECT c.oid,c.relname,c.relkind,c.relowner,c.relacl,n.nspname
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE (n.nspname='public' AND (c.relname LIKE 'authority_%' OR c.relname IN
  ('c4g_database_identity','c4g_schema_migration','global_user','organization','organization_membership',
   'application_session','application_session_store','oidc_transaction')))
  OR c.relowner IN (SELECT oid FROM authority_roles)
  OR c.oid IN (SELECT a.relation_oid FROM relation_acl a JOIN authority_roles ar ON ar.oid=a.grantee)
  OR c.oid IN (SELECT a.relation_oid FROM column_acl a JOIN authority_roles ar ON ar.oid=a.grantee)
), protected_functions AS MATERIALIZED (
 SELECT p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,n.nspname
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='authority_api' OR (n.nspname='public' AND p.proname LIKE 'authority_%')
  OR p.proowner IN (SELECT oid FROM authority_roles)
  OR p.oid IN (SELECT a.function_oid FROM function_acl a JOIN authority_roles ar ON ar.oid=a.grantee)
), schema_privileges AS (
 SELECT a.schema_oid,a.grantee,a.privilege_type,a.is_grantable
 FROM protected_schemas n JOIN schema_acl a ON a.schema_oid=n.oid
 UNION ALL
 SELECT n.oid,a.grantee,a.privilege_type,a.is_grantable
 FROM protected_schemas n CROSS JOIN LATERAL aclexplode(acldefault('n',n.nspowner)) a
 WHERE n.nspacl IS NULL
), relation_privileges AS (
 SELECT a.relation_oid,a.grantee,a.privilege_type,a.is_grantable
 FROM protected_relations c JOIN relation_acl a ON a.relation_oid=c.oid
 WHERE c.relkind IN('r','p','S')
 UNION ALL
 SELECT c.oid,a.grantee,a.privilege_type,a.is_grantable
 FROM protected_relations c
 CROSS JOIN LATERAL aclexplode(acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner)) a
 WHERE c.relkind IN('r','p','S') AND c.relacl IS NULL
), function_privileges AS (
 SELECT a.function_oid,a.grantee,a.privilege_type,a.is_grantable
 FROM protected_functions p JOIN function_acl a ON a.function_oid=p.oid
 UNION ALL
 SELECT p.oid,a.grantee,a.privilege_type,a.is_grantable
 FROM protected_functions p CROSS JOIN LATERAL aclexplode(acldefault('f',p.proowner)) a
 WHERE p.proacl IS NULL
)
SELECT jsonb_build_object(
 'roles',(SELECT jsonb_agg(to_jsonb(q) ORDER BY rolname) FROM
   (SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit,
     rolvaliduntil::text,rolconfig FROM pg_roles WHERE rolname IN('c4g_authority_owner','c4g_authority_coordinator','c4g_authority_runtime','c4g_central_runtime')) q),
 'memberships',(SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY parent,member),'[]') FROM
   (SELECT r.rolname parent,m.rolname member,a.admin_option,a.inherit_option,a.set_option
    FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member
    WHERE r.rolname LIKE 'c4g_authority_%' OR m.rolname LIKE 'c4g_authority_%' OR r.rolname='c4g_central_runtime' OR m.rolname='c4g_central_runtime') q),
 'schema',(SELECT jsonb_agg(to_jsonb(q) ORDER BY schema_name,grantee,privilege_type) FROM
   (SELECT n.nspname schema_name,pg_get_userbyid(n.nspowner) owner,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM protected_schemas n JOIN schema_privileges a ON a.schema_oid=n.oid
    LEFT JOIN pg_roles r ON r.oid=a.grantee) q),
 'objects',(SELECT jsonb_agg(to_jsonb(q) ORDER BY schema_name,object_name,grantee,privilege_type) FROM
   (SELECT c.nspname schema_name,c.relname object_name,c.relkind,pg_get_userbyid(c.relowner) owner,
     COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM protected_relations c JOIN relation_privileges a ON a.relation_oid=c.oid
    LEFT JOIN pg_roles r ON r.oid=a.grantee) q),
 'columns',(SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY schema_name,object_name,column_name,grantee,privilege_type),'[]') FROM
   (SELECT c.nspname schema_name,c.relname object_name,a.column_name,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM protected_relations c JOIN column_acl a ON a.relation_oid=c.oid
    LEFT JOIN pg_roles r ON r.oid=a.grantee) q),
 'functions',(SELECT jsonb_agg(to_jsonb(q) ORDER BY schema_name,function_name,signature,grantee,privilege_type) FROM
   (SELECT p.nspname schema_name,p.proname function_name,pg_get_function_identity_arguments(p.oid) signature,
    pg_get_userbyid(p.proowner) owner,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable,
    pg_get_functiondef(p.oid) definition,p.prosecdef security_definer
    FROM protected_functions p JOIN function_privileges a ON a.function_oid=p.oid
    LEFT JOIN pg_roles r ON r.oid=a.grantee) q)
) AS snapshot`;
const digest=snapshot=>createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
async function authoritySecuritySnapshot(client,{compact=false}={}){
 if(!compact)return (await client.query(SQL)).rows[0]?.snapshot||null;
 const result=await client.query(require('./catalogMetadataTransport').compactAuthoritySql(SQL));
 if(result.rows?.length!==1)throw Error('AUTHORITY_SECURITY_SNAPSHOT_INVALID');
 return require('./catalogMetadataTransport').decodeAuthority(result.rows[0]);
}
function authorityFingerprint(version) {
  const { knownManifest, allKnownMigrations = knownManifest } = require('./centralMigrationManifest');
  return allKnownMigrations.find(entry => entry.version === version)?.authoritySecurityFingerprint;
}
function assertAuthoritySecuritySnapshot(snapshot, version){
  const expected=authorityFingerprint(version);
  if(!snapshot||!expected||(digest(snapshot)!==expected&&!require('./memberEmailAdmission').admits(version,'authority',digest(snapshot))&&!require('./stagingCentralRuntimeAdmission').admits(version,'authority',digest(snapshot))))throw Object.assign(new Error('AUTHORITY_SECURITY_DRIFT'),{code:'AUTHORITY_SECURITY_DRIFT'});
  return snapshot;
}
// Inside one HTTP request a successful read for the same database and schema
// revision is reused (context/decisions/request-scoped-central-admission.md).
// A refusal is never kept; outside a request every transaction reads again.
function assertAuthoritySecurity(client, version = require('./centralMigrationManifest').manifest.at(-1).version, {verify=readAuthoritySecurity}={}){
  return require('./requestAdmissionScope').admitWithinRequest(`authority-security:${client.host}:${client.port}/${client.database}:${version}`,()=>verify(client,version));
}
async function readAuthoritySecurity(client, version){
  return assertAuthoritySecuritySnapshot(await authoritySecuritySnapshot(client,{compact:true}),version);
}
async function assertAuthorityAdmission(client){
  const identity=(await client.query('SELECT session_user,current_user')).rows[0];
  if(identity?.session_user!=='c4g_authority_runtime'||identity.current_user!==identity.session_user)
    throw Object.assign(new Error('AUTHORITY_LOGIN_REQUIRED'),{code:'AUTHORITY_LOGIN_REQUIRED'});
  // No lifetime cache: an already used physical connection is not schema evidence.
  // The only reuse is inside the HTTP request that ran the preflight, for the
  // same database and for at most one authority deadline; the login above is
  // checked on every connection. Outside a request every call verifies.
  // Run before BEGIN of the protected metadata transaction, never nested.
  return require('./requestAdmissionScope').admitWithinRequest(`central:${client.host}:${client.port}/${client.database}`,async()=>{
    const schema = await require('./centralMigrationPreflight').preflightCentral({connect:async()=>({query:(...args)=>client.query(...args),release(){}})});
    // The preflight compared the security snapshot embedded in its schema against
    // this revision's exact fingerprint. Do not recollect it within admission.
    // Revisions without an authority contract remain inadmissible; the coordinator
    // still collects fresh security metadata after acquiring the protected lock.
    if(!authorityFingerprint(schema.currentVersion))
      throw Object.assign(new Error('AUTHORITY_SECURITY_DRIFT'),{code:'AUTHORITY_SECURITY_DRIFT'});
    return schema;
  });
}
module.exports={SQL,get COMPACT_SQL(){return require('./catalogMetadataTransport').compactAuthoritySql(SQL);},digest,authoritySecuritySnapshot,assertAuthoritySecuritySnapshot,assertAuthoritySecurity,assertAuthorityAdmission};
