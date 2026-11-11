'use strict';
// The local activation scripts run the tenant migration runner with a silent publisher, so the
// Central directory must be told about the new tenant schema explicitly. Without it the API
// resolves the snapshot from Central, sees the previous version and refuses the tenant
// (PHYSICAL_TENANT_MISMATCH), which surfaces as 503 on every tenant route.
const assert = require('node:assert/strict');

const ROW = `SELECT current_version, compatibility_state, revision, verified_capabilities, migration_lock_ref
  FROM public.tenant_schema_state WHERE tenant_id = $1`;

function createCentralPublisher(central) {
  return require('../../src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(
    require('../../src/security/tenantSchemaRepository').createTenantSchemaRepository(central));
}

// Returns IN_SYNC when Central already records the observed schema, STALE when it does not and
// apply is false, PUBLISHED after recording it. Never writes unless apply is true.
async function syncCentralObservation({ central, observation, tenantId, installationId, apply, publisher = createCentralPublisher(central) }) {
  assert.equal(observation?.tenantId, tenantId, 'CENTRAL_OBSERVATION_TENANT_MISMATCH');
  assert(typeof observation.currentVersion === 'string' && typeof observation.schemaFingerprint === 'string', 'CENTRAL_OBSERVATION_INVALID');
  const rows = (await central.query(ROW, [tenantId])).rows;
  assert.equal(rows.length, 1, 'CENTRAL_SCHEMA_STATE_MISSING');
  const row = rows[0];
  const revision = Number(row.revision);
  if (row.current_version === observation.currentVersion && row.compatibility_state === 'COMPATIBLE'
      && row.verified_capabilities?.schemaFingerprint === observation.schemaFingerprint) return { status: 'IN_SYNC', revision };
  if (!apply) return { status: 'STALE', revision, centralVersion: row.current_version };
  assert.equal(row.compatibility_state, 'COMPATIBLE', 'CENTRAL_SCHEMA_STATE_UNEXPECTED');
  assert.equal(row.migration_lock_ref, null, 'CENTRAL_SCHEMA_STATE_LOCKED');
  const published = await publisher.publish({ expectedRevision: revision, correlationId: installationId,
    idempotencyKey: `${installationId}-central-observation-${observation.currentVersion}`, evidence: observation });
  return { status: 'PUBLISHED', revision: Number(published.revision), centralVersion: row.current_version };
}

module.exports = { syncCentralObservation };
