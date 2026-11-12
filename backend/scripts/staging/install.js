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
//           | env [--out <file>] [--carry <previous private env>]
// Profiles: ORG_ADMIN (Administrador), FUNDING_MANAGER (Gestor de candidaturas), CONTRIBUTOR (Técnico), VIEWER.
// Secrets are generated on first use, kept in the state file (mode 600) and written only to files, never printed.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { connection, identifier, saveState } = require('../localPlatform/config');
const { initialState, installSchemas } = require('../localPlatform/schema');
const { parseArguments, requirePerson, requireProfile, projectionOperationId, stagingTarget, apiPrivateEnvironment, carriedSettings,
  CATALOG_LOGIN } = require('./environment');

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
    const checked = await require('../../src/security/centralMigrationPreflight').preflightCentral(central);
    state.phase = 'READY';
    persist(state);
    return { organizationId: state.organizationId, tenantId: state.tenantId, centralVersion: checked.currentVersion,
      tenantVersion: state.snapshot.schema.currentVersion };
  } finally { await central.end(); }
}

function policyFor(env, stateFile) {
  const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../src/security/authConfig');
  const generated = path.join(path.dirname(stateFile), 'api-private.env.generated');
  const policyVersion = env.AUTH_POLICY_VERSION || (fs.existsSync(generated) ? carriedSettings(fs.readFileSync(generated, 'utf8')).AUTH_POLICY_VERSION : undefined);
  const policy = RECOGNIZED_ASSURANCE_POLICIES[policyVersion];
  if (!policy) throw refuse('STAGING_POLICY_VERSION_REQUIRED');
  return { policyVersion, requirement: policy.policy[policy.privilegedCategory] };
}

async function person(env, args) {
  const { config, stateFile } = settings(env);
  const state = readState(stateFile);
  if (state?.phase !== 'READY') throw refuse('STAGING_INSTALLATION_NOT_READY');
  const issuer = env.OIDC_ISSUER || env.C4G_STAGING_OIDC_ISSUER;
  if (!/^https:\/\/[^\s]+$/.test(issuer || '')) throw refuse('STAGING_ISSUER_REQUIRED');
  const { policyVersion, requirement } = policyFor(env, stateFile);
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
  if (prior && prior.policy_version !== policyVersion) throw refuse('STAGING_AUTHORITY_POLICY_CONFLICT');
  const grants = grantsForProfile({ organizationId: state.organizationId, profileCode: profile, previousProfile: prior ? profile : undefined, previousGrants: prior?.grants });
  if (prior && permissionsOf(prior.grants) === permissionsOf(grants)) return;
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

function writeEnvironment(env, destination, carryFile) {
  const { config, stateFile, apiHost } = settings(env);
  const content = apiPrivateEnvironment(readState(stateFile), { host: apiHost, centralDatabase: config.centralDatabase, administratorPassword: config.password,
    carried: carryFile ? carriedSettings(fs.readFileSync(carryFile, 'utf8')) : {} });
  fs.writeFileSync(destination, content, { mode: 0o600 });
  return { written: destination, variables: content.split('\n').filter(Boolean).map(line => line.split('=')[0]) };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = argv;
  if (command === 'install') { parseArguments(rest); return install(env); }
  if (command === 'person') {
    return person(env, parseArguments(rest, { values: ['--subject', '--name', '--email', '--profile'], flags: ['--platform-admin', '--org-admin'] }));
  }
  if (command === 'env') {
    const args = parseArguments(rest, { values: ['--out', '--carry'] });
    return writeEnvironment(env, args.out || '/state/api-private.env.generated', args.carry);
  }
  throw refuse('STAGING_COMMAND_INVALID');
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result)), error => {
    console.error(error.code || (/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'STAGING_INSTALL_FAILED'));
    process.exitCode = 1;
  });
}
module.exports = { main };
