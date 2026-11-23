'use strict';

// Staging installer for the VPS: Central and tenant schemas, first organization, tenant directory entry,
// the read-only catalog login and the people who may sign in. Contract: context/features/staging-vps-deployment.md.
//
// It runs as a one-off container in the PostgreSQL container's network namespace, so the administrator
// connection is loopback and never crosses a network:
//   docker run --rm --network container:<postgres> --env-file <postgres>/.env -v <state>:/state <image> \
//     node scripts/staging/install.js install
// Commands: install
//           | person --subject <uuid> --name <text> --email <address> [--platform-admin] [--profile <code> | --org-admin]
//           | env [--out <file>] [--carry <previous private env>] [--collection <5|all>] [--storage <R2 values file>]
//           | storage-check   (inside the API container: R2 buckets and the ClamAV scanner answer; prints only booleans)
//           | upgrade [--apply]   (without --apply it only reports the pending steps)
//           | runtime-logins      (after upgrade: creates the API and worker Central logins and checks the schema)
//           | members [--prepare] [--out <folder>] [--keycloak-internal <origin>]   (member invitations; see below)
// Profiles: ORG_ADMIN (Administrador), FUNDING_MANAGER (Gestor de candidaturas), CONTRIBUTOR (Técnico), VIEWER.
// Secrets are generated on first use, kept in the state file (mode 600) and written only to files, never printed.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Pool, escapeLiteral } = require('pg');
const { connection, identifier, saveState } = require('../localPlatform/config');
const { withInstallerAuthority, nativePool } = require('../localPlatform/installerAuthority');
const { syncCentralObservation } = require('../localPlatform/centralObservation');
const { initialState, installSchemas } = require('../localPlatform/schema');
const { parseArguments, requirePerson, requireProfile, projectionOperationId, stagingTarget, apiPrivateEnvironment, carriedSettings,
  memberHttpConfiguration, memberWorkerConfiguration, memberTarget, MEMBER_CLIENTS, ADMISSION_CALLBACK_PATH, admissionWorkerConfiguration,
  CATALOG_LOGIN, CENTRAL_API_LOGIN, CENTRAL_WORKER_LOGIN, workerCentralEnvironment, AUTH_POLICY_VERSION } = require('./environment');

const STAGING_ADMISSION = require('../../src/security/stagingCentralRuntimeAdmission');

const FUNDING_QUEUE = 'funding-tenders-refresh';

function refuse(code) {
  return Object.assign(new Error(code), { code });
}

function settings(env) {
  if (!env.POSTGRES_PASSWORD) throw refuse('STAGING_POSTGRES_PASSWORD_REQUIRED');
  return {
    config: { host: 'localhost', port: Number(env.C4G_STAGING_PG_PORT || 5432), user: 'postgres', password: env.POSTGRES_PASSWORD,
      centralDatabase: env.C4G_STAGING_CENTRAL_DB || 'c4g_central_staging', tenantDatabase: env.C4G_STAGING_TENANT_DB || 'c4g_tenant_staging' },
    stateFile: env.C4G_STAGING_STATE || '/state/install.json',
    apiHost: env.C4G_STAGING_API_DB_HOST || 'c4g-postgres',
    organization: { legalName: env.C4G_STAGING_ORG_NAME || 'C4G Staging', slug: env.C4G_STAGING_ORG_SLUG || 'c4g-staging' }
  };
}

const readState = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

async function registerOrganization(central, state, organization) {
  await central.query(`INSERT INTO public.organization(id, legal_name, display_name, slug, type_code, status, reporting_currency, mfa_policy_code)
    VALUES($1, $2, $2, $3, 'UNSPECIFIED', 'ACTIVE', 'EUR', 'USER_OPTIONAL') ON CONFLICT(id) DO NOTHING`,
  [state.organizationId, organization.legalName, organization.slug]);
  state.snapshot = await require('../../src/platformOnboarding/registerExistingTenant')
    .registerExistingTenant({ pool: central, snapshot: state.snapshot, correlationId: state.installationId });
}

