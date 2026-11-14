const crypto = require("node:crypto");
const { canonicalConstraints } = require('./postgresCatalogCompatibility');
const { manifest, knownManifest, allKnownMigrations = knownManifest } = require("./centralMigrationManifest");
const registeredManifest = allKnownMigrations;

function schemaFingerprintsForManifest(entries) {
  const versions = new Set();
  const fingerprints = new Set();
  const pairs = [];
  for (const entry of entries) {
    if (typeof entry.schemaFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.schemaFingerprint)) {
      throw new Error(`Central migration ${entry.version} has no valid schema fingerprint.`);
    }
    if (versions.has(entry.version)) {
      throw new Error(`Duplicate central migration version ${entry.version} in schema fingerprint manifest.`);
    }
    if (fingerprints.has(entry.schemaFingerprint)) {
      throw new Error(`Duplicate central schema fingerprint assigned to multiple migration versions.`);
    }
    versions.add(entry.version);
    fingerprints.add(entry.schemaFingerprint);
    pairs.push([entry.version, entry.schemaFingerprint]);
  }
  return Object.freeze(Object.fromEntries(pairs));
}

const EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION = schemaFingerprintsForManifest(registeredManifest.filter(entry=>entry.runtimeAdmissible!==false));
const EXPECTED_CENTRAL_SCHEMA_SHA256 = manifest.at(-1).schemaFingerprint;

