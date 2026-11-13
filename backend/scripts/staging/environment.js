'use strict';

// Pure helpers of the staging installer: argument parsing, the identities and credentials recorded for the
// tenant, and the private environment file the API reads. Nothing here touches the database or the disk.
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../src/security/authConfig');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILES = Object.freeze(['ORG_ADMIN', 'FUNDING_MANAGER', 'CONTRIBUTOR', 'VIEWER']);
const CATALOG_LOGIN = 'c4g_catalog_staging';
// MFA is each person's choice (decision of 2026-10-17); the older c4g-assurance-v1 requires it for privileged logins.
const AUTH_POLICY_VERSION = 'c4g-user-mfa-v1';
const ASSURANCE_POLICY = RECOGNIZED_ASSURANCE_POLICIES[AUTH_POLICY_VERSION];
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

// --profile <code> (organization profile) or the older --org-admin switch; at most one of them.
function requireProfile(args) {
  if (args.profile !== undefined && args['org-admin']) throw failure('STAGING_PROFILE_INVALID');
  const requested = args.profile ?? (args['org-admin'] ? 'ORG_ADMIN' : null);
  if (requested !== null && !PROFILES.includes(requested)) throw failure('STAGING_PROFILE_INVALID');
  return requested;
}

// Stable per membership, so repeating the projection into the tenant is recognised as the same operation.
function projectionOperationId(membershipId) {
  const digest = require('node:crypto').createHash('sha256').update('c4g-staging-member-projection:' + membershipId).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

// How the API reaches the tenant database: by the container network name and over verified TLS.
function stagingTarget({ apiHost, port = 5432 }) {
  if (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(apiHost || '')) throw failure('STAGING_API_HOST_INVALID');
  return { apiLogin: 'c4g_staging_api', workerLogin: 'c4g_staging_worker', credentialRefPrefix: 'staging-api',
    credentialHost: apiHost, credentialPort: port, credentialSsl: true, ...REGION };
}

// Non-secret settings the previous release already carries. Only these names are ever copied from it.
const CARRIED_KEYS = Object.freeze(['AUTH_MODE',
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

// Live collection from the EU Funding & Tenders API is opt-in. --collection 5 is a trial run of five results; --collection all
// collects everything: pages of 100 (the provider maximum) chained by durable coverage until the source is exhausted.
// --collection all-sources additionally admits CORDIS, Erasmus+, Interreg Europe and POCTEP (the last two read official websites).
const COLLECTION_APPROVALS = Object.freeze({ 5: 'staging-eu-funding-tenders-5', all: 'staging-eu-funding-tenders-100', 'all-sources': 'staging-all-sources-100' });
function collectionEnvironment(option) {
  if (option === undefined) return {};
  if (!Object.hasOwn(COLLECTION_APPROVALS, option)) throw failure('STAGING_COLLECTION_INVALID');
  return { FUNDING_TENDERS_SOURCE: 'live-staging', FUNDING_TENDERS_REHEARSAL_APPROVED: COLLECTION_APPROVALS[option],
    ...(option === 'all' || option === 'all-sources' ? { FUNDING_TENDERS_COVERAGE: 'durable-v1' } : {}) };
}

// Private object storage (Cloudflare R2, EU jurisdiction) and the ClamAV scanner. The R2 values are the operator's: they are
// read from a file the operator writes on the server and are never generated, printed or sent anywhere by the installer.
// ClamAV runs beside the API in the same network namespace (compose "clamav" service), because the runtime only accepts a
// loopback scanner. Enabling it turns on the features that need both: private billing PDFs, the central PT2030 import (upload,
// preview, staging of the candidates and acceptance of the new ones into the catalogue) and application documents (F11, R2).
// C4G_R2_LAYER_C_VALIDATED is the operator's declaration that the real R2 has been validated: the runtime refuses to build the
// storage without it. In staging, setting it is the operator's act after `storage-check` passes; it is never added for them.
const STORAGE_KEYS = Object.freeze(['C4G_R2_ENDPOINT', 'C4G_R2_DOCUMENTS_BUCKET', 'C4G_R2_QUARANTINE_BUCKET', 'C4G_R2_ACCESS_KEY_ID', 'C4G_R2_SECRET_ACCESS_KEY', 'C4G_R2_LAYER_C_VALIDATED']);
const SCANNER = Object.freeze({ C4G_CLAMAV_HOST: '127.0.0.1', C4G_CLAMAV_PORT: '3310' });
function storageEnvironment(text) {
  if (text === undefined) return {};
  const values = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const key = at < 0 ? '' : line.slice(0, at).trim(), value = at < 0 ? '' : line.slice(at + 1).trim();
    if (!STORAGE_KEYS.includes(key)) throw failure('STAGING_STORAGE_KEY_UNKNOWN');
    if (!/^\S+$/.test(value) || Object.hasOwn(values, key)) throw failure('STAGING_STORAGE_INVALID');
    values[key] = value;
  }
  if (STORAGE_KEYS.some(key => !Object.hasOwn(values, key))) throw failure('STAGING_STORAGE_INCOMPLETE');
  if (values.C4G_R2_LAYER_C_VALIDATED !== 'true') throw failure('STAGING_STORAGE_VALIDATION_NOT_DECLARED');
  // The runtime's own loader is the authority on what is acceptable (EU endpoint, two distinct buckets, loopback scanner).
  try { require('../../src/config/applicationDocuments').loadApplicationDocumentConfiguration({ ...values, ...SCANNER }); }
  catch { throw failure('STAGING_STORAGE_INVALID'); }
  return { ...values, ...SCANNER, BILLING_PDF_RUNTIME: 'private', CENTRAL_PT2030_IMPORT_RUNTIME: 'catalog', DOCUMENTS_RUNTIME: 'f11-r2' };
}

// Lines for api-private.env (Docker Compose "raw" format). Only values the installer generated.
// The Central pool connects as the PostgreSQL administrator, as the local profile does: the pinned Central
// fingerprints do not admit a limited runtime login (its grants would count as schema drift).
function apiPrivateEnvironment(state, { host, port = 5432, centralDatabase, administratorPassword, carried = {}, collection, storage }) {
  if (state?.phase !== 'READY' || !state.credentials || !administratorPassword || !state.staging?.catalogPassword) throw failure('STAGING_INSTALLATION_NOT_READY');
  const lines = {
    ...carried,
    AUTH_POLICY_VERSION,
    AUTH_ASSURANCE_POLICY_JSON: JSON.stringify(ASSURANCE_POLICY.policy),
    PRIVILEGED_LOGIN_ASSURANCE_CATEGORY: ASSURANCE_POLICY.privilegedCategory,
    // Production behaviour is part of what staging proves: Secure session cookies and verified database TLS.
    NODE_ENV: 'production',
    // Central opportunity catalog, read-only. Collection from the sources is a separate step.
    FUNDING_TENDERS_RUNTIME: 'central',
    FUNDING_TENDERS_SOURCE: 'unconfigured',
    ...collectionEnvironment(collection),
    ...storageEnvironment(storage),
    CATALOG_DATABASE_URL: databaseUrl({ login: CATALOG_LOGIN, password: state.staging.catalogPassword, host, port, database: centralDatabase }),
    AUTHORITY_COMMIT_PERMIT_SECRET: state.permitSecret,
    SESSION_SECRET: state.sessionSecret,
    AUTHORITY_DATABASE_URL: databaseUrl({ login: 'c4g_authority_runtime', password: state.authorityPassword, host, port, database: centralDatabase }),
    CENTRAL_DATABASE_URL: databaseUrl({ login: 'postgres', password: administratorPassword, host, port, database: centralDatabase }),
    OPPORTUNITY_API_CREDENTIALS_JSON: JSON.stringify([state.credentials]),
    OPPORTUNITY_ALLOWED_RESIDENCY_JSON: JSON.stringify([{ regionCode: REGION.regionCode, policyVersion: REGION.residencyPolicyVersion }])
  };
  return Object.entries(lines).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}

module.exports = Object.freeze({ STORAGE_KEYS, storageEnvironment, COLLECTION_APPROVALS, collectionEnvironment, AUTH_POLICY_VERSION, UUID, PROFILES, CATALOG_LOGIN, REGION, requireProfile, projectionOperationId, CARRIED_KEYS, carriedSettings, parseArguments, requirePerson, stagingTarget, databaseUrl, apiPrivateEnvironment });