// The catalog login only reads the opportunity catalog (member of c4g_catalog_reader, no inheritance).
async function ensureCatalogReader(central, state, database) {
  const login = identifier(CATALOG_LOGIN);
  const password = state.staging.catalogPassword;
  if ((await central.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [CATALOG_LOGIN])).rowCount) {
    await central.query(`ALTER ROLE ${login} PASSWORD '${password}'`);
  } else {
    const client = await central.connect();
    try { await require('../provisionCatalogReader').provisionCatalogReader(client, { login: CATALOG_LOGIN, password }); } finally { client.release(); }
  }
  await central.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${login}`);
}

// Runtime logins of the API and the worker (context/features/staging-central-runtime-login.md). Created here, by the
// administrator, so the NOSUPERUSER role never needs CREATEROLE. Their only membership is c4g_central_runtime, and the
// check below refuses anything else on every run, including a login that already exists.
async function ensureCentralRuntimeLogin(central, login, password, database) {
  if (!(await central.query("SELECT 1 FROM pg_roles WHERE rolname = 'c4g_central_runtime'")).rowCount) throw refuse('STAGING_CENTRAL_RUNTIME_ROLE_MISSING');
  const name = identifier(login);
  if ((await central.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [login])).rowCount) {
    await central.query(`ALTER ROLE ${name} PASSWORD ${escapeLiteral(password)}`);
  } else {
    await central.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(password)}`);
  }
  // Idempotent: restores the membership if it was removed; the check below refuses any other shape.
  await central.query(`GRANT c4g_central_runtime TO ${name} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE`);
  await central.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${name}`);
  const role = (await central.query(`SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
    COALESCE((SELECT string_agg(g.rolname::text, ',' ORDER BY g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid), '') AS memberships
    FROM pg_roles r WHERE r.rolname = $1`, [login])).rows[0];
  if (!role || !role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls
    || role.memberships !== 'c4g_central_runtime') throw refuse('STAGING_CENTRAL_LOGIN_INVALID');
}

// The queue the collection worker reads. The pgboss schema is not part of the Central migrations, so it is installed
// here from the pinned pg-boss plan when missing; the plan digest is checked before anything runs.
async function ensureFundingQueue(config, central) {
  if (!(await central.query("SELECT to_regclass('pgboss.version') IS NOT NULL AS installed")).rows[0].installed) {
    const { manifest } = require('../../src/async/migrationManifest');
    const plan = fs.readFileSync(path.join(__dirname, '../../database/central/pgboss/045_pg_boss_12_37_0.sql'), 'utf8').replaceAll('\r\n', '\n');
    if (!plan.includes(`Upstream plan SHA-256 before whitespace normalization: ${manifest.central.planDigest}`)) throw refuse('STAGING_PGBOSS_PLAN_MISMATCH');
    await central.query(plan);
  }
  const url = new URL('postgresql://localhost');
  url.hostname = config.host; url.port = String(config.port); url.username = config.user; url.password = config.password;
  url.pathname = '/' + config.centralDatabase;
  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss({ connectionString: url.toString(), schema: 'pgboss', createSchema: false, migrate: false, supervise: false, schedule: false });
  boss.on('error', () => {});
  await boss.start();
  try {
    if (!(await boss.getQueue(FUNDING_QUEUE))) await boss.createQueue(FUNDING_QUEUE, { retryLimit: 0 });
  } finally { await boss.stop({ graceful: true, close: true }); }
}

// Runtime logins are created only after the Central chain is complete (`upgrade`). Their memberships change the schema and
// authority fingerprints of every version from 036 on, so they must not exist while migrations are still being applied.
async function runtimeLogins(env) {
  const { config, stateFile } = settings(env);
  const state = readState(stateFile);
  if (state?.phase !== 'READY' || !state.staging?.centralApiPassword || !state.staging?.centralWorkerPassword) throw refuse('STAGING_INSTALLATION_NOT_READY');
  const central = new Pool(connection(config, config.centralDatabase));
  try {
    await ensureCentralRuntimeLogin(central, CENTRAL_API_LOGIN, state.staging.centralApiPassword, config.centralDatabase);
    await ensureCentralRuntimeLogin(central, CENTRAL_WORKER_LOGIN, state.staging.centralWorkerPassword, config.centralDatabase);
    const checked = await require('../../src/security/centralMigrationPreflight').preflightCentral(central);
    return { logins: [CENTRAL_API_LOGIN, CENTRAL_WORKER_LOGIN], centralVersion: checked.currentVersion };
  } finally { await central.end(); }
}

async function install(env) {
  const { config, stateFile, apiHost, organization } = settings(env);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  const state = readState(stateFile) ?? initialState(config);
  state.staging ??= {};
  state.staging.catalogPassword ??= randomBytes(32).toString('hex');
  state.staging.centralApiPassword ??= randomBytes(32).toString('hex');
  state.staging.centralWorkerPassword ??= randomBytes(32).toString('hex');
  const persist = value => saveState(value, stateFile);
  persist(state);
  await installSchemas(config, state, persist, stagingTarget({ apiHost }));
  const central = new Pool(connection(config, config.centralDatabase));
  try {
    await registerOrganization(central, state, organization);
    await ensureCatalogReader(central, state, config.centralDatabase);
    await ensureFundingQueue(config, central);
    const checked = await require('../../src/security/centralMigrationPreflight').preflightCentral(central);
    state.phase = 'READY';
    persist(state);
    return { organizationId: state.organizationId, tenantId: state.tenantId, centralVersion: checked.currentVersion,
      tenantVersion: state.snapshot.schema.currentVersion };
  } finally { await central.end(); }
}

// The policy the API runs with, so the authority state matches what it will check.
function policyFor() {
  const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../src/security/authConfig');
  const policy = RECOGNIZED_ASSURANCE_POLICIES[AUTH_POLICY_VERSION];
  return { policyVersion: AUTH_POLICY_VERSION, requirement: policy.policy[policy.privilegedCategory] };
}

async function person(env, args) {
  const { config, stateFile } = settings(env);
  const state = readState(stateFile);
  if (state?.phase !== 'READY') throw refuse('STAGING_INSTALLATION_NOT_READY');
  const issuer = env.OIDC_ISSUER || env.C4G_STAGING_OIDC_ISSUER;
  if (!/^https:\/\/[^\s]+$/.test(issuer || '')) throw refuse('STAGING_ISSUER_REQUIRED');
  const { policyVersion, requirement } = policyFor();
  const { subject, name, email } = requirePerson(args);
  const profile = requireProfile(args);
  const central = new Pool(connection(config, config.centralDatabase));
  const authority = new Pool({ ...connection(config, config.centralDatabase), user: 'c4g_authority_runtime', password: state.authorityPassword });
  try {
    const known = (await central.query('SELECT global_user_id FROM public.auth_identity_ref WHERE issuer = $1 AND subject = $2', [issuer, subject])).rows[0];
    const userId = known?.global_user_id ?? randomUUID();
    let membershipId = null;
    const client = await central.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO public.global_user(id, display_name, primary_email, status) VALUES($1, $2, $3, 'ACTIVE') ON CONFLICT(id) DO NOTHING`, [userId, name, email]);
      await client.query('INSERT INTO public.auth_identity_ref(id, global_user_id, issuer, subject) VALUES($1, $2, $3, $4) ON CONFLICT(issuer, subject) DO NOTHING',
        [randomUUID(), userId, issuer, subject]);
      if (args['platform-admin']) {
        await client.query(`INSERT INTO public.platform_admin_assignment(id, global_user_id, role_code, status)
          SELECT $1, $2, 'C4G_ADMIN', 'ACTIVE' WHERE NOT EXISTS(SELECT 1 FROM public.platform_admin_assignment WHERE global_user_id = $2)`, [randomUUID(), userId]);
      }
      if (profile) membershipId = await ensureMembership(client, state, userId, profile);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    let projected = false;
    if (membershipId) {
      await applyProfileGrants({ authority, central, state, membershipId, profile, policyVersion, requirement });
      projected = await projectIntoTenant({ config, state, userId, membershipId, name, email });
    }
    return { userId, membershipId, profile, platformAdmin: Boolean(args['platform-admin']), projected };
  } finally { await authority.end(); await central.end(); }
}

