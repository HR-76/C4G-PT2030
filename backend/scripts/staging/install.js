'use strict';

// Staging installer for the VPS: Central and tenant schemas, first organization, tenant directory entry,
// and the people who may sign in. Contract: context/features/staging-vps-deployment.md.
//
// It runs as a one-off container in the PostgreSQL container's network namespace, so the administrator
// connection is loopback and never crosses a network:
//   docker run --rm --network container:<postgres> --env-file <postgres>/.env -v <state>:/state <image> \
//     node scripts/staging/install.js install
// Commands: install | person --subject <uuid> --name <text> --email <address> [--platform-admin] [--org-admin]
//           | env [--out <file>] [--carry <previous private env>]
// Secrets are generated on first use, kept in the state file (mode 600) and written only to files, never printed.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { connection, saveState } = require('../localPlatform/config');
const { initialState, installSchemas } = require('../localPlatform/schema');
const { parseArguments, requirePerson, stagingTarget, apiPrivateEnvironment, carriedSettings } = require('./environment');

// The permissions the local profile gives an organization administrator, so staging behaves like it.
const ORGANIZATION_ADMIN_PERMISSIONS = Object.freeze(['notification.read', 'organization_notice.manage', 'opportunity.read',
  'opportunity.private.create', 'opportunity.private.update', 'opportunity.archive', 'application.read', 'application.create',
  'application.edit', 'application.transition', 'organization_directory.read', 'organization_directory.edit',
  'organizational_scope.read', 'organizational_scope.create', 'organizational_scope.rename', 'organizational_scope.reparent']);

function settings(env) {
  if (!env.POSTGRES_PASSWORD) throw Object.assign(new Error('STAGING_POSTGRES_PASSWORD_REQUIRED'), { code: 'STAGING_POSTGRES_PASSWORD_REQUIRED' });
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

async function install(env) {
  const { config, stateFile, apiHost, organization } = settings(env);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  const state = readState(stateFile) ?? initialState(config);
  const persist = value => saveState(value, stateFile);
  persist(state);
  await installSchemas(config, state, persist, stagingTarget({ apiHost }));
  const central = new Pool(connection(config, config.centralDatabase));
  try {
    await registerOrganization(central, state, organization);
    const checked = await require('../../src/security/centralMigrationPreflight').preflightCentral(central);
    state.phase = 'READY';
    persist(state);
    return { organizationId: state.organizationId, tenantId: state.tenantId, centralVersion: checked.currentVersion,
      tenantVersion: state.snapshot.schema.currentVersion };
  } finally { await central.end(); }
}

async function person(env, args) {
  const { config, stateFile } = settings(env);
  const state = readState(stateFile);
  if (state?.phase !== 'READY') throw Object.assign(new Error('STAGING_INSTALLATION_NOT_READY'), { code: 'STAGING_INSTALLATION_NOT_READY' });
  const issuer = env.OIDC_ISSUER || env.C4G_STAGING_OIDC_ISSUER;
  if (!/^https:\/\/[^\s]+$/.test(issuer || '')) throw Object.assign(new Error('STAGING_ISSUER_REQUIRED'), { code: 'STAGING_ISSUER_REQUIRED' });
  const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../src/security/authConfig');
  const generated = path.join(path.dirname(stateFile), 'api-private.env.generated');
  const policyVersion = env.AUTH_POLICY_VERSION || (fs.existsSync(generated) ? carriedSettings(fs.readFileSync(generated, 'utf8')).AUTH_POLICY_VERSION : undefined);
  const policy = RECOGNIZED_ASSURANCE_POLICIES[policyVersion];
  if (!policy) throw Object.assign(new Error('STAGING_POLICY_VERSION_REQUIRED'), { code: 'STAGING_POLICY_VERSION_REQUIRED' });
  const requirement = policy.policy[policy.privilegedCategory];
  const { subject, name, email } = requirePerson(args);
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
      if (args['org-admin']) {
        const existing = (await client.query(require('../../src/platformOnboarding/sql').nonRemovedMembership, [userId])).rows[0];
        if (existing && existing.organization_id !== state.organizationId) throw Object.assign(new Error('STAGING_MEMBERSHIP_CONFLICT'), { code: 'STAGING_MEMBERSHIP_CONFLICT' });
        membershipId = existing?.id ?? randomUUID();
        if (!existing) {
          await client.query(`INSERT INTO public.organization_membership(id, global_user_id, organization_id, base_role_code, status, activated_at)
            VALUES($1, $2, $3, 'ORG_ADMIN', 'ACTIVE', clock_timestamp())`, [membershipId, userId, state.organizationId]);
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if (membershipId) await grantOrganizationAdmin({ authority, central, state, membershipId, policyVersion, requirement });
    return { userId, membershipId, platformAdmin: Boolean(args['platform-admin']) };
  } finally { await authority.end(); await central.end(); }
}

async function grantOrganizationAdmin({ authority, central, state, membershipId, policyVersion, requirement }) {
  const coordinator = require('../../src/security/authorityCoordinator').createAuthorityCoordinator({ pool: authority, permitSecret: state.permitSecret });
  const catalogs = require('../../src/authorization/catalogs').createProductionCatalogs({ catalogVersion: 'f13' });
  const data = require('../../src/authorization/authorityDataRepository').createAuthorityDataRepository({ coordinator, catalogs,
    policyVersion, recentMfaRequirement: requirement });
  const prior = await central.query('SELECT authorization_version, policy_version FROM public.authority_f5_state WHERE membership_id = $1', [membershipId]);
  if (prior.rowCount) {
    if (prior.rows[0].policy_version !== policyVersion) throw Object.assign(new Error('STAGING_AUTHORITY_POLICY_CONFLICT'), { code: 'STAGING_AUTHORITY_POLICY_CONFLICT' });
    return;
  }
  await data.change({ organizationId: state.organizationId, membershipId, expectedVersion: 0, assuranceRequirements: requirement,
    grants: ORGANIZATION_ADMIN_PERMISSIONS.map(permission => ({ permission,
      scope: { type: 'ORGANIZATION', id: state.organizationId, organizationId: state.organizationId } })) });
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
  if (command === 'person') return person(env, parseArguments(rest, { values: ['--subject', '--name', '--email'], flags: ['--platform-admin', '--org-admin'] }));
  if (command === 'env') {
    const args = parseArguments(rest, { values: ['--out', '--carry'] });
    return writeEnvironment(env, args.out || '/state/api-private.env.generated', args.carry);
  }
  throw Object.assign(new Error('STAGING_COMMAND_INVALID'), { code: 'STAGING_COMMAND_INVALID' });
}

if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result)), error => {
    console.error(error.code || (/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'STAGING_INSTALL_FAILED'));
    process.exitCode = 1;
  });
}
module.exports = { main, ORGANIZATION_ADMIN_PERMISSIONS };
