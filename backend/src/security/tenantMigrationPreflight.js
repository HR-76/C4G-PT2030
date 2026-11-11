const { validateInterestCapabilities } = require('./tenantInterestCapabilities');
const { isRotatingAuditTable } = require('./auditPartitionPolicy');
const { registeredManifest: manifest, allRegisteredMigrations, receiptManifest, failureReceiptManifest, assignedReviewManifest,
  applicationChatManifest, APPLICATION_CHAT_SCHEMA_VERSION, organizationStrategyManifest, ORGANIZATION_STRATEGY_SCHEMA_VERSION,
  applicationTaskDetailsManifest, APPLICATION_TASK_DETAILS_SCHEMA_VERSION, documentDeletionManifest, DOCUMENT_DELETION_SCHEMA_VERSION, chatRetentionManifest, CHAT_RETENTION_SCHEMA_VERSION,
  migrationSql, validateTenantLedger } = require('./tenantMigrationManifest');
const { tenantSchemaFingerprint, tenantSchemaSnapshot } = require('./tenantSchemaFingerprint');
const {
  aggregateTenantMigrationFailures, isTenantMigrationFailure, tenantMigrationFailure
} = require('./tenantMigrationErrors');

const SUPPORTED_POSTGRES_MAJOR = 17;
const { SUPPORTED_POSTGRES_MAJORS } = require('./postgresCatalogCompatibility');
const TENANT_ROLE_CONTRACT = Object.freeze({
  owner: 'c4g_tenant_owner',
  migrator: 'c4g_tenant_migrator',
  runtime: 'c4g_tenant_runtime'
});
const EXPECTED_SEARCH_PATH = 'search_path=pg_catalog, c4g_app';
const tenantCapabilityEvidenceSet = new WeakSet();
const tenantCapabilityEvidencePools = new WeakMap();

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function issueTenantCapabilityEvidence(value) {
  const entry = value && allRegisteredMigrations.find(candidate => candidate.version === value.currentVersion);
  if (!entry || value.schemaFingerprint !== entry.schemaFingerprint
      || !sameArray(value.capabilities, entry.capabilities)
      || !value.compatibility || !sameArray(value.compatibility.readVersions, entry.compatibility.readVersions)
      || !sameArray(value.compatibility.writeVersions, entry.compatibility.writeVersions)
      || typeof value.tenantId !== 'string' || value.securityContractVerified !== true) {
    throw new TypeError('Verified tenant capability evidence is incompatible.');
  }
  const evidence = Object.freeze({ ...value, capabilities: Object.freeze([...value.capabilities]),
    compatibility: Object.freeze({ readVersions:Object.freeze([...value.compatibility.readVersions]),
      writeVersions:Object.freeze([...value.compatibility.writeVersions]) }) });
  tenantCapabilityEvidenceSet.add(evidence);
  return evidence;
}

function isTenantCapabilityEvidence(value) { return tenantCapabilityEvidenceSet.has(value); }

function isTenantCapabilityEvidenceForPool(value, pool) {
  return isTenantCapabilityEvidence(value) && pool !== null
    && (typeof pool === 'object' || typeof pool === 'function')
    && tenantCapabilityEvidencePools.get(value) === pool;
}

function refuse(code) {
  throw tenantMigrationFailure(code);
}

function exactExpected(expected) {
  return expected && typeof expected === 'object'
    && Object.getPrototypeOf(expected) === Object.prototype
    && typeof expected.tenantId === 'string' && expected.tenantId.length > 0
    && typeof expected.databaseGenerationId === 'string' && expected.databaseGenerationId.length > 0;
}

async function validateDatabaseContract(client) {
  const version = await client.query("SELECT current_setting('server_version_num') AS server_version_num");
  const rawVersion = version.rows[0] && String(version.rows[0].server_version_num || '');
  const major = Math.trunc(Number(rawVersion) / 10000);
  if (!/^\d+$/.test(rawVersion) || !SUPPORTED_POSTGRES_MAJORS.includes(major)) {
    refuse('POSTGRES_VERSION_MISMATCH');
  }
  const settings = await client.query(`
    SELECT current_setting('server_encoding') AS server_encoding,
           current_setting('TimeZone') AS timezone,
           pg_catalog.pg_encoding_to_char(d.encoding) AS database_encoding,
           d.datlocprovider AS locale_provider,
           COALESCE(d.datlocale, '') AS icu_locale,
           COALESCE(d.datcollversion, '') AS collation_version
      FROM pg_catalog.pg_database d
     WHERE d.datname = current_database()`);
  const row = settings.rows[0];
  if (!row || row.server_encoding !== 'UTF8' || row.database_encoding !== 'UTF8'
      || row.timezone !== 'UTC' || row.locale_provider !== 'i' || row.icu_locale !== 'und'
      || typeof row.collation_version !== 'string' || row.collation_version.length === 0) {
    refuse('DATABASE_CONFIGURATION_MISMATCH');
  }
  const extensions = await client.query(`
    SELECT extname FROM pg_catalog.pg_extension
     WHERE extname <> 'plpgsql'
     ORDER BY extname`);
  if (extensions.rows.length !== 0) refuse('EXTENSION_ALLOWLIST_MISMATCH');
  return Object.freeze({ postgresMajor: major, collationVersionObserved: true });
}