// One non-removed membership per person; a different profile is changed in the application, not here.
async function ensureMembership(client, state, userId, profile) {
  const existing = (await client.query(`SELECT id, organization_id, base_role_code FROM public.organization_membership
    WHERE global_user_id = $1 AND status IN ('PENDING_PROJECTION', 'ACTIVE', 'SUSPENDED')`, [userId])).rows[0];
  if (existing && existing.organization_id !== state.organizationId) throw refuse('STAGING_MEMBERSHIP_CONFLICT');
  if (existing && existing.base_role_code !== profile) throw refuse('STAGING_MEMBERSHIP_PROFILE_CONFLICT');
  if (existing) return existing.id;
  const membershipId = randomUUID();
  await client.query(`INSERT INTO public.organization_membership(id, global_user_id, organization_id, base_role_code, status, activated_at)
    VALUES($1, $2, $3, $4, 'ACTIVE', clock_timestamp())`, [membershipId, userId, state.organizationId, profile]);
  return membershipId;
}

const permissionsOf = grants => JSON.stringify(grants.map(grant => `${grant.permission}|${grant.scope?.type}|${grant.scope?.id}|${grant.resourceId ?? ''}`).sort());

// The grants the application itself gives the profile, so the account behaves like one created through it.
async function applyProfileGrants({ authority, central, state, membershipId, profile, policyVersion, requirement }) {
  const coordinator = require('../../src/security/authorityCoordinator').createAuthorityCoordinator({ pool: authority, permitSecret: state.permitSecret });
  const catalogs = require('../../src/authorization/catalogs').createProductionCatalogs({ catalogVersion: 'f13' });
  const data = require('../../src/authorization/authorityDataRepository').createAuthorityDataRepository({ coordinator, catalogs,
    policyVersion, recentMfaRequirement: requirement });
  const { grantsForProfile } = require('../../src/organizationDirectory/accessProfiles');
  const prior = (await central.query('SELECT authorization_version, policy_version, grants FROM public.authority_f5_state WHERE membership_id = $1', [membershipId])).rows[0];
  // Accounts created under the mandatory-MFA policy move to the current one, as the local installer does.
  const policyChanged = Boolean(prior) && prior.policy_version !== policyVersion;
  if (policyChanged && prior.policy_version !== 'c4g-assurance-v1') throw refuse('STAGING_AUTHORITY_POLICY_CONFLICT');
  const grants = grantsForProfile({ organizationId: state.organizationId, profileCode: profile, previousProfile: prior ? profile : undefined, previousGrants: prior?.grants });
  if (prior && !policyChanged && permissionsOf(prior.grants) === permissionsOf(grants)) return;
  await data.change({ organizationId: state.organizationId, membershipId, expectedVersion: prior ? Number(prior.authorization_version) : 0,
    assuranceRequirements: requirement, grants });
}

