'use strict';
const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const ORGANIZATION_TYPES = require('../../src/entityAdmission/registrationContract').types;
const { isSecretHex } = require('../../src/security/secretFormat');

const CONFIG_ERROR = 'PRODUCTION_BOOTSTRAP_CONFIG_INVALID';
const CREDENTIALS_ERROR = 'PRODUCTION_BOOTSTRAP_CREDENTIALS_INVALID';
const ARGUMENTS_ERROR = 'PRODUCTION_BOOTSTRAP_ARGUMENTS_INVALID';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/;
const SECRET_KEYS = Object.freeze(['read', 'commands', 'authoring', 'logs', 'retention', 'catalog', 'authority']);
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function fail(code) { throw Object.assign(new Error(code), { code }); }
function object(value, required, optional = [], code = CONFIG_ERROR) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) fail(code);
  return value;
}
function text(value, max = 200, code = CONFIG_ERROR) {
  if (typeof value !== 'string' || !value.length || value.length > max || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail(code);
  return value;
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(CONFIG_ERROR); return value.toLowerCase(); }
function code(value) { if (typeof value !== 'string' || !CODE.test(value)) fail(CONFIG_ERROR); return value; }
function reference(value) {
  if (typeof value !== 'string' || !REFERENCE.test(value) || value.includes('://')) fail(CONFIG_ERROR);
  return value;
}
function credentialReference(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)) fail(CONFIG_ERROR);
  return value;
}
function safeName(value, { login = false } = {}) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.length < 3 || /staging/i.test(value)
    || value === 'postgres' || value.startsWith('pg_') || value.startsWith('template') || (login && value.startsWith('c4g_'))) fail(CONFIG_ERROR);
  return value;
}
function host(value) {
  text(value, 253);
  if (/staging/i.test(value)) fail(CONFIG_ERROR);
  const normalized = value.toLowerCase();
  if (!isIP(normalized) && !normalized.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail(CONFIG_ERROR);
  return normalized;
}
function tls(value, hostname, allowInsecureLoopback) {
  if (value === false) {
    if (allowInsecureLoopback !== true || !LOOPBACK.has(hostname)) fail(CONFIG_ERROR);
    return false;
  }
  object(value, ['rejectUnauthorized'], ['ca']);
  if (value.rejectUnauthorized !== true) fail(CONFIG_ERROR);
  const result = { rejectUnauthorized: true };
  if (Object.hasOwn(value, 'ca')) {
    if (typeof value.ca !== 'string' || !value.ca.length || value.ca.length > 262144 || value.ca.includes('\0')
      || !value.ca.includes('-----BEGIN CERTIFICATE-----') || !value.ca.includes('-----END CERTIFICATE-----')) fail(CONFIG_ERROR);
    result.ca = value.ca;
  }
  return result;
}
function issuer(value) {
  text(value, 2048);
  let parsed;
  try { parsed = new URL(value); } catch { fail(CONFIG_ERROR); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
    || !/^\/realms\/[A-Za-z0-9_-]+$/.test(parsed.pathname) || parsed.href !== value) fail(CONFIG_ERROR);
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateConfig(raw, { allowInsecureLoopback = false } = {}) {
  object(raw, ['version', 'installationId', 'target', 'organization', 'tenant', 'administrator']);
  if (raw.version !== 1) fail(CONFIG_ERROR);
  const target = object(raw.target, ['host', 'port', 'expectedSystemIdentifier', 'centralDatabase', 'tenantDatabase', 'ssl']);
  const hostname = host(target.host);
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535
    || typeof target.expectedSystemIdentifier !== 'string' || !/^[1-9][0-9]{0,19}$/.test(target.expectedSystemIdentifier)
    || BigInt(target.expectedSystemIdentifier) > 18446744073709551615n) fail(CONFIG_ERROR);
  const centralDatabase = safeName(target.centralDatabase), tenantDatabase = safeName(target.tenantDatabase);
  if (centralDatabase === tenantDatabase) fail(CONFIG_ERROR);
  const organization = object(raw.organization, ['id', 'name', 'legalName', 'slug', 'type', 'currency', 'dataResidencyCode']);
  if (typeof organization.slug !== 'string' || organization.slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organization.slug)
    || typeof organization.currency !== 'string' || !/^[A-Z]{3}$/.test(organization.currency)
    || !ORGANIZATION_TYPES.includes(organization.type)) fail(CONFIG_ERROR);
  const tenant = object(raw.tenant, ['id', 'generationId', 'apiLogin', 'credentialRef', 'regionCode', 'residencyPolicyVersion']);
  if (tenant.regionCode !== 'EU') fail(CONFIG_ERROR);
  const administrator = object(raw.administrator, ['globalUserId', 'membershipId', 'issuer', 'subject', 'name', 'email', 'organizationProfile']);
  if (![null, 'ORG_ADMIN'].includes(administrator.organizationProfile)
    || (administrator.organizationProfile === null ? administrator.membershipId !== null : !UUID.test(administrator.membershipId || ''))
    || typeof administrator.email !== 'string' || administrator.email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(administrator.email)) fail(CONFIG_ERROR);
  return freeze({
    version: 1, installationId: uuid(raw.installationId),
    target: { host: hostname, port: target.port, expectedSystemIdentifier: target.expectedSystemIdentifier,
      centralDatabase, tenantDatabase, ssl: tls(target.ssl, hostname, allowInsecureLoopback) },
    organization: { id: uuid(organization.id), name: text(organization.name), legalName: text(organization.legalName),
      slug: organization.slug, type: code(organization.type), currency: organization.currency, dataResidencyCode: code(organization.dataResidencyCode) },
    tenant: { id: uuid(tenant.id), generationId: uuid(tenant.generationId), apiLogin: safeName(tenant.apiLogin, { login: true }),
      credentialRef: credentialReference(tenant.credentialRef), regionCode: tenant.regionCode, residencyPolicyVersion: reference(tenant.residencyPolicyVersion) },
    administrator: { globalUserId: uuid(administrator.globalUserId), membershipId: administrator.membershipId === null ? null : uuid(administrator.membershipId),
      issuer: issuer(administrator.issuer), subject: text(administrator.subject, 255), name: text(administrator.name),
      email: text(administrator.email, 254).toLowerCase(), organizationProfile: administrator.organizationProfile }
  });
}