async function validateRolesAndPrivileges(client, snapshot) {
  const roleNames = Object.values(TENANT_ROLE_CONTRACT);
  const roles = await client.query(`
    SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      FROM pg_catalog.pg_roles
     WHERE rolname = ANY($1::text[])
     ORDER BY rolname`, [roleNames]);
  if (roles.rows.length !== roleNames.length) refuse('ROLE_CONTRACT_MISMATCH');
  const byName = new Map(roles.rows.map(row => [row.rolname, row]));
  const owner = byName.get(TENANT_ROLE_CONTRACT.owner);
  const migrator = byName.get(TENANT_ROLE_CONTRACT.migrator);
  const runtime = byName.get(TENANT_ROLE_CONTRACT.runtime);
  const dangerous = role => role.rolsuper || role.rolcreaterole || role.rolcreatedb
    || role.rolreplication || role.rolbypassrls;
  if (!owner || owner.rolcanlogin || dangerous(owner) || !migrator || migrator.rolcanlogin || dangerous(migrator)
      || !runtime || runtime.rolcanlogin || dangerous(runtime)) refuse('ROLE_CONTRACT_MISMATCH');
  const memberships = await client.query(`
    SELECT pg_catalog.pg_has_role($1, $2, 'MEMBER') AS migrator_owns,
           pg_catalog.pg_has_role($3, $2, 'MEMBER') AS runtime_owns,
           pg_catalog.pg_has_role($3, $1, 'MEMBER') AS runtime_migrates`, [
    TENANT_ROLE_CONTRACT.migrator, TENANT_ROLE_CONTRACT.owner, TENANT_ROLE_CONTRACT.runtime
  ]);
  const membership = memberships.rows[0];
  if (!membership || !membership.migrator_owns || membership.runtime_owns || membership.runtime_migrates) {
    refuse('ROLE_CONTRACT_MISMATCH');
  }
  const controlSchemas = new Set(['c4g_app', 'c4g_system']);
  if (snapshot.schemas.some(row => controlSchemas.has(row.schema_name) && row.owner_name !== TENANT_ROLE_CONTRACT.owner)
      || snapshot.tables.some(row => controlSchemas.has(row.schema_name) && row.owner_name !== TENANT_ROLE_CONTRACT.owner)
      || snapshot.functions.some(row => controlSchemas.has(row.schema_name) && row.owner_name !== TENANT_ROLE_CONTRACT.owner
        && !(snapshot.runtimeMetadataSecurity&&row.function_name==='runtime_metadata_v1'&&row.owner_name==='c4g_f4_metadata_owner'))) {
    refuse('OBJECT_OWNER_MISMATCH');
  }
  const privileges = await client.query(`
    SELECT
      has_schema_privilege($1, 'c4g_system', 'USAGE') AS system_usage,
      has_schema_privilege($1, 'c4g_app', 'USAGE') AS app_usage,
      has_schema_privilege($1, 'c4g_system', 'CREATE') AS system_create,
      has_schema_privilege($1, 'c4g_app', 'CREATE') AS app_create,
      has_schema_privilege($1, 'public', 'CREATE') AS public_create,
      has_table_privilege($1,(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='c4g_system' AND c.relname='tenant_identity'), 'SELECT') AS identity_select,
      has_table_privilege($1,(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='c4g_system' AND c.relname='schema_migration'), 'SELECT') AS ledger_select,
      has_table_privilege($1,(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='c4g_system' AND c.relname='tenant_identity'), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS identity_write,
      has_table_privilege($1,(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='c4g_system' AND c.relname='schema_migration'), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ledger_write,
      has_database_privilege($1, current_database(), 'TEMP') AS database_temp,
      has_database_privilege('public', current_database(), 'CONNECT') AS public_connect,
      has_schema_privilege('public', 'public', 'CREATE') AS public_role_create,
      has_schema_privilege('public', 'public', 'USAGE') AS public_role_usage`,
    [TENANT_ROLE_CONTRACT.runtime]);
  const grants = privileges.rows[0];
  if (!grants || !grants.system_usage || !grants.app_usage || !grants.identity_select || !grants.ledger_select
      || grants.system_create || grants.app_create || grants.public_create || grants.identity_write
      || grants.ledger_write || grants.database_temp || grants.public_connect
      || grants.public_role_create || grants.public_role_usage) {
    refuse('PRIVILEGE_CONTRACT_MISMATCH');
  }
  const acl = await client.query(`
    SELECT object_kind, schema_name, object_name, COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
           privilege_type
      FROM (
        SELECT 'SCHEMA'::text AS object_kind, n.nspname AS schema_name, ''::text AS object_name,
               x.grantee, x.privilege_type
          FROM pg_catalog.pg_namespace n,
               LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) x
         WHERE n.nspname = ANY($1::text[])
        UNION ALL
        SELECT 'TABLE', n.nspname, c.relname, x.grantee, x.privilege_type
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
               LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) x
         WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p')
        UNION ALL
        SELECT 'FUNCTION', n.nspname, p.proname, x.grantee, x.privilege_type
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
               LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
         WHERE n.nspname = ANY($1::text[])
      ) grants
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=grants.grantee
     ORDER BY object_kind,schema_name,object_name,grantee,privilege_type`, [['c4g_app', 'c4g_system']]);
  const unexpectedAcl = acl.rows.find(row => {
    if (snapshot.receiptSecurity && row.schema_name === 'c4g_system'
        && row.grantee === 'c4g_f12_receipt_issuer' && row.object_kind === 'SCHEMA'
        && row.privilege_type === 'USAGE') return false;
    if(snapshot.runtimeMetadataSecurity&&row.schema_name==='c4g_system'){
      if(['c4g_f4_metadata_owner','c4g_f4_metadata_executor'].includes(row.grantee)&&row.object_kind==='SCHEMA'&&row.privilege_type==='USAGE')return false;
      if(row.grantee==='c4g_f4_metadata_owner'&&row.object_kind==='TABLE'&&['tenant_identity','schema_migration'].includes(row.object_name)&&row.privilege_type==='SELECT')return false;
      if(['c4g_f4_metadata_owner','c4g_f4_metadata_executor'].includes(row.grantee)&&row.object_kind==='FUNCTION'&&row.object_name==='runtime_metadata_v1'&&row.privilege_type==='EXECUTE')return false;
    }
    if (row.grantee === TENANT_ROLE_CONTRACT.owner) return false;
    if (row.grantee !== TENANT_ROLE_CONTRACT.runtime) return true;
    return !((row.object_kind === 'SCHEMA' && row.privilege_type === 'USAGE')
      || (row.object_kind === 'TABLE' && row.privilege_type === 'SELECT'));
  });
  if (unexpectedAcl) refuse('PRIVILEGE_CONTRACT_MISMATCH');
  const setting = await client.query(`
    SELECT COALESCE(s.setconfig, ARRAY[]::text[]) AS settings
      FROM pg_catalog.pg_roles r
      LEFT JOIN pg_catalog.pg_db_role_setting s
        ON s.setrole = r.oid AND s.setdatabase = (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
     WHERE r.rolname = $1`, [TENANT_ROLE_CONTRACT.runtime]);
  if (!setting.rows[0] || !setting.rows[0].settings.includes(EXPECTED_SEARCH_PATH)) {
    refuse('SEARCH_PATH_MISMATCH');
  }
}

function documentStorageSpecification(required) {
  return ['F11_PRIVATE_DOCUMENT_STORAGE', 'document_storage',
      ['document', 'document_version', 'multipart_part', 'reconciliation_finding', 'scan_result', 'upload_capability',
        ...(required.has('APPLICATION_DOCUMENT_TRANSPORT') ? ['multipart_upload'] : [])].sort(),
      required.has('APPLICATION_DOCUMENT_TRANSPORT') ? 5 : 4];
}