// The person and profile rows the tenant directory expects for every member. Repeating it is a no-op.
async function projectIntoTenant({ config, state, userId, membershipId, name, email }) {
  const credentials = { ...state.credentials, host: config.host, port: config.port, ssl: false };
  await require('../../src/platformOnboarding/memberProjection').createMemberProjection({
    bindings: [{ organizationId: state.organizationId, snapshot: state.snapshot, credentials }] })
    .ensure({ operationId: projectionOperationId(membershipId), organizationId: state.organizationId, globalUserId: userId, membershipId,
      input: { adminName: name, adminEmail: email } });
  return true;
}

// Registered packages after the base install, in the order the local environment applied them. Each step names the
// version it leaves behind; steps already in the ledger are skipped, so the command can be repeated.
const OPPORTUNITY_V2_PACKAGE = 'opportunity-v2-activation-11145';
const CENTRAL_STEPS = Object.freeze([
  ['042_opportunity_eu_source_control_v2', (run, pool) => run.applyRegisteredCentralPackage(pool, OPPORTUNITY_V2_PACKAGE)],
  ['043_opportunity_eu_writer_v2', (run, pool) => run.applyRegisteredEuWriterPackage(pool, 'opportunity-eu-writer-v2')],
  ['044_opportunity_eu_expired_reconciliation', (run, pool) => run.applyRegisteredEuReconciliationPackage(pool, 'opportunity-eu-expired-reconciliation-v1')],
  ['045_opportunity_eu_legacy_prearchive', (run, pool) => run.applyRegisteredEuLegacyPrearchivePackage(pool, 'opportunity-eu-legacy-prearchive-v1')],
  ['048_catalog_read_service_v1', (run, pool) => run.applyRegisteredCatalogReadPackage(pool, 'catalog-read-v1')],
  ['049_pt2030_document_upload', (run, pool) => run.applyRegisteredCentralImportPackage(pool, 'central-pt2030-upload-preview-v1')],
  ['050_billing_private_documents', (run, pool) => run.applyRegisteredBillingPdfsPackage(pool, 'billing-private-documents-v1')],
  ['051_email_templates', (run, pool) => run.applyRegisteredEmailTemplatesPackage(pool, 'email-templates-v1')],
  ['052_central_runtime_read', (run, pool) => run.applyRegisteredCentralRuntimeReadPackage(pool, 'central-runtime-read-v1')],
  ['053_opportunity_complement', (run, pool) => run.applyRegisteredOpportunityComplementPackage(pool, 'opportunity-complement-v1')]
]);
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

async function ledgerHead(pool, sql) {
  return (await pool.query(sql)).rows[0]?.version;
}

