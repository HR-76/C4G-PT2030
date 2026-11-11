const { migrationRecordMatches, requiredCentralMigrations } = require('./centralMigrationManifest');

function normalizeObservation(row) {
  const serverAddress = typeof row.server_address === 'string' ? row.server_address.trim().toLowerCase() : '';
  const serverPort = Number(row.server_port);
  const systemIdentifier = String(row.system_identifier || '').trim();
  const databaseOid = String(row.database_oid || '').trim();
  const databaseName = String(row.database_name || '').trim();
  if (!serverAddress || !Number.isInteger(serverPort) || serverPort <= 0 || !systemIdentifier || !databaseOid || !databaseName) {
    throw new Error('Central database did not expose a complete server identity.');
  }
  return { serverAddress, serverPort, systemIdentifier, databaseOid, databaseName, hasIdentityMarker: row.has_identity_marker === true };
}

async function assertCentralSchema(pool, admissionRequired = false) {
  const expected = requiredCentralMigrations();
  const ledger = await pool.query(
    `SELECT version, checksum_sha256, irreversible
       FROM public.c4g_schema_migration
      WHERE version = ANY($1::text[])`,
    [expected.map(item => item.version)]
  );
  for (const requirement of expected) {
    const record = ledger.rows.find(row => row.version === requirement.version);
    if (!record && requirement.version === '026_platform_logs') continue;
    if (!record && !admissionRequired && ['022_entity_admission','023_entity_registration_draft','024_organization_registration','025_entity_admission_completion'].includes(requirement.version)) continue;
    if (!migrationRecordMatches(record, requirement)) throw new Error('Central database migration state is incomplete or divergent.');
  }
  const relations = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS global_user,
            to_regclass($2) IS NOT NULL AS auth_identity_ref,
            to_regclass($3) IS NOT NULL AS platform_admin_assignment,
            to_regclass($4) IS NOT NULL AS application_session_store,
            to_regclass($5) IS NOT NULL AS oidc_transaction,
            to_regclass($6) IS NOT NULL AS application_session`,
    ['public.global_user','public.auth_identity_ref','public.platform_admin_assignment','public.application_session_store','public.oidc_transaction','public.application_session']
  );
  if (!relations.rows[0] || Object.values(relations.rows[0]).some(value => value !== true)) throw new Error('Central database schema is incomplete.');
}

async function observeCentralDatabase(pool, admissionRequired = false) {
  if (!pool || typeof pool.query !== 'function') throw new Error('Central database pool is unavailable.');
  const observed = await pool.query(
    `SELECT current_database() AS database_name,
            database_catalog.oid::text AS database_oid,
            (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier,
            inet_server_addr()::text AS server_address,
            inet_server_port() AS server_port,
            to_regclass($1) IS NOT NULL AS has_identity_marker
       FROM pg_catalog.pg_database AS database_catalog
      WHERE database_catalog.datname = current_database()`,
    ['public.c4g_database_identity']
  );
  if (!observed.rows || observed.rows.length !== 1) throw new Error('Central database identity was not observable.');
  const identity = normalizeObservation(observed.rows[0]);
  if (!identity.hasIdentityMarker) throw new Error('Central database marker is missing.');
  const marker = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM public.c4g_database_identity
        WHERE product_code = $1 AND database_role = $2
     ) AS matches`,
    ['C4G', 'CENTRAL']
  );
  if (!marker.rows || marker.rows.length !== 1 || marker.rows[0].matches !== true) throw new Error('Central database marker is invalid.');
  await assertCentralSchema(pool, admissionRequired);
  return identity;
}

function createDatabaseReadiness({ centralPool, admissionRequired = false }) {
  async function check() {
    try {
      await observeCentralDatabase(centralPool, admissionRequired);
      return { ready: true, dependencies: { central: { status: 'healthy' } } };
    } catch {
      return { ready: false, dependencies: { central: { status: 'unhealthy' } } };
    }
  }
  async function assertReady() { await observeCentralDatabase(centralPool, admissionRequired); }
  return Object.freeze({ check, assertReady });
}

module.exports = { createDatabaseReadiness, observeCentralDatabase, assertCentralSchema };