function opportunityCatalogSpecification(required) {
  return ['F12_PRIVATE_CATALOG_READ', 'opportunity_catalog',
      ['duplicate_candidate', 'idempotency_record', 'opportunity', 'opportunity_document_binding',
        'organization_opportunity', 'provenance', 'revision',
        ...(required.has('ORGANIZATIONAL_OPPORTUNITY_INTERESTS')?['opportunity_interest','interest_unit','interest_change','interest_receipt','application_unit']:[]),
        ...(required.has('F12_OPPORTUNITY_XLSX_IMPORT')?['import_job','import_row_outcome']:[]),...(required.has('OPPORTUNITY_EVIDENCED_CRITERIA')?['criteria_set','criteria_revision','criteria_confirmation','criteria_receipt']:[]),
        ...(required.has('ORGANIZATION_NOTICES')?['organization_notice','organization_notice_recipient']:[]),...(required.has('APPLICATION_ALERTS')?['application_alert']:[]),...(required.has('APPLICATION_PARTNERS')?['application_partners','application_partner','application_partner_change','application_partner_receipt']:[]),
        ...(required.has('APPLICATION_FIRST_SLICE')?['application','application_change','application_receipt']:[]),
        ...(required.has('APPLICATION_TEAM_TASKS')?['application_work','application_participant','application_task','application_work_change','application_work_receipt']:[]),
        ...(required.has('APPLICATION_TEAM_CHAT')?['application_chat_message','application_chat_receipt']:[]),
        ...(required.has('APPLICATION_CHAT_RETENTION')?['application_chat_purge']:[]),
        ...(required.has('APPLICATION_DOCUMENT_REVIEW')?['application_document_head','application_document_link','application_review_request','application_review_item','application_review_decision','application_document_change','application_document_receipt']:[])].sort(),
      required.has('APPLICATION_CHAT_RETENTION')?43:required.has('APPLICATION_TEAM_CHAT')?42:required.has('ORGANIZATIONAL_OPPORTUNITY_INTERESTS')?40:required.has('ORGANIZATION_NOTICES')?35:required.has('APPLICATION_ALERTS')?33:required.has('APPLICATION_PARTNERS')?32:required.has('APPLICATION_DOCUMENT_REVIEW')?28:required.has('APPLICATION_TEAM_TASKS')?21:required.has('APPLICATION_FIRST_SLICE')?16:required.has('OPPORTUNITY_EVIDENCED_CRITERIA')?13:required.has('F12_OPPORTUNITY_XLSX_IMPORT')?9:7];
}

function organizationalScopeSpecification(required) {
  return ['F13_P1_ORGANIZATIONAL_SCOPE', 'organizational_scope', ['idempotency_record', 'scope',
      ...(required.has('ORGANIZATION_DIRECTORY')?['organization_card','person','person_unit','directory_receipt']:[]),...(required.has('PERSONAL_PROFILE')?['person_profile']:[])].sort(), required.has('PERSONAL_PROFILE')?7:required.has('ORGANIZATION_DIRECTORY')?6:2];
}

function profileCatalogSpecification(required) {
  return ['F13_PROFILE_CATALOG_FOUNDATION', 'organization_profile', [
      'band_policy','catalog_release','compatibility_manifest','completion_policy','completion_rule','completion_slot',
      'concept','concept_label','concept_relation','derivation_policy','external_mapping','metric_catalog_release',
      'metric_definition','profile_scope','projection_policy','purpose_catalog_entry','purpose_catalog_release',
      'reason_catalog_entry','reason_catalog_release','release_bundle','scheme','taxonomy_idempotency_record'
      ,...(required.has('F14_PQ1_DECISIONS')?['pq1_decision']:[]),...(required.has('F13_PQ1_ACTIVATION')?["pq1_effective_release", "pq1_effective_snapshot", "pq1_activation", "profile_active_baseline", "pq1_evaluation", "pq1_effective_receipt"]:[])
      ,...(required.has('F13_PQ1_PUBLICATION')?["pq1_candidate","pq1_candidate_author","pq1_version","pq1_publication","pq1_idempotency_record","pq1_release","pq1_method_descriptor","pq1_provenance","pq1_verification_status_event","pq1_ui_receipt"]:[])
      ,...(required.has('F13_EDITORIAL_BASELINE_PUBLICATION')?['editorial_candidate','editorial_candidate_author','editorial_version','editorial_publication','editorial_idempotency_record']:[])
      ,...(required.has('F13_PROFILE_AUTHORING')?['profile_draft','profile_draft_revision','profile_item_version','profile_revision_item','idempotency_record']:[])
      ,...(required.has('F13_COMPETENCIES_AND_EXPERIENCE')?['competency_catalog_release','competency_catalog_entry','competency_assertion_version','experience_evidence_version','competency_evidence_link','competency_verification_result','competency_revision_member','competency_idempotency_record']:[])
      ,...(required.has('F13_TERRITORIES_AND_POPULATIONS')?['population_catalog_release','population_catalog_entry','population_geographic_concept','population_assertion','population_assertion_revision','population_idempotency_record','population_revision_territory','population_revision_group']:[])
      ,...(required.has('F13_OPERATIONAL_CAPACITY')?['operational_catalog_release','operational_catalog_entry','operational_assertion','operational_assertion_revision','operational_idempotency_record']:[])
      ,...(required.has('F13_FINANCIAL_CAPACITY')?['financial_catalog_release','financial_catalog_entry','financial_assertion','financial_assertion_revision','financial_idempotency_record']:[])
    ].sort(), required.has('F14_PQ1_DECISIONS')?75:required.has('F13_PQ1_ACTIVATION')?74:required.has('F13_PQ1_PUBLICATION')?68:required.has('F13_EDITORIAL_BASELINE_PUBLICATION')?58:required.has('F13_TERRITORIES_AND_POPULATIONS')?53:required.has('F13_OPERATIONAL_CAPACITY')?45:required.has('F13_FINANCIAL_CAPACITY')?40:required.has('F13_COMPETENCIES_AND_EXPERIENCE')?35:required.has('F13_PROFILE_AUTHORING')?27:22];
}

function buildCapabilitySpecifications(required) {
  const specifications = [
    ['F9_ASYNC_EXECUTION', 'async_exec', ['effect_fence', 'inbox', 'outbox', 'reconciliation_item'], 0],
    ['F7_AUDIT_LEDGER', 'audit',
      ['chain_head', 'checkpoint', 'event', 'event_2026_10', 'event_2026_11', 'event_default', 'event_identity'], 1],
    documentStorageSpecification(required),
    opportunityCatalogSpecification(required),
    organizationalScopeSpecification(required),
    profileCatalogSpecification(required)
  ];
  return specifications;
}

