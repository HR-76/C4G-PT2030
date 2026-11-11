'use strict';

async function f12ReceiptSchemaEvidence(client, schema, roles) {
  const { rows } = await client.query(`
    SELECT kind, name, owner, acl, definition FROM (
      SELECT 'schema' AS kind, n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner,
        n.nspacl::text AS acl, NULL::text AS definition
      FROM pg_namespace n WHERE n.nspname=$1 OR ($1='f12_service_receipts' AND n.nspname='c4g_system')
      UNION ALL
      SELECT 'table', c.relname, pg_get_userbyid(c.relowner), c.relacl::text,
        jsonb_build_array(c.relrowsecurity, c.relforcerowsecurity)::text
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind='r'
      UNION ALL
      SELECT 'column', c.relname||'.'||a.attname, NULL, a.attacl::text, NULL
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE a.attnum>0 AND NOT a.attisdropped AND (n.nspname=$1 OR
        ($1='f12_service_receipts' AND n.nspname='c4g_system' AND c.relname='tenant_identity'))
      UNION ALL
      SELECT 'function', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
        pg_get_userbyid(p.proowner), p.proacl::text, pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1
      UNION ALL
      SELECT 'role', rolname, NULL, NULL, jsonb_build_array(rolcanlogin, rolinherit, rolsuper,
        rolcreatedb, rolcreaterole, rolreplication, rolbypassrls)::text
      FROM pg_roles WHERE rolname=ANY($2::text[])
    ) evidence ORDER BY kind,name`, [schema, roles]);
  return rows;
}

module.exports = { f12ReceiptSchemaEvidence };
