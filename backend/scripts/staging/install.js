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
//           | env [--out <file>] [--carry <previous private env>] [--collection <5|all>]
//           | upgrade [--apply]   (without --apply it only reports the pending steps)
// Profiles: ORG_ADMIN (Administrador), FUNDING_MANAGER (Gestor de candidaturas), CONTRIBUTOR (Técnico), VIEWER.
// Secrets are generated on first use, kept in the state file (mode 600) and written only to files, never printed.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { connection, identifier, saveState } = require('../localPlatform/config');
const { withInstallerAuthority, nativePool } = require('../localPlatform/installerAuthority');
const { syncCentralObservation } = require('../localPlatform/centralObservation');
const { initialState, installSchemas } = require('../localPlatform/schema');
const { parseArguments, requirePerson, requireProfile, projectionOperationId, stagingTarget, apiPrivateEnvironment, carriedSettings,
  CATALOG_LOGIN, AUTH_POLICY_VERSION } = require('./environment');

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

async function install(env) {
  const { config, stateFile, apiHost, organization } = settings(env);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  const state = readState(stateFile) ?? initialState(config);
  state.staging ??= {};
  state.staging.catalogPassword ??= randomBytes(32).toString('hex');
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
  ['050_billing_private_documents', (run, pool) => run.applyRegisteredBillingPdfsPackage(pool, 'billing-private-documents-v1')]
]);
const TENANT_STEPS = Object.freeze([
  ['034_application_snapshot_v2', (runners, options) => runners.createRegisteredTenantMigrationRunner({ ...options, packageId: OPPORTUNITY_V2_PACKAGE })],
  ['035_application_review_assignments', (runners, options) => runners.createAssignedReviewMigrationRunner(options)],
  ['036_application_team_chat', (runners, options) => runners.createApplicationChatMigrationRunner(options)],
  ['037_organization_strategy', (runners, options) => runners.createOrganizationStrategyMigrationRunner(options)],
  ['038_application_task_details', (runners, options) => runners.createApplicationTaskDetailsMigrationRunner(options)],
  ['039_document_deletion', (runners, options) => runners.createDocumentDeletionMigrationRunner(options)],
  ['040_application_chat_retention', (runners, options) => runners.createChatRetentionMigrationRunner(options)]
]);

async function ledgerHead(pool, sql) {
  return (await pool.query(sql)).rows[0]?.version;
}

// Brings Central to 050 and the tenant to 040. Without --apply it reports what is pending and changes nothing.
// The migrations are irreversible: staging holds synthetic data only, so no backup is taken here.
async function upgrade(env, args) {
  const { config, stateFile } = settings(env);
  const state = readState(stateFile);
  if (state?.phase !== 'READY') throw refuse('STAGING_INSTALLATION_NOT_READY');
  const central = new Pool(connection(config, config.centralDatabase));
  const tenant = new Pool(connection(config, config.tenantDatabase));
  const persist = value => saveState(value, stateFile);
  try {
    const centralHead = () => ledgerHead(central, 'SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1');
    const tenantHead = () => ledgerHead(tenant, 'SELECT migration_id AS version FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1');
    const report = { applied: Boolean(args.apply), central: { from: await centralHead(), steps: [] }, tenant: { from: await tenantHead(), steps: [] } };
    const pendingCentral = CENTRAL_STEPS.filter(([to]) => to > report.central.from);
    const pendingTenant = TENANT_STEPS.filter(([to]) => to > report.tenant.from);
    if (!args.apply) {
      report.central.pending = pendingCentral.map(([to]) => to);
      report.tenant.pending = pendingTenant.map(([to]) => to);
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
    const runners = require('../../src/security/tenantMigrationRunner');
    const { preflightTenant } = require('../../src/security/tenantMigrationPreflight');
    const identity = { tenantId: state.tenantId, databaseGenerationId: state.generationId };
    for (const [to, createRunner] of pendingTenant) {
      await withInstallerAuthority(central, { targets: [central] }, async ({ demote }) => {
        await createRunner(runners, { pool: nativePool(tenant), observationPublisher: { async publish() {} }, timeoutMs: 30000,
          scheduler: { setTimeout, clearTimeout } }).migrate({ ...identity, expectedRevision: 1, correlationId: state.installationId,
          idempotencyKey: `${state.installationId}-${to}` });
        await demote();
      });
      const observation = await preflightTenant(tenant, identity, undefined, { timeoutMs: 15000 });
      if (observation.currentVersion !== to) throw refuse('STAGING_UPGRADE_TENANT_VERSION_UNEXPECTED');
      const synced = await syncCentralObservation({ central, observation, tenantId: state.tenantId, installationId: state.installationId, apply: true });
      state.snapshot.schema = { ...state.snapshot.schema, currentVersion: observation.currentVersion, schemaFingerprint: observation.schemaFingerprint,
        verifiedCapabilities: Object.fromEntries(observation.capabilities.map(code => [code, true])) };
      persist(state);
      report.tenant.steps.push(`${to}:${synced.status}`);
    }
    report.central.to = await centralHead();
    report.tenant.to = await tenantHead();
    return report;
  } finally { await central.end(); await tenant.end(); }
}

function writeEnvironment(env, destination, carryFile, collection) {
  const { config, stateFile, apiHost } = settings(env);
  const content = apiPrivateEnvironment(readState(stateFile), { host: apiHost, centralDatabase: config.centralDatabase, administratorPassword: config.password,
    carried: carryFile ? carriedSettings(fs.readFileSync(carryFile, 'utf8')) : {}, collection });
  fs.writeFileSync(destination, content, { mode: 0o600 });
  return { written: destination, variables: content.split('\n').filter(Boolean).map(line => line.split('=')[0]) };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = argv;
  if (command === 'install') { parseArguments(rest); return install(env); }
  if (command === 'person') {
    return person(env, parseArguments(rest, { values: ['--subject', '--name', '--email', '--profile'], flags: ['--platform-admin', '--org-admin'] }));
  }
  if (command === 'upgrade') return upgrade(env, parseArguments(rest, { flags: ['--apply'] }));
  if (command === 'env') {
    const args = parseArguments(rest, { values: ['--out', '--carry', '--collection'] });
    return writeEnvironment(env, args.out || '/state/api-private.env.generated', args.carry, args.collection);
  }
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
module.exports = { main, CENTRAL_STEPS, TENANT_STEPS };