// Databases created by entity admission (context/features/staging-entity-admission.md): each is a tenant of its own, with
// the identity Central recorded for it. They are created on the base schema and receive the same registered steps.
const ONBOARDED_TENANTS_SQL = "SELECT database_ref, tenant_id, database_generation_id FROM public.tenant_database_generation WHERE retired_at IS NULL AND database_ref ~ '^c4g_onb_' ORDER BY database_ref";
const TENANT_HEAD_SQL = 'SELECT migration_id AS version FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1';
const pendingTenantSteps = head => TENANT_STEPS.filter(([to]) => to > head);

// Applies the given registered steps to one tenant database, in order. After each step the database must be exactly on
// that version, and Central is told before the next step starts. Stops at the first failure; nothing is skipped.
async function applyTenantSteps({ steps, central, tenant, identity, installationId, onStep = () => {}, dependencies = {} }) {
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
    const synced = await sync({ central, observation, tenantId: identity.tenantId, installationId, apply: true });
    await onStep(observation);
    applied.push(`${to}:${synced.status}`);
  }
  return applied;
}

// Brings Central to 053 and every tenant to 041: the installed one first, then each database created by admission.
// Without --apply it reports what is pending and changes nothing. --skip-onboarded leaves the admission databases alone.
// The migrations are irreversible: staging holds synthetic data only, so no backup is taken here.
async function upgrade(env, args) {
  const { config, stateFile } = settings(env);
  const state = readState(stateFile);
  if (state?.phase !== 'READY') throw refuse('STAGING_INSTALLATION_NOT_READY');
  const central = new Pool(connection(config, config.centralDatabase));
  const tenant = new Pool(connection(config, config.tenantDatabase));
  const persist = value => saveState(value, stateFile);
  const onboardedPools = [];
  try {
    const centralHead = () => ledgerHead(central, 'SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1');
    const tenantHead = () => ledgerHead(tenant, TENANT_HEAD_SQL);
    const report = { applied: Boolean(args.apply), central: { from: await centralHead(), steps: [] }, tenant: { from: await tenantHead(), steps: [] } };
    const pendingCentral = CENTRAL_STEPS.filter(([to]) => to > report.central.from);
    const pendingTenant = pendingTenantSteps(report.tenant.from);
    const skipOnboarded = args['skip-onboarded'] === true;
    const onboarded = [];
    for (const row of (await central.query(ONBOARDED_TENANTS_SQL)).rows) {
      const pool = new Pool(connection(config, row.database_ref));
      onboardedPools.push(pool);
      const from = await ledgerHead(pool, TENANT_HEAD_SQL);
      onboarded.push({ pool, identity: { tenantId: row.tenant_id, databaseGenerationId: row.database_generation_id },
        entry: { database: row.database_ref, from, ...(skipOnboarded ? { skipped: true } : {}), steps: [] }, pending: pendingTenantSteps(from) });
    }
    report.onboardedTenants = onboarded.map(item => item.entry);
    if (!args.apply) {
      report.central.pending = pendingCentral.map(([to]) => to);
      report.tenant.pending = pendingTenant.map(([to]) => to);
      for (const item of onboarded) item.entry.pending = item.pending.map(([to]) => to);
      return report;
    }
    const run = require('../runCentralMigrations');
    const { preflightCentral } = require('../../src/security/centralMigrationPreflight');
    for (const [to, apply] of pendingCentral) {
      await withInstallerAuthority(central, { targets: [central] }, async ({ demote }) => { await apply(run, nativePool(central)); await demote(); });
      const checked = await preflightCentral(central);
      if (checked.currentVersion !== to) throw refuse('STAGING_UPGRADE_CENTRAL_VERSION_UNEXPECTED');
      report.central.steps.push(to);
    }
    report.tenant.steps = await applyTenantSteps({ steps: pendingTenant, central, tenant, installationId: state.installationId,
      identity: { tenantId: state.tenantId, databaseGenerationId: state.generationId },
      onStep(observation) {
        state.snapshot.schema = { ...state.snapshot.schema, currentVersion: observation.currentVersion, schemaFingerprint: observation.schemaFingerprint,
          verifiedCapabilities: Object.fromEntries(observation.capabilities.map(code => [code, true])) };
        persist(state);
      } });
    report.central.to = await centralHead();
    report.tenant.to = await tenantHead();
    // Only after the installed tenant is complete. One admission database failing stops the command: the ones before it
    // stay migrated, the ones after it untouched, and the line below names it (codes only).
    for (const item of skipOnboarded ? [] : onboarded) {
      try {
        item.entry.steps = await applyTenantSteps({ steps: item.pending, central, tenant: item.pool, identity: item.identity, installationId: state.installationId });
      } catch (error) {
        const code = [error?.code, error?.message].find(text => typeof text === 'string' && /^[A-Z0-9_]{3,80}$/.test(text)) || 'UNCLASSIFIED';
        console.error(`STAGING_UPGRADE_ONBOARDED_TENANT_FAILED ${item.entry.database} from=${await ledgerHead(item.pool, TENANT_HEAD_SQL).catch(() => '?')} ${code}`);
        throw refuse('STAGING_UPGRADE_ONBOARDED_TENANT_FAILED');
      }
      item.entry.to = await ledgerHead(item.pool, TENANT_HEAD_SQL);
    }
    return report;
  } finally { await central.end(); await tenant.end(); await Promise.all(onboardedPools.map(pool => pool.end().catch(() => {}))); }
}

