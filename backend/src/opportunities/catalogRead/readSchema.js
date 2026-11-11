'use strict';
const {digest}=require('./model');
const schema=require('../../security/centralSchemaManifest');
const base=require('../../security/centralMigrationManifest');
const manifest=require('./readPackage.schema.json');
async function fingerprint(client,login=null,authorityLogin=null){
 const queries={
  relations:`SELECT c.relname,c.relkind,r.rolname AS owner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='catalog_read' ORDER BY c.relname`,
  columns:`SELECT c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='catalog_read' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
  constraints:`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='catalog_read' ORDER BY c.relname,k.conname`,
  indexes:`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='catalog_read' ORDER BY indexname`,
  triggers:`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='catalog_read' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
  functions:`SELECT p.proname,pg_get_functiondef(p.oid) AS definition,r.rolname AS owner,p.proconfig,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='catalog_read' ORDER BY p.proname`,
  roles:`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname LIKE 'c4g_catalog_projection_%' ORDER BY rolname`,
  privileges:`SELECT c.relname,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='catalog_read' ORDER BY c.relname,grantee,a.privilege_type`,
  schemaAcl:`SELECT r.rolname AS owner,COALESCE(g.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a LEFT JOIN pg_roles g ON g.oid=a.grantee WHERE n.nspname='catalog_read' ORDER BY grantee,a.privilege_type`,
  functionAcl:`SELECT p.proname,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='catalog_read' ORDER BY p.proname,grantee,a.privilege_type`,
  memberships:`SELECT r.rolname,m.rolname AS member,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE r.rolname LIKE 'c4g_catalog_projection_%' OR m.rolname LIKE 'c4g_catalog_projection_%' ORDER BY r.rolname,m.rolname`,
  columnAcl:`SELECT c.relname,a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='catalog_read' AND a.attacl IS NOT NULL ORDER BY c.relname,a.attname`,
  defaults:`SELECT r.rolname,n.nspname,d.defaclobjtype,d.defaclacl::text FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='catalog_read' OR r.rolname LIKE 'c4g_catalog_projection_%' ORDER BY r.rolname,n.nspname,d.defaclobjtype`
 };
 // One round trip, the same ordered metadata and exact pinned fingerprint.
 const sql='SELECT '+Object.entries(queries).map(([name,query])=>`(SELECT COALESCE(json_agg(q),'[]'::json) FROM (${query}) q) AS "${name}"`).join(',');
 const result=(await client.query(sql)).rows[0];
 if(login){
  const own=result.memberships.filter(m=>m.member===login);
  if(own.length!==1||own[0].rolname!=='c4g_catalog_projection_reader'||own[0].admin_option||own[0].inherit_option||!own[0].set_option)throw Error('CATALOG_READER_MEMBERSHIP_INVALID');
  result.memberships=result.memberships.filter(m=>m.member!==login);
 }
 if(authorityLogin){
  const own=result.memberships.filter(m=>m.member===authorityLogin);
  if(own.length!==1||own[0].rolname!=='c4g_catalog_projection_membership'||own[0].admin_option||own[0].inherit_option||!own[0].set_option)throw Error('CATALOG_AUTHORITY_MEMBERSHIP_INVALID');
  result.memberships=result.memberships.filter(m=>m.member!==authorityLogin);
 }
 return digest(result);
}

async function admitReader(client,{authorityLogin=null}={}){
 const result=await client.query(`SELECT session_user AS name,
  (SELECT COALESCE(json_agg(q),'[]'::json) FROM (SELECT r.rolname FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE m.rolname=session_user) q) AS parents,
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN('r','v','m','p') AND has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS excess,
  (SELECT json_build_object('limited',NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) FROM pg_roles WHERE rolname=$1) AS authority,
  (SELECT COALESCE(json_agg(q),'[]'::json) FROM (SELECT r.rolname FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE m.rolname=$1) q) AS "authorityParents"`,[authorityLogin]);
 if(result.rows.length!==1)throw Error('CATALOG_READER_MEMBERSHIP_INVALID');
 const {name:login,parents,excess,authority,authorityParents}=result.rows[0];
 if(!login||!Array.isArray(parents)||parents.length!==1||parents[0].rolname!=='c4g_catalog_projection_reader')throw Error('CATALOG_READER_MEMBERSHIP_INVALID');
 if(excess!==false)throw Error('CATALOG_READER_DIRECT_PRIVILEGES');
 if(authorityLogin&&(!authority?.limited||!Array.isArray(authorityParents)||authorityParents.length!==1||authorityParents[0].rolname!=='c4g_catalog_projection_membership'))throw Error('CATALOG_AUTHORITY_LOGIN_INVALID');
 if(await fingerprint(client,login,authorityLogin)!==manifest.fingerprint)throw Error('CATALOG_READ_SCHEMA_OR_PERMISSION_DRIFT');
 const coreFingerprint=schema.schemaFingerprint(await schema.centralSchemaSnapshot(client,{compact:true,nativeConstraints:true}));
 await client.query('SET LOCAL ROLE c4g_catalog_projection_reader');
 const records=(await client.query('SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration')).rows;
 await client.query('RESET ROLE');
 require('./ledgerContract').assertLedgerRows(records);
 const latest=records.map(r=>r.version).sort().at(-1);
 const expected=base.knownManifest.find(e=>e.version===latest);
 if(!expected?.readFingerprint||expected.readFingerprint!==manifest.fingerprint||coreFingerprint!==expected.schemaFingerprint)throw Error('CATALOG_READ_CORE_DRIFT');
 if(expected.centralImportSecurity)await require('../../security/centralImportSecurity').assertCentralImportSecurity(client);
}
module.exports={fingerprint,admitReader};
