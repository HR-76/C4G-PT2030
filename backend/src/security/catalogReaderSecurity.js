'use strict';
const ROLE = 'c4g_catalog_reader';
const BASE_TABLES=Object.freeze(['opportunity','revision','funding_identity']);
const V2_TABLES=Object.freeze(['revision_allocation_v2','revision_financial_detail_v2','revision_concept_v2','revision_allocation_concept_v2','revision_deadline_v2']);
// Database-local activation: another database in the cluster can still be at 028.
async function catalogReaderSnapshot(client) {
  // One fresh statement, with identical ordered fields and database-local activation.
  // CASE preserves the absent-reader result; no privileges or snapshots are cached.
  const result=await client.query(`SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a
    JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='opportunity_catalog' AND r.rolname=$1) THEN json_build_object('roles',(SELECT COALESCE(json_agg(q),'[]'::json) FROM (SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
    rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1) q),'parents',(SELECT COALESCE(json_agg(q),'[]'::json) FROM (SELECT r.rolname,a.admin_option,a.inherit_option,a.set_option
    FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid
    WHERE a.member=(SELECT oid FROM pg_roles WHERE rolname=$1) ORDER BY 1) q),'tables',(SELECT COALESCE(json_agg(q),'[]'::json) FROM (SELECT c.relname,pg_get_userbyid(c.relowner) owner,
    c.relrowsecurity,c.relforcerowsecurity,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='opportunity_catalog'
    AND c.relname IN ('opportunity','revision','funding_identity') ORDER BY 1,5,6) q),'columns',(SELECT COALESCE(json_agg(q),'[]'::json) FROM (SELECT c.relname,t.attname,t.attacl::text FROM pg_attribute t
    JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='opportunity_catalog' AND t.attacl IS NOT NULL ORDER BY 1,2) q),'database',(SELECT COALESCE(json_agg(q),'[]'::json) FROM (SELECT EXISTS(SELECT 1 FROM pg_database d,
    LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
    WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='TEMPORARY') AS public_temp) q)) ELSE NULL END AS snapshot`,[ROLE]);
  if(result.rows.length!==1||!Object.hasOwn(result.rows[0],'snapshot'))throw Error('CATALOG_READER_METADATA_INVALID');
  return result.rows[0].snapshot;
}
async function assertReaderLogin(client) {
  const result = await client.query(`SELECT session_user=current_user AS reset,
    r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit) AS limited,
    (SELECT count(*)=1 AND bool_and(p.rolname=$1 AND NOT a.admin_option AND NOT a.inherit_option AND a.set_option)
      FROM pg_auth_members a JOIN pg_roles p ON p.oid=a.roleid WHERE a.member=r.oid) AS membership
    FROM pg_roles r WHERE r.rolname=session_user`, [ROLE]);
  const row=result.rows[0];
  if (!row?.reset || !row.limited || !row.membership) throw new Error('CATALOG_READER_LOGIN_REJECTED');
}
async function assertReaderSession(client,admission) {
  if(admission!==undefined&&!require('./catalogReaderSchema').isReaderSchemaAdmission(admission))throw Error('CATALOG_READER_SCHEMA_ADMISSION_REQUIRED');
  const v2=['042_opportunity_eu_source_control_v2','043_opportunity_eu_writer_v2',
    '044_opportunity_eu_expired_reconciliation','045_opportunity_eu_legacy_prearchive','048_catalog_read_service_v1','049_pt2030_document_upload','050_billing_private_documents','051_email_templates'].includes(admission?.version);
  const readable=v2?[...BASE_TABLES,...V2_TABLES]:BASE_TABLES;
  await assertReaderLogin(client);
  // Direct grants/ownership are forbidden as well as inherited administrative roles.
  const excess=await client.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
      AND (c.relowner=(session_user::regrole)::oid OR
        CASE WHEN c.relkind='S' THEN has_sequence_privilege(session_user,c.oid,'USAGE,SELECT,UPDATE')
        ELSE has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END))
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'
      AND has_schema_privilege(session_user,oid,'CREATE'))
    OR has_database_privilege(session_user,current_database(),'CREATE,TEMP')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='authority_api' AND has_function_privilege(session_user,p.oid,'EXECUTE')) AS excess`);
  if (excess.rows[0]?.excess !== false) throw new Error('CATALOG_READER_EXCESS_PRIVILEGES');
  const roleAccess=await client.query(`SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
    AND (c.relowner=($1::regrole)::oid OR CASE WHEN c.relkind='S' THEN has_sequence_privilege($1,c.oid,'USAGE,SELECT,UPDATE')
      ELSE has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege($1,c.oid,'INSERT,UPDATE,REFERENCES')
        OR (NOT(n.nspname='opportunity_catalog' AND c.relname=ANY($2::text[]))
          AND has_any_column_privilege($1,c.oid,'SELECT')) END))
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND has_schema_privilege($1,oid,'CREATE'))
    OR has_database_privilege($1,current_database(),'CREATE,TEMP')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prosecdef AND has_function_privilege($1,p.oid,'EXECUTE')) AS excess`,[ROLE,readable]);
  if(roleAccess.rows[0]?.excess!==false)throw new Error('CATALOG_READER_ROLE_EXCESS_PRIVILEGES');
  if(v2){
    const grants=await client.query(`SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,a.privilege_type,a.is_grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      WHERE n.nspname='opportunity_catalog' AND c.relname=ANY($1::text[]) AND a.grantee=($2::regrole)::oid
      ORDER BY c.relname,a.privilege_type`,[V2_TABLES,ROLE]);
    if(grants.rows.length!==V2_TABLES.length||new Set(grants.rows.map(row=>row.relname)).size!==V2_TABLES.length
      ||grants.rows.some(row=>!V2_TABLES.includes(row.relname)||row.owner!=='c4g_opportunity_central_owner'||row.privilege_type!=='SELECT'||row.is_grantable!==false))throw Error('CATALOG_READER_DERIVED_PRIVILEGES_DRIFT');
  }
}
module.exports={ROLE,catalogReaderSnapshot,assertReaderLogin,assertReaderSession};
