'use strict';
// The registered tenant steps of the staging environment and the one way they are applied to a tenant database.
// Shared by the installer's `upgrade` command and by the admission worker, which brings a newly created database to the
// current schema (context/features/staging-entity-admission.md). Keeping one copy is the point: the path that the
// installer proved is the path the worker runs.
const { withInstallerAuthority, nativePool } = require('../localPlatform/installerAuthority');
const { syncCentralObservation } = require('../localPlatform/centralObservation');

const OPPORTUNITY_V2_PACKAGE = 'opportunity-v2-activation-11145';

// Each step names the version it leaves behind; steps already in the ledger are skipped, so applying can be repeated.
const TENANT_STEPS = Object.freeze([
  ['034_application_snapshot_v2', (runners, options) => runners.createRegisteredTenantMigrationRunner({ ...options, packageId: OPPORTUNITY_V2_PACKAGE })],
  ['035_application_review_assignments', (runners, options) => runners.createAssignedReviewMigrationRunner(options)],
  ['036_application_team_chat', (runners, options) => runners.createApplicationChatMigrationRunner(options)],
  ['037_organization_strategy', (runners, options) => runners.createOrganizationStrategyMigrationRunner(options)],
  ['038_application_task_details', (runners, options) => runners.createApplicationTaskDetailsMigrationRunner(options)],
  ['039_document_deletion', (runners, options) => runners.createDocumentDeletionMigrationRunner(options)],
  ['040_application_chat_retention', (runners, options) => runners.createChatRetentionMigrationRunner(options)],
  ['041_account_identity_erasure', (runners, options) => runners.createAccountIdentityErasureMigrationRunner(options)]
]);

const TENANT_HEAD_SQL = 'SELECT migration_id AS version FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1';
const pendingTenantSteps = head => TENANT_STEPS.filter(([to]) => to > head);

function refuse(code) {
  return Object.assign(new Error(code), { code });
}

// Applies the given registered steps to one tenant database, in order. After each step the database must be exactly on
// that version, and Central is told before the next step starts. Stops at the first failure; nothing is skipped.
// observationScope: Central admits one event per idempotency key across all tenants. The installed tenant keeps the
// installation's own keys; every other tenant must pass a scope of its own or its observation is refused.
async function applyTenantSteps({ steps, central, tenant, identity, installationId, observationScope = null, onStep = () => {}, dependencies = {} }) {
  const runners = dependencies.runners || require('../../src/security/tenantMigrationRunner');
  const preflight = dependencies.preflightTenant || require('../../src/security/tenantMigrationPreflight').preflightTenant;
  const authority = dependencies.withInstallerAuthority || withInstallerAuthority;
  const native = dependencies.nativePool || nativePool;
  const sync = dependencies.syncCentralObservation || syncCentralObservation;
  const applied = [];
  for (const [to, createRunner] of steps) {
    await authority(central, { targets: [central] }, async ({ demote }) => {
      await createRunner(runners, { pool: native(tenant), observationPublisher: { async publish() {} }, timeoutMs: 30000,
        scheduler: { setTimeout, clearTimeout } }).migrate({ ...identity, expectedRevision: 1, correlationId: installationId,
        idempotencyKey: `${installationId}-${identity.tenantId}-${to}` });
      await demote();
    });
    const observation = await preflight(tenant, identity, undefined, { timeoutMs: 15000 });
    if (observation.currentVersion !== to) throw refuse('STAGING_UPGRADE_TENANT_VERSION_UNEXPECTED');
    const synced = await sync({ central, observation, tenantId: identity.tenantId, installationId, apply: true, ...(observationScope ? { idempotencyScope: observationScope } : {}) });
    await onStep(observation);
    applied.push(`${to}:${synced.status}`);
  }
  return applied;
}

// The scope under which a database created by admission tells Central about its schema. The installer and the worker
// must agree on it, or one could not continue what the other started.
const onboardedObservationScope = (installationId, tenantId) => `${installationId}-${tenantId}`;

module.exports = Object.freeze({ OPPORTUNITY_V2_PACKAGE, TENANT_STEPS, TENANT_HEAD_SQL, pendingTenantSteps, applyTenantSteps, onboardedObservationScope });
