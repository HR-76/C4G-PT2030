'use strict';
const { createHash } = require('node:crypto');
async function snapshot(client) {
  const functions = (await client.query(`SELECT n.nspname AS schema,p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,
    pg_get_functiondef(p.oid) AS definition,p.prosecdef AS security_definer,
    p.proconfig AS configuration,COALESCE(p.proacl,acldefault('f',p.proowner))::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='audit' AND p.proname='eu_legacy_prearchive_event_v1')
      OR (n.nspname='opportunity_catalog' AND p.proname IN
        ('authorize_eu_legacy_prearchive_v1','guard_eu_legacy_prearchive_v1','guard_eu_write_v2'))
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`)).rows;
  const relations = (await client.query(`SELECT n.nspname AS schema,c.relname AS name,
    pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    COALESCE(c.relacl,acldefault('r',c.relowner))::text AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='opportunity_catalog' AND c.relname IN
      ('eu_legacy_prearchive_use_v1','funding_candidate_v2','funding_run') ORDER BY c.relname`)).rows;
  const policies = (await client.query(`SELECT p.polname AS name,p.polcmd AS command,
    ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END FROM unnest(p.polroles) r ORDER BY 1) AS roles,
    pg_get_expr(p.polqual,p.polrelid) AS using_expression
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='audit' AND c.relname='event' AND p.polname='audit_eu_legacy_prearchive_read_v1'`)).rows;
  return { functions, relations, policies };
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function assertEuLegacyPrearchiveSecurity(client, expected) {
  if (!expected || digest(await snapshot(client)) !== expected)
    throw Object.assign(Error('EU_LEGACY_PREARCHIVE_SECURITY_DRIFT'), { code: 'EU_LEGACY_PREARCHIVE_SECURITY_DRIFT' });
}
module.exports = { snapshot, digest, assertEuLegacyPrearchiveSecurity };
