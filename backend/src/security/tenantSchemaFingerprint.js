const crypto = require('node:crypto');
const { canonicalConstraints } = require('./postgresCatalogCompatibility');

const TENANT_SCHEMAS = Object.freeze([
  'async_exec', 'audit', 'c4g_app', 'c4g_system', 'document_storage', 'opportunity_catalog',
  'organizational_scope', 'organization_profile', 'f12_service_receipts'
]);

async function securityCatalogBatch(client, statements) {
  // Only adjacent reads within this fresh checkpoint share a statement. JSON
  // retains the existing column order; each subquery retains its own row order.
  const fields = Object.keys(statements);
  const result = await client.query('SELECT ' + fields.map(field =>
    `(SELECT COALESCE(json_agg(security_row), '[]'::json) FROM (${statements[field].trim()}) AS security_row) AS "${field}"`
  ).join(', '));
  const row = result?.rows?.[0];
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || !row || !fields.every(field => Array.isArray(row[field]))) {
    throw Object.assign(new Error('TENANT_SCHEMA_SNAPSHOT_INVALID'), { code: 'TENANT_SCHEMA_SNAPSHOT_INVALID' });
  }
  return Object.fromEntries(fields.map(field => [field, { rows: row[field] }]));
}

async function tenantSchemaSnapshot(client, schemasToInspect = TENANT_SCHEMAS) {
  // One fresh catalog statement at each checkpoint. JSON preserves the column
  // order used by the existing serialized fingerprints; JSONB would not.
  const result = await client.query(`SELECT
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT n.nspname AS schema_name, owner.rolname AS owner_name
      FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles owner ON owner.oid = n.nspowner
     WHERE n.nspname = ANY($1::text[])
     ORDER BY n.nspname) AS catalog_row) AS "schemas",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind AS relation_kind,
           owner.rolname AS owner_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = c.relowner
     WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p')
     ORDER BY n.nspname, c.relname) AS catalog_row) AS "tables",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT n.nspname AS schema_name, c.relname AS table_name, a.attnum AS ordinal,
           a.attname AS column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS not_null, a.attidentity AS identity_kind,
           a.attgenerated AS generated_kind,
           COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') AS default_expression
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p')
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY n.nspname, c.relname, a.attnum) AS catalog_row) AS "columns",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name,
           con.contype AS constraint_type,
           CASE WHEN con.contype='n' AND (NOT con.convalidated OR con.connoinherit
             OR (NOT (con.conislocal AND con.coninhcount=0) AND NOT (c.relispartition AND con.coninhcount=1))
             OR COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)=false)
             THEN 'UNSUPPORTED_NOT_NULL'
             WHEN con.contype='n' AND NOT con.condeferrable AND NOT con.condeferred
               AND array_ndims(con.conkey)=1 AND array_lower(con.conkey,1)=1 AND array_length(con.conkey,1)=1
               AND nn.attnum>0 AND NOT nn.attisdropped
             THEN 'NOT NULL '||pg_catalog.quote_ident(nn.attname)
             ELSE pg_catalog.pg_get_constraintdef(con.oid, true) END AS definition
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attribute nn ON con.contype='n' AND nn.attrelid = con.conrelid AND nn.attnum = con.conkey[1]
     WHERE n.nspname = ANY($1::text[])
     ORDER BY n.nspname, c.relname, con.conname) AS catalog_row) AS "constraints",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT schemaname AS schema_name, tablename AS table_name,
           indexname AS index_name, indexdef AS definition
      FROM pg_catalog.pg_indexes
     WHERE schemaname = ANY($1::text[])
     ORDER BY schemaname, tablename, indexname) AS catalog_row) AS "indexes",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname AS trigger_name,
           t.tgenabled AS enabled,
           pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1::text[]) AND NOT t.tgisinternal
     ORDER BY n.nspname, c.relname, t.tgname) AS catalog_row) AS "triggers",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT n.nspname AS schema_name, p.proname AS function_name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
           owner.rolname AS owner_name, l.lanname AS language,
           pg_catalog.pg_get_functiondef(p.oid) AS definition,
           p.provolatile AS volatility, p.proisstrict AS is_strict,
           p.prosecdef AS security_definer, p.proparallel AS parallel_safety,
           COALESCE(array_to_string(p.proconfig, ','), '') AS configuration
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = p.proowner
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE n.nspname = ANY($1::text[])
     ORDER BY n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) AS catalog_row) AS "functions"`, [schemasToInspect]);
  const row = result?.rows?.[0];
  const fields = ['schemas', 'tables', 'columns', 'constraints', 'indexes', 'triggers', 'functions'];
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || !row || !fields.every(field => Array.isArray(row[field]))) {
    throw Object.assign(new Error('TENANT_SCHEMA_SNAPSHOT_INVALID'), { code: 'TENANT_SCHEMA_SNAPSHOT_INVALID' });
  }
  // Retain the result shape for the unchanged security branches below. Every
  // branch still queries fresh evidence; no snapshot crosses a checkpoint.
  const { schemas, tables, columns, constraints, indexes, triggers, functions } =
    Object.fromEntries(fields.map(field => [field, { rows: row[field] }]));
  const hasOrganizationalScope = tables.rows.some(row => row.schema_name === 'organizational_scope' && row.table_name === 'scope');
  let organizationalScopeSecurity = null;
  if (hasOrganizationalScope) {
    const { relations, policies, roles, privileges } = await securityCatalogBatch(client, {
      relations: `
      SELECT c.relname AS table_name, owner.rolname AS owner_name,
             c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_roles owner ON owner.oid=c.relowner
       WHERE n.nspname='organizational_scope' AND c.relname IN ('scope','idempotency_record')
       ORDER BY c.relname`,
      policies: `
      SELECT c.relname AS table_name, p.polname AS policy_name, p.polpermissive AS permissive,
             p.polcmd AS command, ARRAY(SELECT COALESCE(r.rolname,'PUBLIC') FROM unnest(p.polroles) role_oid
               LEFT JOIN pg_catalog.pg_roles r ON r.oid=role_oid ORDER BY COALESCE(r.rolname,'PUBLIC'))::text AS roles,
             pg_catalog.pg_get_expr(p.polqual,p.polrelid,true) AS using_expression,
             pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,true) AS check_expression
        FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='organizational_scope' ORDER BY c.relname,p.polname`,
      roles: `
      SELECT rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
        FROM pg_catalog.pg_roles
       WHERE rolname IN ('c4g_organizational_scope_owner','c4g_organizational_scope_migrator','c4g_organizational_scope_runtime')
       ORDER BY rolname`,
      privileges: `SELECT
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
      has_table_privilege('public',(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organizational_scope' AND c.relname='idempotency_record'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS public_idempotency`
    });
    organizationalScopeSecurity = Object.freeze({ relations: relations.rows, policies: policies.rows,
      roles: roles.rows, privileges: privileges.rows[0] });
  }
  const hasOrganizationProfile = tables.rows.some(row => row.schema_name === 'organization_profile');
  let organizationProfileSecurity = null;
  if (hasOrganizationProfile) {
    const { relations, policies, roles, privileges } = await securityCatalogBatch(client, {
      relations: `
      SELECT c.relname AS table_name, owner.rolname AS owner_name,
             c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_roles owner ON owner.oid=c.relowner
       WHERE n.nspname='organization_profile' AND c.relkind IN ('r','p') ORDER BY c.relname`,
      policies: `
      SELECT c.relname AS table_name,p.polname AS policy_name,p.polcmd AS command,
             pg_catalog.pg_get_expr(p.polqual,p.polrelid,true) AS using_expression,
             pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,true) AS check_expression
        FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='organization_profile' ORDER BY c.relname,p.polname`,
      roles: `
      SELECT rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
        FROM pg_catalog.pg_roles
       WHERE rolname IN ('c4g_organization_profile_owner','c4g_organization_profile_migrator','c4g_organization_profile_runtime')
       ORDER BY rolname`,
      privileges: `SELECT
      pg_catalog.pg_has_role('c4g_organization_profile_migrator','c4g_organization_profile_owner','MEMBER') AS migrator_owns,
      pg_catalog.pg_has_role('c4g_organization_profile_runtime','c4g_organization_profile_owner','MEMBER') AS runtime_owns,
      has_schema_privilege('c4g_organization_profile_runtime','organization_profile','USAGE') AS schema_usage,
      has_schema_privilege('c4g_organization_profile_runtime','organization_profile','CREATE') AS schema_create,
      has_schema_privilege('public','organization_profile','USAGE,CREATE') AS public_schema,
      (SELECT count(*) FROM (SELECT n.nspname AS table_schema,c.relname AS table_name,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee) catalog_table_privileges WHERE table_schema='organization_profile'
        AND grantee='c4g_organization_profile_runtime' AND table_name IN
          ('catalog_release','scheme','concept','concept_label','concept_relation','external_mapping')
        AND privilege_type IN ('SELECT','INSERT','UPDATE'))::text AS runtime_taxonomy_grant_count,
      EXISTS(SELECT 1 FROM (SELECT n.nspname AS table_schema,c.relname AS table_name,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee) catalog_table_privileges WHERE table_schema='organization_profile'
        AND grantee='c4g_organization_profile_runtime' AND (table_name NOT IN
          ('catalog_release','scheme','concept','concept_label','concept_relation','external_mapping')
          OR privilege_type NOT IN ('SELECT','INSERT','UPDATE'))) AS runtime_unexpected_grant,
      EXISTS(SELECT 1 FROM (SELECT n.nspname AS table_schema,c.relname AS table_name,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee) catalog_table_privileges WHERE table_schema='organization_profile'
        AND grantee='PUBLIC') AS public_table_grant`
    });
    organizationProfileSecurity = Object.freeze({ relations: relations.rows, policies: policies.rows,
      roles: roles.rows, privileges: privileges.rows[0] });
    if(tables.rows.some(row=>row.table_name==='profile_draft')){
      const { acl, columns, schemaAcl, functionAcl } = await securityCatalogBatch(client, {
        acl: `SELECT c.relname object_name,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE n.nspname='organization_profile' ORDER BY c.relname,grantee,a.privilege_type`,
        columns: `SELECT c.relname object_name,t.attname column_name,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE n.nspname IN('organization_profile','organizational_scope') ORDER BY c.relname,t.attname,grantee,a.privilege_type`,
        schemaAcl: `SELECT n.nspname schema_name,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname IN('organization_profile','organizational_scope')
        ORDER BY n.nspname,grantee,a.privilege_type`,
        functionAcl: `SELECT n.nspname schema_name,p.proname function_name,
        pg_get_function_identity_arguments(p.oid) arguments,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE n.nspname IN('organization_profile','organizational_scope') ORDER BY n.nspname,p.proname,arguments,grantee,a.privilege_type`
      });
      organizationProfileSecurity=Object.freeze({...organizationProfileSecurity,authoringAcl:acl.rows,authoringColumnAcl:columns.rows,
        authoringSchemaAcl:schemaAcl.rows,authoringFunctionAcl:functionAcl.rows});
    }
    if(tables.rows.some(row=>row.table_name==='competency_assertion_version')){
      const { documentAcl, documentColumns, documentSchemas, documentFunctions } = await securityCatalogBatch(client, {
        documentAcl: `SELECT c.relname object_name,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='document_storage' ORDER BY c.relname,grantee,a.privilege_type`,
        documentColumns: `SELECT c.relname object_name,t.attname column_name,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='document_storage' ORDER BY c.relname,t.attname,grantee,a.privilege_type`,
        documentSchemas: `SELECT n.nspname,owner.rolname owner_name,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_namespace n JOIN pg_roles owner ON owner.oid=n.nspowner CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='document_storage' ORDER BY grantee,a.privilege_type`,
        documentFunctions: `SELECT p.proname,owner.rolname owner_name,pg_get_function_identity_arguments(p.oid) arguments,COALESCE(r.rolname,'PUBLIC') grantee,a.privilege_type,a.is_grantable
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE n.nspname='document_storage' ORDER BY p.proname,arguments,grantee,a.privilege_type`
      });
      organizationProfileSecurity=Object.freeze({...organizationProfileSecurity,competencyDocumentAcl:documentAcl.rows,competencyDocumentColumnAcl:documentColumns.rows,
        competencyDocumentSchemaAcl:documentSchemas.rows,competencyDocumentFunctionAcl:documentFunctions.rows});
    }
  }
  let runtimeMetadataSecurity=null;
  if(functions.rows.some(row=>row.schema_name==='c4g_system'&&row.function_name==='runtime_metadata_v1')){
    const { roles, members, acl } = await securityCatalogBatch(client, {
      roles: `SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
      FROM pg_catalog.pg_roles WHERE rolname IN('c4g_f4_metadata_owner','c4g_f4_metadata_executor') ORDER BY rolname`,
      members: `SELECT granted.rolname granted,member.rolname member,m.set_option,m.inherit_option,m.admin_option
      FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles granted ON granted.oid=m.roleid JOIN pg_catalog.pg_roles member ON member.oid=m.member
      WHERE (granted.rolname IN('c4g_f4_metadata_owner','c4g_f4_metadata_executor') OR member.rolname IN('c4g_f4_metadata_owner','c4g_f4_metadata_executor'))
        AND member.rolname<>'c4g_tenant_worker_capabilities' ORDER BY granted,member`,
      acl: `SELECT kind,object_name,COALESCE(r.rolname,'PUBLIC') grantee,privilege_type,is_grantable FROM (
      SELECT 'SCHEMA' kind,n.nspname object_name,a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
      UNION ALL SELECT 'TABLE',n.nspname||'.'||c.relname,a.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      UNION ALL SELECT 'COLUMN',n.nspname||'.'||c.relname||'.'||t.attname,a.* FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a
      UNION ALL SELECT 'FUNCTION',n.nspname||'.'||p.proname,a.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      UNION ALL SELECT 'DATABASE','CURRENT_DATABASE',a.* FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database()
    ) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee WHERE r.rolname IN('c4g_f4_metadata_owner','c4g_f4_metadata_executor')
      OR (kind='DATABASE' AND acl.grantee=0)
      OR object_name='c4g_system.runtime_metadata_v1' ORDER BY kind,object_name,grantee,privilege_type`
    });
    runtimeMetadataSecurity={roles:roles.rows,members:members.rows,acl:acl.rows};
  }
  let importWorkerSecurity=null;
  if(tables.rows.some(row=>row.schema_name==='opportunity_catalog'&&row.table_name==='import_job')){
    const { roles, acl } = await securityCatalogBatch(client, {
      roles: `SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
      FROM pg_catalog.pg_roles WHERE rolname='c4g_import_worker_runtime' ORDER BY rolname`,
      acl: `SELECT kind,object_name,privilege_type,is_grantable FROM (
      SELECT 'SCHEMA' kind,n.nspname object_name,a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
      UNION ALL SELECT CASE WHEN c.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,n.nspname||'.'||c.relname,a.*
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
      UNION ALL SELECT 'COLUMN',n.nspname||'.'||c.relname||'.'||t.attname,a.*
        FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a
      UNION ALL SELECT 'FUNCTION',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',a.*
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a
    ) direct_acl JOIN pg_roles r ON r.oid=direct_acl.grantee
    WHERE r.rolname='c4g_import_worker_runtime' ORDER BY kind,object_name,privilege_type`
    });
    importWorkerSecurity=Object.freeze({roles:roles.rows,acl:acl.rows});
  }
  let documentWorkerSecurity=null;
  if(tables.rows.some(row=>row.schema_name==='document_storage'&&row.table_name==='multipart_upload')){
    const enabled=await client.query(`SELECT EXISTS(SELECT 1 FROM pg_roles r JOIN pg_namespace n ON n.nspname='async_exec' CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE r.rolname='c4g_document_worker_runtime' AND a.grantee=r.oid AND a.privilege_type='USAGE') value`);
    if(enabled.rows[0]?.value){
      const { roles, acl } = await securityCatalogBatch(client, {
        roles: `SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_catalog.pg_roles WHERE rolname='c4g_document_worker_runtime'`,
        acl: `SELECT kind,object_name,privilege_type,is_grantable FROM (
        SELECT 'SCHEMA' kind,n.nspname object_name,a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
        UNION ALL SELECT 'TABLE',n.nspname||'.'||c.relname,a.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
        UNION ALL SELECT 'COLUMN',n.nspname||'.'||c.relname||'.'||t.attname,a.* FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a
        UNION ALL SELECT 'FUNCTION',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',a.* FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a
      ) direct_acl JOIN pg_roles r ON r.oid=direct_acl.grantee WHERE r.rolname='c4g_document_worker_runtime' ORDER BY kind,object_name,privilege_type`
      });
      documentWorkerSecurity=Object.freeze({roles:roles.rows,acl:acl.rows});
    }
  }
  const receiptSecurity = schemas.rows.some(row => row.schema_name === 'f12_service_receipts')
    ? await require('./f12ReceiptSchemaEvidence').f12ReceiptSchemaEvidence(
      client, 'f12_service_receipts', ['c4g_f12_receipt_issuer', 'c4g_opportunity_tenant_runtime'])
    : null;
  const failure = receiptSecurity && (await client.query(
    "SELECT to_regnamespace('f12_replay_failure') IS NOT NULL AS present")).rows[0]?.present
    ? await require('./f12ReplayFailureSchema').fingerprintReplayFailureSchema(client) : null;
  let applicationChatSecurity = null;
  if (tables.rows.some(row => row.schema_name === 'opportunity_catalog' && row.table_name === 'application_chat_message')) {
    const relations = `SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='opportunity_catalog' AND c.relname IN ('application_chat_message','application_chat_receipt')`;
    const evidence = await securityCatalogBatch(client, {
      tables: `SELECT relname,relrowsecurity,relforcerowsecurity FROM (${relations}) c ORDER BY relname`,
      policies: `SELECT c.relname,p.polname,p.polcmd,p.polpermissive,
        ARRAY(SELECT COALESCE(r.rolname,'PUBLIC') FROM unnest(p.polroles) AS role_oid
          LEFT JOIN pg_roles r ON r.oid=role_oid ORDER BY COALESCE(r.rolname,'PUBLIC')) AS roles,
        pg_get_expr(p.polqual,p.polrelid,true) AS using_expression,
        pg_get_expr(p.polwithcheck,p.polrelid,true) AS check_expression
        FROM (${relations}) c JOIN pg_policy p ON p.polrelid=c.oid ORDER BY c.relname,p.polname`,
      grants: `SELECT c.relname,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable
        FROM (${relations}) c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee ORDER BY c.relname,grantee,a.privilege_type`,
      columnGrants: `SELECT c.relname,t.attname,COALESCE(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable
        FROM (${relations}) c JOIN pg_attribute t ON t.attrelid=c.oid
        CROSS JOIN LATERAL aclexplode(t.attacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
        ORDER BY c.relname,t.attname,grantee,a.privilege_type`
    });
    applicationChatSecurity = Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, value.rows]));
  }
  return Object.freeze({
    schemas: schemas.rows,
    tables: tables.rows,
    columns: columns.rows,
    constraints: canonicalConstraints(constraints.rows),
    indexes: indexes.rows,
    triggers: triggers.rows,
    functions: functions.rows,
    ...(runtimeMetadataSecurity&&{runtimeMetadataSecurity}),
    ...(importWorkerSecurity&&{importWorkerSecurity}),
    ...(documentWorkerSecurity&&{documentWorkerSecurity}),
    ...(organizationalScopeSecurity && { organizationalScopeSecurity }),
    ...(organizationProfileSecurity && { organizationProfileSecurity }),
    ...(receiptSecurity && { receiptSecurity }),
    ...(applicationChatSecurity && { applicationChatSecurity }),
    ...(failure && { failure })
  });
}

function tenantSchemaFingerprint(snapshot) {
  if (snapshot.failure) {
    const { failure, ...base } = snapshot;
    return crypto.createHash('sha256').update(JSON.stringify({ base: tenantSchemaFingerprint(base), failure })).digest('hex');
  }
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

module.exports = { TENANT_SCHEMAS, tenantSchemaFingerprint, tenantSchemaSnapshot };