async function validateFeatureCapabilities(client, entry) {
  const required = new Set(entry.capabilities);
  if (required.has('ORGANIZATIONAL_OPPORTUNITY_INTERESTS')) await validateInterestCapabilities(client);
  const specifications = buildCapabilitySpecifications(required);
  for (const [capability, schema, tables, minimumRls] of specifications) {
    const rows = await client.query(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relkind IN ('r','p')
       ORDER BY c.relname`, [schema]);
    const names = rows.rows.filter(row => !isRotatingAuditTable(`${schema}.${row.table_name}`)).map(row => row.table_name);
    if (required.has(capability)) {
      if (JSON.stringify(names) !== JSON.stringify(tables)
          || rows.rows.filter(row => row.rls).length < minimumRls) refuse('CAPABILITY_EVIDENCE_MISMATCH');
    } else if (names.length !== 0) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  }
  async function validateDocumentTransportSecurity() {
    const security = (await client.query(`SELECT
      EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
        WHERE n.nspname='document_storage' AND c.relname='multipart_upload' AND c.relkind='r'
          AND r.rolname='c4g_document_owner' AND c.relrowsecurity AND c.relforcerowsecurity) AS table_contract,
      (SELECT count(*)=1 AND bool_and(p.polpermissive AND p.polcmd='*' AND p.polroles=ARRAY[0::oid]
          AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
          AND pg_catalog.pg_get_expr(p.polqual,p.polrelid,true)=pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,true)
          AND pg_catalog.pg_get_expr(p.polqual,p.polrelid,true) LIKE '%app.organization_id%')
        FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='document_storage' AND c.relname='multipart_upload'
          AND p.polname='multipart_upload_org_isolation') AS policy_contract,
      has_schema_privilege('c4g_document_runtime','document_storage','USAGE') AS schema_usage,
      has_table_privilege('c4g_document_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='document_storage' AND c.relname='multipart_upload'),'SELECT') AS table_read,
      (has_table_privilege('c4g_document_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='document_storage' AND c.relname='multipart_upload'),'INSERT')
        OR has_table_privilege('c4g_document_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='document_storage' AND c.relname='multipart_upload'),'UPDATE')
        OR has_table_privilege('c4g_document_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='document_storage' AND c.relname='multipart_upload'),'DELETE')
        OR has_table_privilege('c4g_document_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='document_storage' AND c.relname='multipart_upload'),'TRUNCATE')) AS table_write,
      has_table_privilege('c4g_document_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='document_storage' AND c.relname='multipart_part'),'INSERT') AS direct_part_write,
      (SELECT count(*)=5 AND bool_and(r.rolname='c4g_document_owner' AND p.prosecdef
          AND l.lanname='plpgsql' AND pg_catalog.array_to_string(p.proconfig,',')='search_path=pg_catalog, document_storage')
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        JOIN pg_catalog.pg_roles r ON r.oid=p.proowner JOIN pg_catalog.pg_language l ON l.oid=p.prolang
        WHERE n.nspname='document_storage' AND p.proname=ANY($1::text[])) AS function_contract,
      (SELECT count(*)=5 AND bool_and(has_function_privilege('c4g_document_runtime',p.oid,'EXECUTE')
          AND NOT has_function_privilege('public',p.oid,'EXECUTE'))
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='document_storage' AND p.proname=ANY($1::text[])) AS function_acl`, [[
      'register_multipart_upload','record_multipart_part','finish_multipart_upload',
      'claim_expired_multipart_uploads','claim_document_transport_recovery'
    ]])).rows[0];
    if (!security || !security.table_contract || !security.policy_contract || !security.schema_usage
        || !security.table_read || security.table_write || security.direct_part_write
        || !security.function_contract || !security.function_acl) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  
  }
  if (required.has('APPLICATION_DOCUMENT_TRANSPORT')) await validateDocumentTransportSecurity();
  async function validateOrganizationalScopeSecurity() {
    const security = await client.query(`SELECT
      (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='organizational_scope' AND c.relname IN ('scope','idempotency_record')) AS rls_exact,
      (SELECT count(*)=2 AND bool_and(p.polpermissive AND p.polcmd='*'
          AND p.polroles=ARRAY[0::oid] AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
          AND pg_catalog.pg_get_expr(p.polqual,p.polrelid,true)=pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,true))
         FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='organizational_scope'
          AND ((c.relname='scope' AND p.polname='scope_isolation')
            OR (c.relname='idempotency_record' AND p.polname='scope_idempotency_isolation'))) AS policies_exact,
      (SELECT count(*)=3 AND bool_and(NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
          AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
         FROM pg_catalog.pg_roles WHERE rolname IN ('c4g_organizational_scope_owner',
          'c4g_organizational_scope_migrator','c4g_organizational_scope_runtime')) AS roles_safe,
      pg_catalog.pg_has_role('c4g_organizational_scope_migrator','c4g_organizational_scope_owner','MEMBER') AS migrator_owns,
      pg_catalog.pg_has_role('c4g_organizational_scope_runtime','c4g_organizational_scope_owner','MEMBER') AS runtime_owns,
      pg_catalog.pg_has_role('c4g_organizational_scope_runtime','c4g_organizational_scope_migrator','MEMBER') AS runtime_migrates,
      has_schema_privilege('c4g_organizational_scope_runtime','organizational_scope','USAGE') AS schema_usage,
      has_schema_privilege('c4g_organizational_scope_runtime','organizational_scope','CREATE') AS schema_create,
      has_table_privilege('c4g_organizational_scope_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organizational_scope' AND c.relname='scope'),'SELECT,INSERT,UPDATE') AS scope_write,
      has_table_privilege('c4g_organizational_scope_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organizational_scope' AND c.relname='scope'),'DELETE,TRUNCATE,REFERENCES,TRIGGER') AS scope_destructive,
      has_table_privilege('c4g_organizational_scope_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organizational_scope' AND c.relname='idempotency_record'),'SELECT,INSERT') AS idempotency_write,
      has_table_privilege('c4g_organizational_scope_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organizational_scope' AND c.relname='idempotency_record'),'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS idempotency_destructive,
      has_schema_privilege('public','organizational_scope','USAGE,CREATE') AS public_schema,
      has_table_privilege('public',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organizational_scope' AND c.relname='scope'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS public_scope,
      has_table_privilege('public',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organizational_scope' AND c.relname='idempotency_record'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS public_idempotency`);
    const value = security.rows[0];
    if (!value || !value.rls_exact || !value.policies_exact || !value.roles_safe || !value.migrator_owns
        || value.runtime_owns || value.runtime_migrates || !value.schema_usage || value.schema_create
        || !value.scope_write || value.scope_destructive || !value.idempotency_write
        || value.idempotency_destructive || value.public_schema || value.public_scope || value.public_idempotency) {
      refuse('CAPABILITY_EVIDENCE_MISMATCH');
    }
  
  }
  if (required.has('F13_P1_ORGANIZATIONAL_SCOPE')) await validateOrganizationalScopeSecurity();
  async function validateProfileCatalogSecurity() {
    const security = await client.query(`SELECT
      (SELECT count(*)=${required.has('F14_PQ1_DECISIONS')?75:required.has('F13_PQ1_ACTIVATION')?74:required.has('F13_PQ1_PUBLICATION')?68:required.has('F13_EDITORIAL_BASELINE_PUBLICATION')?58:required.has('F13_TERRITORIES_AND_POPULATIONS')?53:required.has('F13_OPERATIONAL_CAPACITY')?45:required.has('F13_FINANCIAL_CAPACITY')?40:required.has('F13_COMPETENCIES_AND_EXPERIENCE')?35:required.has('F13_PROFILE_AUTHORING')?27:22} AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='organization_profile' AND c.relkind IN ('r','p')) AS rls_exact,
      (SELECT count(*)=3 AND bool_and(NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
          AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
         FROM pg_catalog.pg_roles WHERE rolname IN ('c4g_organization_profile_owner',
          'c4g_organization_profile_migrator','c4g_organization_profile_runtime')) AS roles_safe,
      pg_catalog.pg_has_role('c4g_organization_profile_migrator','c4g_organization_profile_owner','MEMBER') AS migrator_owns,
      pg_catalog.pg_has_role('c4g_organization_profile_runtime','c4g_organization_profile_owner','MEMBER') AS runtime_owns,
      has_schema_privilege('c4g_organization_profile_runtime','organization_profile','USAGE') AS schema_usage,
      has_schema_privilege('c4g_organization_profile_runtime','organization_profile','CREATE') AS schema_create,
      has_schema_privilege('public','organization_profile','USAGE,CREATE') AS public_schema,
      has_function_privilege('c4g_organization_profile_runtime',(SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='organization_profile' AND p.proname='lock_catalog_releases_mutable' AND p.proargtypes='2950 2950'::pg_catalog.oidvector),'EXECUTE') AS lock_execute,
      (SELECT count(*)=20 FROM (SELECT n.nspname AS table_schema,c.relname AS table_name,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee) catalog_table_privileges WHERE table_schema='organization_profile'
        AND grantee='c4g_organization_profile_runtime' AND table_name IN
          ('catalog_release','scheme','concept','concept_label','concept_relation','external_mapping','taxonomy_idempotency_record')
        AND ((table_name='taxonomy_idempotency_record' AND privilege_type IN ('SELECT','INSERT')) OR (table_name<>'taxonomy_idempotency_record' AND privilege_type IN ('SELECT','INSERT','UPDATE')))) AS runtime_taxonomy_grants,
      EXISTS(SELECT 1 FROM (SELECT n.nspname AS table_schema,c.relname AS table_name,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee) catalog_table_privileges WHERE table_schema='organization_profile'
        AND grantee='c4g_organization_profile_runtime' AND (table_name NOT IN
          ('catalog_release','scheme','concept','concept_label','concept_relation','external_mapping','taxonomy_idempotency_record'${required.has('F14_PQ1_DECISIONS')?",'pq1_decision'":''}${required.has('F13_PQ1_ACTIVATION')?",'pq1_effective_release','pq1_effective_snapshot','pq1_activation','profile_active_baseline','pq1_evaluation','pq1_effective_receipt'":''}${required.has('F13_PQ1_PUBLICATION')?",'pq1_candidate','pq1_candidate_author','pq1_version','pq1_publication','pq1_idempotency_record','pq1_release','pq1_method_descriptor','pq1_provenance','pq1_verification_status_event','pq1_ui_receipt'":''}${required.has('F13_EDITORIAL_BASELINE_PUBLICATION')?",'editorial_candidate','editorial_candidate_author','editorial_version','editorial_publication','editorial_idempotency_record','completion_policy','completion_slot','completion_rule','projection_policy','compatibility_manifest','release_bundle','reason_catalog_release','reason_catalog_entry','purpose_catalog_release','purpose_catalog_entry'":''}${required.has('F13_PROFILE_AUTHORING')?",'profile_scope','profile_draft','profile_draft_revision','profile_item_version','profile_revision_item','idempotency_record'":''}${required.has('F13_COMPETENCIES_AND_EXPERIENCE')?",'competency_catalog_release','competency_catalog_entry','competency_assertion_version','experience_evidence_version','competency_evidence_link','competency_verification_result','competency_revision_member','competency_idempotency_record'":''}${required.has('F13_FINANCIAL_CAPACITY')?",'financial_catalog_release','financial_catalog_entry','financial_assertion','financial_assertion_revision','financial_idempotency_record','metric_catalog_release','metric_definition'":''}${required.has('F13_TERRITORIES_AND_POPULATIONS')?",'population_catalog_release','population_catalog_entry','population_geographic_concept','population_assertion','population_assertion_revision','population_idempotency_record','population_revision_territory','population_revision_group'":''}${required.has('F13_OPERATIONAL_CAPACITY')?",'operational_catalog_release','operational_catalog_entry','operational_assertion','operational_assertion_revision','operational_idempotency_record'":''})
          OR (table_name='taxonomy_idempotency_record' AND privilege_type NOT IN ('SELECT','INSERT'))
          OR (table_name<>'taxonomy_idempotency_record' AND privilege_type NOT IN ('SELECT','INSERT','UPDATE')))) AS runtime_unexpected_grant,
      EXISTS(SELECT 1 FROM (SELECT n.nspname AS table_schema,c.relname AS table_name,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee) catalog_table_privileges WHERE table_schema='organization_profile'
        AND grantee='PUBLIC') AS public_table_grant`);
    const value=security.rows[0];
    if (!value?.rls_exact || !value.roles_safe || !value.migrator_owns || value.runtime_owns
        || !value.schema_usage || value.schema_create || value.public_schema || !value.lock_execute
        || !value.runtime_taxonomy_grants || value.runtime_unexpected_grant || value.public_table_grant) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  
  }
  if (required.has('F13_PROFILE_CATALOG_FOUNDATION')) await validateProfileCatalogSecurity();
  async function validateProfileGrants() {
    if(required.has('F14_PQ1_DECISIONS')){
    const rows=(await client.query(`SELECT a.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='organization_profile' AND c.relname='pq1_decision' AND r.rolname='c4g_organization_profile_runtime' ORDER BY a.privilege_type`)).rows;
    if(JSON.stringify(rows.map(r=>r.privilege_type))!==JSON.stringify(['INSERT','SELECT']))refuse('CAPABILITY_EVIDENCE_MISMATCH');
  }
  if (required.has('F13_PQ1_ACTIVATION')) {
    const grants=(await client.query(`SELECT c.relname,a.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='organization_profile' AND r.rolname='c4g_organization_profile_runtime' AND c.relname=ANY($1::text[])`,
      [['pq1_effective_release','pq1_effective_snapshot','pq1_activation','profile_active_baseline','pq1_evaluation','pq1_effective_receipt']])).rows;
    if(grants.length!==11 || grants.some(r=>r.relname==='pq1_effective_release'?r.privilege_type!=='SELECT':!['SELECT','INSERT'].includes(r.privilege_type))) refuse('CAPABILITY_EVIDENCE_MISMATCH');
    const update=(await client.query(`SELECT t.attname AS column_name,a.privilege_type FROM pg_catalog.pg_attribute t
      JOIN pg_catalog.pg_class c ON c.oid=t.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(t.attacl) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='organization_profile' AND c.relname='profile_active_baseline' AND r.rolname='c4g_organization_profile_runtime'
        AND a.privilege_type='UPDATE' ORDER BY t.attname`)).rows;
    if(JSON.stringify(update.map(r=>r.column_name))!==JSON.stringify(['activation_id','generation']))refuse('CAPABILITY_EVIDENCE_MISMATCH');
  }
  if (required.has('F13_PQ1_PUBLICATION')) {
    const rows = (await client.query(`SELECT c.relname,a.privilege_type FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='organization_profile' AND r.rolname='c4g_organization_profile_runtime'
      AND c.relname=ANY($1::text[])`, [['pq1_candidate','pq1_candidate_author','pq1_version','pq1_publication',
      'pq1_idempotency_record','pq1_release','pq1_method_descriptor','pq1_provenance','pq1_verification_status_event','pq1_ui_receipt']])).rows;
    if (rows.length !== 18 || rows.some(row => ['pq1_release','pq1_method_descriptor'].includes(row.relname)
      ? row.privilege_type !== 'SELECT' : !['SELECT','INSERT'].includes(row.privilege_type))) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  }
  if (required.has('F13_EDITORIAL_BASELINE_PUBLICATION')) {
    const rows = (await client.query(`SELECT c.relname,a.privilege_type FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='organization_profile' AND r.rolname='c4g_organization_profile_runtime'
      AND c.relname=ANY($1::text[]) ORDER BY c.relname,a.privilege_type`, [[
      'editorial_candidate','editorial_candidate_author','editorial_version','editorial_publication','editorial_idempotency_record',
      'completion_policy','completion_slot','completion_rule','projection_policy','compatibility_manifest','release_bundle',
      'reason_catalog_release','reason_catalog_entry','purpose_catalog_release','purpose_catalog_entry'
    ]])).rows;
    if (rows.length !== 20 || rows.some(row => row.relname.startsWith('editorial_')
      ? !['SELECT','INSERT'].includes(row.privilege_type) : row.privilege_type !== 'SELECT')) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  }
  }
  await validateProfileGrants();
  if (required.has('F12_PRIVATE_CATALOG_WRITE') !== required.has('F12_PRIVATE_CATALOG_READ')
      || required.has('F12_DEDUPLICATION') !== required.has('F12_PRIVATE_CATALOG_READ')) {
    refuse('CAPABILITY_EVIDENCE_MISMATCH');
  }
  if (required.has('F9_EXECUTION_LINEAGE') && !required.has('F9_ASYNC_EXECUTION')) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  async function validateExecutionLineage() {
    const lineageColumns = await client.query(`SELECT a.attname
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='async_exec' AND c.relname='outbox' AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname=ANY($1::text[]) ORDER BY a.attname`, [[
      'lineage_version','delivery_kind','attempt','root_execution_id','previous_execution_id',
      'content_digest','envelope_digest','replay_request_id'
    ]]);
  if (required.has('F9_EXECUTION_LINEAGE')) {
    if (lineageColumns.rows.length!==8) refuse('CAPABILITY_EVIDENCE_MISMATCH');
    const evidence=await client.query(`SELECT
      (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='async_exec' AND c.relname='f9_tenant_outbox_execution_v1') IS NOT NULL AS execution_index,
      (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='async_exec' AND c.relname='f9_tenant_outbox_replay_request_v1') IS NOT NULL AS replay_index,
      EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='async_exec' AND c.relname='outbox'
        AND t.tgname='guard_outbox_lineage_v1' AND NOT t.tgisinternal) AS immutable_guard,
      NOT EXISTS(SELECT 1 FROM async_exec.outbox WHERE lineage_version=0 AND state NOT IN('PUBLISHED','FAILED','CANCELLED')) AS legacy_drained,
      NOT EXISTS(SELECT 1 FROM async_exec.outbox WHERE lineage_version=1 AND
        (delivery_kind IS NULL OR attempt IS NULL OR root_execution_id IS NULL OR content_digest IS NULL OR envelope_digest IS NULL)) AS v1_complete`);
    const lineageEvidence = evidence.rows[0];
    if (!lineageEvidence || !['execution_index', 'replay_index', 'immutable_guard', 'legacy_drained', 'v1_complete']
      .every(key => lineageEvidence[key] === true)) refuse('CAPABILITY_EVIDENCE_MISMATCH');
    const opportunityOutbox=await client.query(`SELECT
      has_schema_privilege('c4g_opportunity_tenant_runtime','async_exec','USAGE') AS schema_usage,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='async_exec' AND c.relname='outbox'),'SELECT,INSERT') AS enqueue,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='async_exec' AND c.relname='outbox'),'UPDATE,DELETE,TRUNCATE') AS destructive`);
    if (!opportunityOutbox.rows[0]?.schema_usage || !opportunityOutbox.rows[0]?.enqueue || opportunityOutbox.rows[0]?.destructive !== false) {
      refuse('CAPABILITY_EVIDENCE_MISMATCH');
    }
  } else if (lineageColumns.rows.length!==0) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  }
  await validateExecutionLineage();
  async function validateAuditFunctions() {
    const functions = await client.query(`SELECT proname FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='audit' AND p.proname IN ('append_event_v1','prepare_append_v1')`);
    if (functions.rows.length !== 2) refuse('CAPABILITY_EVIDENCE_MISMATCH');
  
  }
  if (required.has('F7_AUDIT_LEDGER')) await validateAuditFunctions();
  async function validateCatalogWrite() {
    const grants = await client.query(`SELECT
      has_schema_privilege('c4g_opportunity_tenant_runtime','opportunity_catalog','USAGE') AS schema_usage,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='opportunity'),'SELECT,INSERT,UPDATE') AS opportunity_write,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='opportunity_document_binding'),'SELECT,INSERT') AS binding_write,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='opportunity_document_binding'),'UPDATE,DELETE,TRUNCATE') AS binding_destructive,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='opportunity'),'DELETE,TRUNCATE') AS destructive`);
    if (!grants.rows[0]?.schema_usage || !grants.rows[0]?.opportunity_write || !grants.rows[0]?.binding_write
        || grants.rows[0]?.binding_destructive || grants.rows[0]?.destructive) {
      refuse('CAPABILITY_EVIDENCE_MISMATCH');
    }
    const blockingIndexes = await client.query(`SELECT indexname,indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname='opportunity_catalog' AND indexname=ANY($1::text[])
      ORDER BY indexname`, [[
      'opportunity_block_closing_date', 'opportunity_block_content_digest', 'opportunity_block_opening_date',
      'provenance_source_identity', 'revision_block_thematic_codes', 'revision_block_territory_codes', 'revision_block_funder',
      'revision_block_official_url', 'revision_block_programme', 'revision_block_programme_reference',
      'revision_block_title'
    ]]);
    const definitions = new Map(blockingIndexes.rows.map(row => [row.indexname, row.indexdef]));
    const expected = {
      opportunity_block_closing_date: '(organization_id, closing_date, opportunity_id)',
      opportunity_block_content_digest: '(organization_id, content_digest, opportunity_id)',
      opportunity_block_opening_date: '(organization_id, opening_date, opportunity_id)',
      provenance_source_identity: '(organization_id, source_namespace, normalized_external_identifier)',
      revision_block_thematic_codes: "USING gin (((normalized_projection -> 'thematicCodes'::text)))",
      revision_block_territory_codes: "USING gin (((normalized_projection -> 'territoryCodes'::text)))",
      revision_block_funder: "(organization_id, ((normalized_projection ->> 'funderName'::text)), opportunity_id)",
      revision_block_official_url: "(organization_id, ((normalized_projection ->> 'officialUrl'::text)), opportunity_id)",
      revision_block_programme: "(organization_id, ((normalized_projection ->> 'programmeName'::text)), opportunity_id)",
      revision_block_programme_reference: "(organization_id, ((normalized_projection ->> 'programmeName'::text)), ((normalized_projection ->> 'callReference'::text)), opportunity_id)",
      revision_block_title: "(organization_id, ((normalized_projection ->> 'title'::text)), opportunity_id)"
    };
    if (definitions.size !== Object.keys(expected).length
        || Object.entries(expected).some(([name, fragment]) => !definitions.get(name)?.includes(fragment))) {
      refuse('CAPABILITY_EVIDENCE_MISMATCH');
    }
  
  }
  if (required.has('F12_PRIVATE_CATALOG_WRITE')) await validateCatalogWrite();
  async function validateCriteriaGrants() {
    const rows = await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
      has_table_privilege('c4g_opportunity_tenant_runtime',c.oid,'SELECT') AS can_read,
      has_table_privilege('c4g_opportunity_tenant_runtime',c.oid,'INSERT') AS can_insert,
      has_table_privilege('c4g_opportunity_tenant_runtime',c.oid,'UPDATE,DELETE,TRUNCATE') AS broad_write,
      has_any_column_privilege('c4g_opportunity_tenant_runtime',c.oid,'UPDATE') AS column_write
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='opportunity_catalog' AND c.relname IN ('criteria_set','criteria_revision','criteria_confirmation','criteria_receipt')`);
    if (rows.rows.length !== 4 || rows.rows.some(row => !row.relrowsecurity || !row.relforcerowsecurity
        || !row.can_read || !row.can_insert || row.broad_write || row.column_write !== (row.relname === 'criteria_set')))
      refuse('CAPABILITY_EVIDENCE_MISMATCH');
  
  }
  if (required.has('OPPORTUNITY_EVIDENCED_CRITERIA')) await validateCriteriaGrants();
  async function validateImportGrants() {
    const grants=await client.query(`SELECT
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='import_job'),'SELECT,INSERT') AS job_base,
      has_any_column_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='import_job'),'UPDATE') AS job_update,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='import_job'),'DELETE,TRUNCATE') AS job_destructive,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='import_row_outcome'),'SELECT,INSERT') AS row_base,
      has_any_column_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='import_row_outcome'),'UPDATE') AS row_update,
      has_table_privilege('c4g_opportunity_tenant_runtime',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname='import_row_outcome'),'DELETE,TRUNCATE') AS row_destructive`);
    const value=grants.rows[0];
    if(!value?.job_base||!value.job_update||value.job_destructive||!value.row_base||!value.row_update||value.row_destructive)
      refuse('CAPABILITY_EVIDENCE_MISMATCH');
  
  }
  if (required.has('F12_OPPORTUNITY_XLSX_IMPORT')) await validateImportGrants();
}

async function preflightTenantClient(client, expected, entries = manifest, loadMigration = migrationSql) {
  if (!client || typeof client.query !== 'function' || !exactExpected(expected)) {
    throw new TypeError('Tenant preflight input is invalid.');
  }
  try {
    const database = await validateDatabaseContract(client);
    const ledgerProbe = await client.query(`
      SELECT migration_id FROM c4g_system.schema_migration ORDER BY ordinal`);
    const currentMigration = ledgerProbe.rows.at(-1)?.migration_id || null;
    if (entries === manifest && currentMigration === failureReceiptManifest.at(-1).version) entries = failureReceiptManifest;
    if (entries === manifest && currentMigration === receiptManifest.at(-1).version) entries = receiptManifest;
    if (entries === manifest && currentMigration === assignedReviewManifest.at(-1).version) entries = assignedReviewManifest;
    if (entries === manifest && currentMigration === APPLICATION_CHAT_SCHEMA_VERSION) entries = applicationChatManifest;
    if (entries === manifest && currentMigration === ORGANIZATION_STRATEGY_SCHEMA_VERSION) entries = organizationStrategyManifest;
    if (entries === manifest && currentMigration === APPLICATION_TASK_DETAILS_SCHEMA_VERSION) entries = applicationTaskDetailsManifest;
    if (entries === manifest && currentMigration === DOCUMENT_DELETION_SCHEMA_VERSION) entries = documentDeletionManifest;
    if (entries === manifest && currentMigration === CHAT_RETENTION_SCHEMA_VERSION) entries = chatRetentionManifest;
    const currentEntry = entries.find(item => item.version === currentMigration);
    const allowedFeatureSchemas = currentEntry ? [
      currentEntry.capabilities.includes('F9_ASYNC_EXECUTION') && 'async_exec',
      currentEntry.capabilities.includes('F7_AUDIT_LEDGER') && 'audit',
      currentEntry.capabilities.includes('F11_PRIVATE_DOCUMENT_STORAGE') && 'document_storage',
      currentEntry.capabilities.includes('F12_PRIVATE_CATALOG_READ') && 'opportunity_catalog',
      currentEntry.capabilities.includes('F13_P1_ORGANIZATIONAL_SCOPE') && 'organizational_scope'
      ,currentEntry.capabilities.includes('F13_PROFILE_CATALOG_FOUNDATION') && 'organization_profile'
      ,currentEntry.capabilities.includes('F12_SERVICE_RECEIPTS') && 'f12_service_receipts'
      ,currentEntry.capabilities.includes('F12_REPLAY_FAILURE_RECEIPT') && 'f12_replay_failure'
    ].filter(Boolean) : [];
    const userSchemas = await client.query(`
      SELECT nspname AS schema_name
        FROM pg_catalog.pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
         AND nspname <> ALL($1::text[])
       ORDER BY nspname`, [['information_schema', 'public', 'c4g_system', 'c4g_app', ...allowedFeatureSchemas]]);
    if (userSchemas.rows.length !== 0) refuse('UNEXPECTED_SCHEMA');
    const marker = await client.query(`
      SELECT product_code, database_role, marker_format_version, tenant_id::text,
             database_generation_id::text, identity_revision
        FROM c4g_system.tenant_identity`);
    if (marker.rows.length !== 1) refuse('TENANT_MARKER_AMBIGUOUS');
    const identity = marker.rows[0];
    if (identity.product_code !== 'C4G' || identity.database_role !== 'TENANT'
        || Number(identity.marker_format_version) !== 1 || identity.tenant_id !== expected.tenantId
        || identity.database_generation_id !== expected.databaseGenerationId
        || Number(identity.identity_revision) !== 1) refuse('TENANT_MARKER_MISMATCH');
    const ledgerResult = await client.query(`
      SELECT migration_id, ordinal, checksum_sha256, irreversible, resulting_fingerprint
        FROM c4g_system.schema_migration
       ORDER BY ordinal`);
    let ledger;
    try { ledger = validateTenantLedger(ledgerResult.rows, entries, loadMigration); }
    catch { refuse('TENANT_LEDGER_MISMATCH'); }
    if (!ledger.currentVersion) refuse('TENANT_LEDGER_EMPTY');
    const entry = entries.find(item => item.version === ledger.currentVersion);
    if (!entry) refuse('TENANT_VERSION_UNKNOWN');
    const snapshot = await tenantSchemaSnapshot(client);
    if (snapshot.schemas.length + Number(Boolean(snapshot.failure)) !== 2 + allowedFeatureSchemas.length
        || snapshot.tables.some(row => row.schema_name === 'c4g_app')
        || snapshot.functions.some(row => row.schema_name === 'c4g_app')) refuse('TENANT_SCHEMA_SHAPE_MISMATCH');
    const fingerprint = tenantSchemaFingerprint(snapshot);
    if (fingerprint !== entry.schemaFingerprint) refuse('TENANT_SCHEMA_FINGERPRINT_MISMATCH');
    await validateRolesAndPrivileges(client, snapshot);
    await validateFeatureCapabilities(client, entry);
    const physical = await client.query('SELECT system_identifier::text AS system_identifier FROM pg_catalog.pg_control_system()');
    const systemIdentifier = physical.rows[0] && physical.rows[0].system_identifier;
    if (typeof systemIdentifier !== 'string' || !/^\d+$/.test(systemIdentifier)) {
      refuse('PHYSICAL_IDENTITY_UNAVAILABLE');
    }
    return issueTenantCapabilityEvidence(Object.freeze({
      postgresMajor: database.postgresMajor,
      tenantId: expected.tenantId,
      databaseGenerationId: expected.databaseGenerationId,
      currentVersion: ledger.currentVersion,
      appliedVersions: ledger.appliedVersions,
      schemaFingerprint: fingerprint,
      capabilities: Object.freeze([...entry.capabilities]),
      compatibility: entry.compatibility,
      systemIdentifier,
      securityContractVerified: true
    }));
  } catch (error) {
    if (isTenantMigrationFailure(error) || error instanceof TypeError) throw error;
    throw tenantMigrationFailure('TENANT_PREFLIGHT_FAILED');
  }
}

async function preflightTenant(pool, expected, entries = manifest, { timeoutMs, loadMigration = migrationSql } = {}) {
  if (!pool || typeof pool.connect !== 'function' || !exactExpected(expected)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('Tenant preflight pool or timeout is invalid.');
  }
  let client;
  let began = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    began = true;
    await client.query("SELECT set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
    const result = await preflightTenantClient(client, expected, entries, loadMigration);
    await client.query('COMMIT');
    began = false;
    const completedClient = client;
    client = null;
    try { completedClient.release(); }
    catch { throw tenantMigrationFailure('TENANT_PREFLIGHT_CLIENT_CLEANUP_FAILED'); }
    tenantCapabilityEvidencePools.set(result, pool);
    return result;
  } catch (error) {
    const primary = isTenantMigrationFailure(error) || error instanceof TypeError
      ? error
      : tenantMigrationFailure('TENANT_PREFLIGHT_FAILED');
    const cleanupFailures = [];
    if (began && client) {
      try { await client.query('ROLLBACK'); }
      catch { cleanupFailures.push(tenantMigrationFailure('TENANT_PREFLIGHT_ROLLBACK_FAILED')); }
    }
    if (client) {
      try { client.release(cleanupFailures[0]); }
      catch { cleanupFailures.push(tenantMigrationFailure('TENANT_PREFLIGHT_CLIENT_CLEANUP_FAILED')); }
      client = null;
    }
    if (cleanupFailures.length > 0 && isTenantMigrationFailure(primary)) {
      throw aggregateTenantMigrationFailures(primary, cleanupFailures);
    }
    if (cleanupFailures.length > 0) throw cleanupFailures[0];
    throw primary;
  }
}

module.exports = {
  EXPECTED_SEARCH_PATH,
  buildCapabilitySpecifications,
  SUPPORTED_POSTGRES_MAJOR,
  TENANT_ROLE_CONTRACT,
  isTenantCapabilityEvidence,
  isTenantCapabilityEvidenceForPool,
  preflightTenant,
  preflightTenantClient,
  validateDatabaseContract,
  validateFeatureCapabilities,
  validateRolesAndPrivileges
};