async function centralSchemaSnapshot(client, {compact = false, compactAuthority = compact, nativeConstraints = false,
  includeF12Receipt = false, includeF12ReplayCapacity = false} = {}) {
  // One fresh catalog statement per checkpoint. JSON (not JSONB) retains the
  // selected column order used by the existing serialized schema fingerprints.
  // PG18's canonical NOT NULL definition needs only its quoted column name.
  // Keep every constraint and retain the deparser for all other shapes/flags.
  const primarySql = `SELECT
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END AS table_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY(ARRAY['public','async_exec','audit','opportunity_catalog']) AND c.relkind IN ('r', 'p')
       ORDER BY c.relname) AS catalog_row) AS "tables",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END AS table_name, a.attnum AS ordinal, a.attname AS column_name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
             a.attnotnull AS not_null, a.attidentity AS identity_kind, a.attgenerated AS generated_kind,
             COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') AS default_expression
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE n.nspname = ANY(ARRAY['public','async_exec','audit','opportunity_catalog']) AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY c.relname, a.attnum) AS catalog_row) AS "columns",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END AS table_name, con.conname AS constraint_name, con.contype AS constraint_type,
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
       WHERE n.nspname = ANY(ARRAY['public','async_exec','audit','opportunity_catalog'])
       ORDER BY c.relname, con.conname) AS catalog_row) AS "constraints",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT CASE WHEN schemaname='public' THEN tablename ELSE schemaname||'.'||tablename END AS table_name, indexname AS index_name, indexdef AS definition
        FROM pg_catalog.pg_indexes
       WHERE schemaname = ANY(ARRAY['public','async_exec','audit','opportunity_catalog'])
       ORDER BY tablename, indexname) AS catalog_row) AS "indexes",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT CASE WHEN n.nspname='public' THEN c.relname ELSE n.nspname||'.'||c.relname END AS table_name, t.tgname AS trigger_name,
             pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY(ARRAY['public','async_exec','audit','opportunity_catalog']) AND NOT t.tgisinternal
       ORDER BY c.relname, t.tgname) AS catalog_row) AS "triggers",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT n.nspname AS function_schema, p.proname AS function_name,
             pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
             l.lanname AS language, pg_catalog.pg_get_functiondef(p.oid) AS definition,
             p.provolatile AS volatility, p.proisstrict AS is_strict,
             p.prosecdef AS security_definer, p.proparallel AS parallel_safety,
             COALESCE(array_to_string(p.proconfig, ','), '') AS configuration
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang
       WHERE n.nspname = ANY(ARRAY['public','async_exec','audit','opportunity_catalog'])
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal)
       ORDER BY n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) AS catalog_row) AS "triggerFunctions",
    (SELECT COALESCE(json_agg(catalog_row), '[]'::json)
       FROM (SELECT seqstart::text,seqincrement::text,seqmin::text,seqmax::text,seqcache::text,seqcycle
    FROM pg_sequence WHERE seqrelid=to_regclass('public.authority_epoch_seq')) AS catalog_row) AS "authoritySequence"`;
  const transport = compact ? require('./catalogMetadataTransport') : null;
  const catalogSql = includeF12ReplayCapacity
    ? primarySql.replaceAll("'public','async_exec','audit','opportunity_catalog'",
      "'public','async_exec','audit','opportunity_catalog','f12_service_authority','f12_replay_capacity'")
    : includeF12Receipt
    ? primarySql.replaceAll("'public','async_exec','audit','opportunity_catalog'",
      "'public','async_exec','audit','opportunity_catalog','f12_service_authority'")
    : primarySql;
  const constraintSql = nativeConstraints ? await require('./catalogConstraintQuery').nativeConstraintSql(client,catalogSql) : catalogSql;
  const result = await client.query(compact ? transport.compactCatalogSql(constraintSql) : constraintSql);
  const row = compact ? transport.decodeCatalog(result?.rows?.[0]) : result?.rows?.[0];
  const fields = ['tables', 'columns', 'constraints', 'indexes', 'triggers', 'triggerFunctions', 'authoritySequence'];
  if (!Array.isArray(result?.rows) || result.rows.length !== 1 || !row || !fields.every(field => Array.isArray(row[field]))) {
    throw Object.assign(new Error('CENTRAL_SCHEMA_SNAPSHOT_INVALID'), { code: 'CENTRAL_SCHEMA_SNAPSHOT_INVALID' });
  }
  const { triggerFunctions, authoritySequence } = row;
  // Monthly audit partitions rotate operationally; only the baseline ones are fingerprinted.
  const { omitRotatingAuditPartitions: omitRotating } = require('./auditPartitionPolicy');
  const [tables, columns, constraints, indexes, triggers] =
    ['tables', 'columns', 'constraints', 'indexes', 'triggers'].map(field => omitRotating(row[field]));
  // Keep legacy insertion order and omit the same optional keys. Security
  // evidence remains separately collected; nothing is cached across calls/locks.
  const snapshot = { tables, columns, constraints: canonicalConstraints(constraints), indexes };
  if (authoritySequence.length) snapshot.authoritySequence = authoritySequence;
  if (authoritySequence.length) snapshot.authoritySecurity = await require('./authoritySecurityManifest').authoritySecuritySnapshot(client,{compact:compactAuthority});
  if (triggers.length) snapshot.triggers = triggers;
  if (triggerFunctions.length) snapshot.triggerFunctions = triggerFunctions;
  if (tables.some(row => row.table_name.startsWith('f12_service_authority.'))) {
    snapshot.receiptSecurity = await require('./f12ReceiptSchemaEvidence').f12ReceiptSchemaEvidence(
      client, 'f12_service_authority', ['c4g_f12_guard_issuer', 'c4g_f12_guard_recovery']);
  }
  if (includeF12ReplayCapacity) {
    snapshot.replayCapacitySecurity = await require('./f12ReceiptSchemaEvidence').f12ReceiptSchemaEvidence(
      client, 'f12_replay_capacity', ['c4g_f12_capacity_replay', 'c4g_f12_guard_recovery']);
  }
  const catalogReader = await require('./catalogReaderSecurity').catalogReaderSnapshot(client);
  if (catalogReader) snapshot.catalogReader = catalogReader;
  return snapshot;
}