// Keycloak administration API for one realm, as the installer sees it from inside the Keycloak container's network.
async function keycloakAdministration({ baseUrl, realm, username, password, fetchImpl = fetch }) {
  if (!username || !password) throw refuse('STAGING_KEYCLOAK_ADMIN_REQUIRED');
  let token;
  try {
    const response = await fetchImpl(baseUrl + '/realms/master/protocol/openid-connect/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username, password }) });
    if (!response.ok) throw refuse('STAGING_KEYCLOAK_ADMIN_REFUSED');
    token = (await response.json()).access_token;
  } catch (error) { throw error.code ? error : refuse('STAGING_KEYCLOAK_UNAVAILABLE'); }
  if (!token) throw refuse('STAGING_KEYCLOAK_ADMIN_REFUSED');
  return async (route, method = 'GET', body) => {
    const response = await fetchImpl(`${baseUrl}/admin/realms/${realm}${route ? '/' + route : ''}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    // Provider messages may carry identifiers; only the status leaves this function.
    if (!response.ok) throw refuse('STAGING_KEYCLOAK_REQUEST_FAILED_' + response.status);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
// The API and Keycloak containers both run as uid 1000; the files stay unreadable to anyone else.
function writePrivate(file, content, owner) {
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  if (Number.isSafeInteger(owner) && process.getuid?.() === 0) fs.chownSync(file, owner, owner);
}

// Member invitations (context/features/staging-member-invitations.md), in two steps because the Keycloak module must be
// loaded before its authentication flow can be created:
//   members --prepare   writes http.json and c4g-activation.properties (bridge secret); touches nothing else.
//   members             runs in the Keycloak container's network: checks that Keycloak answers internally with the public
//                       issuer, creates the activation clients, flow and technical client, and writes worker.json.
// Repeating either step keeps the secrets already written. Nothing is printed except names and booleans.
async function members(env, args, { fetchImpl = fetch } = {}) {
  const { stateFile } = settings({ POSTGRES_PASSWORD: 'unused', ...env });
  const state = readState(stateFile);
  if (state?.phase !== 'READY') throw refuse('STAGING_INSTALLATION_NOT_READY');
  const issuer = env.OIDC_ISSUER, origin = env.PUBLIC_APP_URL;
  if (!issuer || !origin) throw refuse('STAGING_MEMBER_TARGET_REQUIRED');
  const folder = args.out || '/members';
  if (!fs.existsSync(folder)) throw refuse('STAGING_MEMBER_FOLDER_MISSING');
  const owner = env.C4G_STAGING_RUNTIME_UID === undefined ? 1000 : Number(env.C4G_STAGING_RUNTIME_UID);
  const generateSecret = () => randomBytes(32).toString('hex');
  const httpFile = path.join(folder, 'http.json'), workerFile = path.join(folder, 'worker.json'), propertiesFile = path.join(folder, 'c4g-activation.properties');
  const { realm, http, properties } = memberHttpConfiguration(state, { issuer, origin, prior: readJson(httpFile), generateSecret });
  writePrivate(httpFile, JSON.stringify(http), owner);
  writePrivate(propertiesFile, properties, owner);
  if (args.prepare) return { prepared: true, realm, files: ['http.json', 'c4g-activation.properties'] };

  const baseUrl = env.C4G_KEYCLOAK_ADMIN_URL || 'http://localhost:8080';
  const adminOrigin = args['keycloak-internal'];
  if (!adminOrigin) throw refuse('STAGING_KEYCLOAK_INTERNAL_URL_REQUIRED');
  // The worker calls the administration API on the private network with a token issued for the public issuer. That only
  // works when Keycloak's hostname is fixed, which this proves: an internal request must still announce the public issuer.
  let announced;
  try {
    const discovery = await fetchImpl(`${baseUrl}/realms/${realm}/.well-known/openid-configuration`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    announced = discovery.ok ? (await discovery.json()).issuer : null;
  } catch { throw refuse('STAGING_KEYCLOAK_UNAVAILABLE'); }
  if (announced !== issuer) throw refuse('STAGING_KEYCLOAK_ISSUER_NOT_FIXED');
  const kc = await keycloakAdministration({ baseUrl, realm, username: env.C4G_KEYCLOAK_ADMIN_USER, password: env.C4G_KEYCLOAK_ADMIN_PASSWORD, fetchImpl });
  const realmSettings = await kc('');
  const browser = (await kc('authentication/flows')).find(flow => flow.alias === realmSettings.browserFlow);
  if (!browser) throw refuse('STAGING_KEYCLOAK_BROWSER_FLOW_MISSING');
  const clients = await require('../../src/platformOnboarding/configureMemberIdentity')
    .configureMemberIdentity({ kc, origin, installationId: state.installationId, browserFlowId: browser.id });
  const worker = memberWorkerConfiguration(state, { issuer, adminOrigin, clients, prior: readJson(workerFile), generateSecret });
  writePrivate(workerFile, JSON.stringify(worker), owner);
  return { configured: true, realm, clients: [clients.manualClientId, clients.existingClientId, clients.clientId], files: ['http.json', 'c4g-activation.properties', 'worker.json'] };
}

// Entity admission (context/features/staging-entity-admission.md). Runs in the Keycloak container's network, after "members":
// lets the two activation clients return to the admission pages and writes the privileged worker's file. Repeating it keeps
// the keys already written. Nothing is printed except names and booleans.
async function admission(env, args, { fetchImpl = fetch } = {}) {
  const { config, stateFile, apiHost } = settings(env);
  const state = readState(stateFile);
  if (state?.phase !== 'READY') throw refuse('STAGING_INSTALLATION_NOT_READY');
  const issuer = env.OIDC_ISSUER, origin = env.PUBLIC_APP_URL;
  if (!issuer || !origin) throw refuse('STAGING_MEMBER_TARGET_REQUIRED');
  const folder = args.out || '/admissions', memberFolder = args.members || '/members';
  if (!fs.existsSync(folder)) throw refuse('STAGING_ADMISSION_FOLDER_MISSING');
  const member = readJson(path.join(memberFolder, 'worker.json'));
  if (!member) throw refuse('STAGING_MEMBERS_REQUIRED');
  const owner = env.C4G_STAGING_RUNTIME_UID === undefined ? 1000 : Number(env.C4G_STAGING_RUNTIME_UID);
  const workerFile = path.join(folder, 'worker.json');
  // Built before Keycloak is touched: a refused configuration changes nothing.
  const worker = admissionWorkerConfiguration(state, { issuer, member, centralDatabase: config.centralDatabase,
    postgres: { host: apiHost, port: config.port, password: config.password }, prior: readJson(workerFile), generateSecret: () => randomBytes(32).toString('hex') });
  const { realm } = memberTarget({ issuer, origin });
  const kc = await keycloakAdministration({ baseUrl: env.C4G_KEYCLOAK_ADMIN_URL || 'http://localhost:8080', realm, username: env.C4G_KEYCLOAK_ADMIN_USER, password: env.C4G_KEYCLOAK_ADMIN_PASSWORD, fetchImpl });
  const redirect = origin + ADMISSION_CALLBACK_PATH, clients = [];
  for (const clientId of [MEMBER_CLIENTS.manualClientId, MEMBER_CLIENTS.existingClientId]) {
    const found = await kc('clients?clientId=' + encodeURIComponent(clientId));
    // Only clients this installation created are changed.
    if (found?.length !== 1 || found[0].attributes?.['c4g.member.installation'] !== state.installationId) throw refuse('STAGING_MEMBER_CLIENTS_INVALID');
    const client = await kc('clients/' + found[0].id);
    if (!client.redirectUris?.includes(redirect)) await kc('clients/' + client.id, 'PUT', { ...client, redirectUris: [...(client.redirectUris || []), redirect] });
    if (!(await kc('clients/' + client.id)).redirectUris?.includes(redirect)) throw refuse('STAGING_ADMISSION_REDIRECT_NOT_APPLIED');
    clients.push(clientId);
  }
  writePrivate(workerFile, JSON.stringify(worker), owner);
  return { configured: true, realm, clients, files: ['worker.json'] };
}

function writeEnvironment(env, destination, carryFile, collection, storageFile, centralRuntimeLogin = false) {
  const { config, stateFile, apiHost } = settings(env);
  const state = readState(stateFile);
  const content = apiPrivateEnvironment(state, { host: apiHost, centralDatabase: config.centralDatabase, administratorPassword: config.password,
    centralRuntimeLogin, carried: carryFile ? carriedSettings(fs.readFileSync(carryFile, 'utf8')) : {}, collection,
    storage: storageFile ? fs.readFileSync(storageFile, 'utf8') : undefined });
  fs.writeFileSync(destination, content, { mode: 0o600 });
  const result = { written: destination, variables: content.split('\n').filter(Boolean).map(line => line.split('=')[0]) };
  if (!centralRuntimeLogin) return result;
  // Only with the opt-in runtime login: the worker's own Central URL, for a compose file that loads it after the shared one.
  const workerDestination = path.join(path.dirname(destination), 'worker-central.env.generated');
  fs.writeFileSync(workerDestination, workerCentralEnvironment(state, { host: apiHost, centralDatabase: config.centralDatabase }), { mode: 0o600 });
  return { ...result, workerWritten: workerDestination };
}

// Reachability only: each R2 bucket answers a HEAD request with these credentials and the scanner answers PING. No object is
// written, nothing is scanned and only booleans are printed.
const SCANNER_LOOPBACK = Object.freeze({ C4G_CLAMAV_HOST: '127.0.0.1', C4G_CLAMAV_PORT: '3310' });
async function storageCheck(env) {
  let config;
  // The check is what precedes the operator's declaration, so it builds the storage as if it were already declared.
  try { config = require('../../src/config/applicationDocuments').loadApplicationDocumentConfiguration({ ...env, ...SCANNER_LOOPBACK, C4G_R2_LAYER_C_VALIDATED: 'true' }); } catch { throw refuse('STAGING_STORAGE_INVALID'); }
  const store = require('../../src/documents/r2Storage').createR2Storage(config.r2, { authority: 'CENTRAL', credentials: config.credentials });
  try {
    const scanner = require('../../src/documents/clamavScanner').createClamavScanner({ authority: 'CENTRAL', storage: store, ...config.scanner });
    const [r2, scan] = await Promise.all([store.health(), scanner.health()]);
    return { r2: r2.ready === true, scanner: scan.ready === true };
  } finally { await store.shutdown(); }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  // This installer only serves staging, so it admits the staging runtime-login variant of Central 052 and 053 (exact pins only).
  // The API receives the same flag only when its environment is generated with --central-runtime-login; production never sets it.
  process.env[STAGING_ADMISSION.FLAG] ??= STAGING_ADMISSION.VALUE;
  const [command, ...rest] = argv;
  if (command === 'install') { parseArguments(rest); return install(env); }
  if (command === 'person') {
    return person(env, parseArguments(rest, { values: ['--subject', '--name', '--email', '--profile'], flags: ['--platform-admin', '--org-admin'] }));
  }
  if (command === 'upgrade') return upgrade(env, parseArguments(rest, { flags: ['--apply', '--skip-onboarded'] }));
  if (command === 'runtime-logins') { parseArguments(rest); return runtimeLogins(env); }
  if (command === 'env') {
    const args = parseArguments(rest, { values: ['--out', '--carry', '--collection', '--storage'], flags: ['--central-runtime-login'] });
    return writeEnvironment(env, args.out || '/state/api-private.env.generated', args.carry, args.collection, args.storage, args['central-runtime-login'] === true);
  }
  if (command === 'storage-check') { parseArguments(rest); return storageCheck(env); }
  if (command === 'members') return members(env, parseArguments(rest, { values: ['--out', '--keycloak-internal'], flags: ['--prepare'] }));
  if (command === 'admission') return admission(env, parseArguments(rest, { values: ['--out', '--members'] }));
  throw refuse('STAGING_COMMAND_INVALID');
}

if (require.main === module) {
  // An unsettled promise with nothing left to wait for ends the process silently with a zero exit code. That must never
  // look like success for a command that changes databases, so it is reported as an interruption.
  let settled = false;
  process.on('exit', code => {
    if (!settled && code === 0) { console.error('STAGING_INSTALL_INTERRUPTED'); process.exitCode = 1; }
  });
  main().then(result => { settled = true; console.log(JSON.stringify(result)); }, error => {
    settled = true;
    console.error(error.code || (/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'STAGING_INSTALL_FAILED'));
    process.exitCode = 1;
  });
}
module.exports = { main, members, admission, applyTenantSteps, pendingTenantSteps, ONBOARDED_TENANTS_SQL, CENTRAL_STEPS, TENANT_STEPS };
