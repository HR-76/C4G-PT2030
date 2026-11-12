'use strict';

// Pure helpers of the staging installer: argument parsing, the identities and credentials recorded for the
// tenant, and the private environment file the API reads. Nothing here touches the database or the disk.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGION = Object.freeze({ regionCode: 'EU', residencyPolicyVersion: 'staging-v1' });

function failure(code) {
  return Object.assign(new Error(code), { code });
}

// "--name value" pairs and bare "--flag" switches; anything else is refused.
function parseArguments(argv, { values = [], flags = [] } = {}) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (flags.includes(key)) parsed[key.slice(2)] = true;
    else if (values.includes(key) && index + 1 < argv.length && !argv[index + 1].startsWith('--')) { parsed[key.slice(2)] = argv[index + 1]; index += 1; }
    else throw failure('STAGING_ARGUMENT_INVALID');
  }
  return parsed;
}

function requirePerson({ subject, name, email }) {
  if (!UUID.test(subject || '')) throw failure('STAGING_SUBJECT_INVALID');
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw failure('STAGING_NAME_INVALID');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw failure('STAGING_EMAIL_INVALID');
  return { subject: subject.toLowerCase(), name: name.trim(), email: email.trim() };
}

// How the API reaches the tenant database: by the container network name and over verified TLS.
function stagingTarget({ apiHost, port = 5432 }) {
  if (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(apiHost || '')) throw failure('STAGING_API_HOST_INVALID');
  return { apiLogin: 'c4g_staging_api', workerLogin: 'c4g_staging_worker', credentialRefPrefix: 'staging-api',
    credentialHost: apiHost, credentialPort: port, credentialSsl: true, ...REGION };
}

// Non-secret settings the previous release already carries. Only these names are ever copied from it.
const CARRIED_KEYS = Object.freeze(['AUTH_MODE', 'AUTH_POLICY_VERSION', 'AUTH_ASSURANCE_POLICY_JSON', 'PRIVILEGED_LOGIN_ASSURANCE_CATEGORY',
  'OIDC_REDIRECT_URI', 'OIDC_POST_LOGOUT_REDIRECT_URI', 'OIDC_TRANSACTION_MS', 'SESSION_COOKIE_NAME', 'SESSION_IDLE_MS', 'SESSION_ABSOLUTE_MS']);

function carriedSettings(text) {
  const carried = {};
  for (const line of String(text).split(/\r?\n/)) {
    const index = line.indexOf('=');
    const key = index > 0 ? line.slice(0, index) : '';
    if (CARRIED_KEYS.includes(key)) carried[key] = line.slice(index + 1);
  }
  return carried;
}

function databaseUrl({ login, password, host, port, database }) {
  const url = new URL('postgresql://placeholder');
  url.username = login; url.password = password; url.hostname = host; url.port = String(port); url.pathname = '/' + database;
  url.search = 'sslmode=verify-full';
  return url.toString();
}

// Lines for api-private.env (Docker Compose "raw" format). Only values the installer generated.
// The Central pool connects as the PostgreSQL administrator, as the local profile does: the pinned Central
// fingerprints do not admit a limited runtime login (its grants would count as schema drift).
function apiPrivateEnvironment(state, { host, port = 5432, centralDatabase, administratorPassword, carried = {} }) {
  if (state?.phase !== 'READY' || !state.credentials || !administratorPassword) throw failure('STAGING_INSTALLATION_NOT_READY');
  const lines = {
    ...carried,
    AUTHORITY_COMMIT_PERMIT_SECRET: state.permitSecret,
    SESSION_SECRET: state.sessionSecret,
    AUTHORITY_DATABASE_URL: databaseUrl({ login: 'c4g_authority_runtime', password: state.authorityPassword, host, port, database: centralDatabase }),
    CENTRAL_DATABASE_URL: databaseUrl({ login: 'postgres', password: administratorPassword, host, port, database: centralDatabase }),
    OPPORTUNITY_API_CREDENTIALS_JSON: JSON.stringify([state.credentials]),
    OPPORTUNITY_ALLOWED_RESIDENCY_JSON: JSON.stringify([{ regionCode: REGION.regionCode, policyVersion: REGION.residencyPolicyVersion }])
  };
  return Object.entries(lines).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}

module.exports = Object.freeze({ UUID, REGION, CARRIED_KEYS, carriedSettings, parseArguments, requirePerson, stagingTarget, databaseUrl, apiPrivateEnvironment });