function validateCredentials(raw) {
  object(raw, ['central', 'tenantApi', 'permitSecret'], [], CREDENTIALS_ERROR);
  object(raw.central, SECRET_KEYS, [], CREDENTIALS_ERROR);
  const values = [...SECRET_KEYS.map(key => raw.central[key]), raw.tenantApi, raw.permitSecret];
  // Printable ASCII avoids password verifier/SASLprep normalization differences on resume.
  if (values.some(value => typeof value !== 'string' || value.length < 32 || value.length > 4096 || !/^[\x21-\x7e]+$/.test(value))
    || new Set(values).size !== values.length || !isSecretHex(raw.permitSecret)) fail(CREDENTIALS_ERROR);
  return freeze({ central: Object.fromEntries(SECRET_KEYS.map(key => [key, raw.central[key]])), tenantApi: raw.tenantApi, permitSecret: raw.permitSecret });
}

function canonical(value) {
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function configDigest(raw) {
  // Digesting a disposable test intent does not authorize using its insecure transport.
  const validated = validateConfig(raw, { allowInsecureLoopback: true });
  return createHash('sha256').update(JSON.stringify(canonical(validated))).digest('hex');
}
function identifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail('PRODUCTION_BOOTSTRAP_IDENTIFIER_INVALID');
  return '"' + value + '"';
}
function literal(value) {
  if (typeof value !== 'string' || value.includes('\0')) fail('PRODUCTION_BOOTSTRAP_LITERAL_INVALID');
  return "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
}
function parseArguments(argv) {
  if (!Array.isArray(argv)) fail(ARGUMENTS_ERROR);
  const result = { config: null, credentials: null, outputDir: null, apply: false }, seen = new Set();
  const flags = { '--config': 'config', '--credentials': 'credentials', '--output-dir': 'outputDir',
    '--runtime-config': 'runtimeConfig', '--runtime-credentials': 'runtimeCredentials' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) fail(ARGUMENTS_ERROR);
    seen.add(flag);
    if (flag === '--apply') { result.apply = true; continue; }
    if (!Object.hasOwn(flags, flag)) fail(ARGUMENTS_ERROR);
    const value = argv[++index];
    text(value, 4096, ARGUMENTS_ERROR);
    if (value.startsWith('--') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) fail(ARGUMENTS_ERROR);
    result[flags[flag]] = value;
  }
  if (!result.config || !result.outputDir || (result.apply && !result.credentials)) fail(ARGUMENTS_ERROR);
  if ((result.runtimeCredentials && !result.runtimeConfig) || (result.apply && result.runtimeConfig && !result.runtimeCredentials)) fail(ARGUMENTS_ERROR);
  return Object.freeze(result);
}

module.exports = Object.freeze({ validateConfig, validateCredentials, configDigest, identifier, literal, parseArguments });