function schemaFingerprint(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

// This snapshot is local to one validation call. Never retain it across a lock,
// transaction, request or connection checkout.
async function validateCentralSchemaSnapshot(client, snapshot, version, observedFingerprint) {
  const expectedFingerprint = EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION[version];
  if (!expectedFingerprint) throw new Error(`Central schema fingerprint is not defined for ${version}.`);
  if (observedFingerprint !== expectedFingerprint && !require('./memberEmailAdmission').admits(version, 'schema', observedFingerprint)
    && !require('./stagingCentralRuntimeAdmission').admits(version, 'schema', observedFingerprint)) {
    throw new Error(`Central schema drift detected for ${version} (observed fingerprint ${observedFingerprint}).`);
  }
  if(registeredManifest.find(entry=>entry.version===version)?.authoritySecurityFingerprint)
    require('./authoritySecurityManifest').assertAuthoritySecuritySnapshot(snapshot.authoritySecurity,version);
  const catalogFingerprint=registeredManifest.find(entry=>entry.version===version)?.catalogSecurityFingerprint;
  if(catalogFingerprint)await require('./catalogSecurityManifest').assertCatalogSecurity(client,catalogFingerprint);
  const writerFingerprint=registeredManifest.find(entry=>entry.version===version)?.euWriterSecurityFingerprint;
  if(writerFingerprint)await require('./euWriterSecurityManifest').assertEuWriterSecurity(client,writerFingerprint);
  const reconciliationFingerprint=registeredManifest.find(entry=>entry.version===version)?.euRunReconciliationSecurityFingerprint;
  if(reconciliationFingerprint)await require('./euRunReconciliationSecurityManifest').assertEuRunReconciliationSecurity(client,reconciliationFingerprint);
  const prearchiveFingerprint=registeredManifest.find(entry=>entry.version===version)?.euLegacyPrearchiveSecurityFingerprint;
  if(prearchiveFingerprint)await require('./euLegacyPrearchiveSecurityManifest').assertEuLegacyPrearchiveSecurity(client,prearchiveFingerprint);
  const readFingerprint=registeredManifest.find(entry=>entry.version===version)?.readFingerprint;
  if(readFingerprint && await require('../opportunities/catalogRead/dedicatedCredentials').normalReadFingerprint(client)!==readFingerprint)throw Error('CATALOG_READ_SCHEMA_DRIFT');
  if(registeredManifest.find(entry=>entry.version===version)?.centralImportSecurity)await require('./centralImportSecurity').assertCentralImportSecurity(client);
  return observedFingerprint;
}

async function assertCentralSchema(client, version = manifest.at(-1).version) {
  const snapshot = await centralSchemaSnapshot(client,{compactAuthority:true,includeF12Receipt:version==='036_f12_service_authority',
    includeF12ReplayCapacity:['037_f12_replay_capacity','038_f12_replay_failure_capacity'].includes(version)});
  return validateCentralSchemaSnapshot(client, snapshot, version, schemaFingerprint(snapshot));
}

async function assertCentralSchemaForVersions(client, versions) {
  if (!Array.isArray(versions) || !versions.length || versions.some(version => !Object.hasOwn(EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION, version)))
    throw Object.assign(new Error('CENTRAL_SCHEMA_VERSION_NOT_ADMITTED'), { code: 'CENTRAL_SCHEMA_VERSION_NOT_ADMITTED' });
  const capacity = versions.includes('037_f12_replay_capacity') || versions.includes('038_f12_replay_failure_capacity');
  const snapshot = await centralSchemaSnapshot(client,{compactAuthority:true,includeF12Receipt:versions.includes('036_f12_service_authority'),
    includeF12ReplayCapacity:capacity && (await client.query("SELECT to_regclass('f12_replay_capacity.reservation') IS NOT NULL AS installed")).rows[0]?.installed === true});
  const fingerprint = schemaFingerprint(snapshot);
  const entry = registeredManifest.find(item => versions.includes(item.version) && (item.schemaFingerprint === fingerprint || require('./memberEmailAdmission').admits(item.version, 'schema', fingerprint)));
  if (!entry) throw Object.assign(new Error('CENTRAL_SCHEMA_VERSION_NOT_ADMITTED'), { code: 'CENTRAL_SCHEMA_VERSION_NOT_ADMITTED' });
  await validateCentralSchemaSnapshot(client, snapshot, entry.version, fingerprint);
  return Object.freeze({ version: entry.version, fingerprint });
}

module.exports = {
  EXPECTED_CENTRAL_SCHEMA_SHA256,
  EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION,
  schemaFingerprintsForManifest,
  centralSchemaSnapshot,
  schemaFingerprint,
  assertCentralSchema,
  assertCentralSchemaForVersions
};
