const REQUIRED_ROLES = Object.freeze(['c4g_audit_owner', 'c4g_audit_writer', 'c4g_audit_reader', 'c4g_audit_verifier', 'c4g_audit_migrator']);
const REQUIRED_TABLES = Object.freeze(['chain_head', 'checkpoint', 'event', 'event_2026_10', 'event_2026_11', 'event_default', 'event_identity']);
async function auditPreflight(client) {
  const [{ rows: roles }, { rows: tables }, { rows: functions }, { rows: badGrants }, { rows: policies }, { rows: triggers }, { rows: memberships }, { rows: strayPartitions }] = await Promise.all([
    client.query(`SELECT rolname,rolcanlogin,rolsuper FROM pg_roles WHERE rolname=ANY($1)`, [REQUIRED_ROLES]),
    client.query(`SELECT tablename FROM pg_tables WHERE schemaname='audit'`),
    client.query(`SELECT proname,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='audit'`),
    client.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='audit' AND grantee='c4g_audit_writer'`),
    client.query(`SELECT policyname FROM pg_policies WHERE schemaname='audit' AND tablename='event'`),
    client.query(`SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='audit' AND NOT t.tgisinternal`),
    client.query(`SELECT pg_has_role('c4g_audit_migrator','c4g_audit_owner','MEMBER') AS allowed`),
    // Monthly-named tables are excluded from the schema fingerprint, so each must be a real partition.
    client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='audit' AND c.relname ~ '^event_[0-9]{4}_[0-9]{2}$'
        AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid AND i.inhparent='audit.event'::regclass)`)
  ]);
  if (roles.length !== REQUIRED_ROLES.length || roles.some(role => role.rolcanlogin || role.rolsuper)) throw new Error('AUDIT_ROLE_PREFLIGHT_FAILED');
  if (REQUIRED_TABLES.some(name => !tables.some(row => row.tablename === name))) throw new Error('AUDIT_SCHEMA_PREFLIGHT_FAILED');
  for (const name of ['prepare_append_v1', 'append_event_v1']) {
    const fn = functions.find(row => row.proname === name);
    if (!fn || !fn.prosecdef || !Array.isArray(fn.proconfig) || !fn.proconfig.includes('search_path=pg_catalog, audit')) throw new Error('AUDIT_FUNCTION_PREFLIGHT_FAILED');
  }
  if (badGrants.length) throw new Error('AUDIT_WRITER_TABLE_GRANT_FORBIDDEN');
  if (!['audit_event_org_read', 'audit_event_owner_append'].every(name => policies.some(row => row.policyname === name))) throw new Error('AUDIT_RLS_PREFLIGHT_FAILED');
  if (!['audit_event_no_update_delete', 'audit_event_no_truncate', 'audit_identity_no_update_delete', 'audit_checkpoint_no_update_delete'].every(name => triggers.some(row => row.tgname === name))) throw new Error('AUDIT_TRIGGER_PREFLIGHT_FAILED');
  if (!memberships[0]?.allowed) throw new Error('AUDIT_MIGRATOR_PREFLIGHT_FAILED');
  if (strayPartitions.length) throw new Error('AUDIT_SCHEMA_PREFLIGHT_FAILED');
  return Object.freeze({ ready: true, schemaVersion: 'f7-audit-schema-v1' });
}
module.exports = { REQUIRED_ROLES, REQUIRED_TABLES, auditPreflight };
