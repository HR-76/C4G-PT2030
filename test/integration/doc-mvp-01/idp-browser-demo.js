'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { Pool } = require('../../../backend/node_modules/pg');
const express = require('../../../backend/node_modules/express');
const cors = require('../../../backend/node_modules/cors');
const s3 = require('../../../backend/node_modules/@aws-sdk/client-s3');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');
const { createProofSafeguards, reconstructProofJournal } = require('./r2-proof-safeguards');
const { providerClient, databaseUrl, createInfrastructure, seedApplication, createQueue,
  waitForScanner, inventoryPrefix } = require('./group-c-r2');
const { fixture } = require('./ooxml-proof-fixtures');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { preflightTenant } = require('../../../backend/src/security/tenantMigrationPreflight');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createMembershipRepository } = require('../../../backend/src/security/membershipRepository');
const { createDocumentRepository } = require('../../../backend/src/documents/repository');
const { createR2AdapterBoundary } = require('../../../backend/src/documents/r2Adapter');
const { createClamavScanner } = require('../../../backend/src/documents/clamavScanner');
const { createDocumentWorkerStorageProvider } = require('./shared-budget-storage');
const { startCoordinator, createBudgetClient, replay: replaySharedBudget } = require('./shared-r2-budget');
const { startBrowserEgressBlocker } = require('./browser-budget');
const {createDownloadStaging}=require('../../../backend/src/documents/downloadStaging');
const { loadHistory, checkIncrement, allowance: VERIFIED_API_PLAN } = require('./verified-api-increment');
const { createSharedSafeguards } = require('./shared-r2-safeguards');
const { prepareBrowserWorker } = require('./browser-worker');
const { createLauncherDrain, trackPool, watchServer, trackExpress } = require('./launcher-drain');
const { createScanService } = require('../../../backend/src/documents/scanService');
const { createDocumentWorker } = require('../../../backend/src/documents/worker');
const { createPostgresDocumentWorkerPorts, transaction } = require('../../../backend/src/documents/postgresWorkerPorts');
const { createDocumentAuditPort } = require('../../../backend/src/documents/audit');
const { createAuditEvent } = require('../../../backend/src/audit/event');
const { createAppendService } = require('../../../backend/src/audit/appendService');
const { PostgresAppendRepository } = require('../../../backend/src/audit/postgresAppendRepository');
const { createUuidV7 } = require('../../../backend/src/audit/uuidV7');
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../../backend/src/security/authConfig');

const ROOT = path.resolve(__dirname, '../../..');
const EXTERNAL_ENV = 'C:/Users/Utilizador/c4g-secrets/r2-test.env';
const PARENT_JOURNAL = 'C:/Users/Utilizador/c4g-evidence/doc-mvp-01/r2/df1f6c0b-c107-4509-af52-73b4eefb244b/r2-proof-journal.jsonl';
const PARENT = Object.freeze({ sequence: 2234,
  sha256: '6620A415C0BD96FB51818321C45735C10B06681DC47CAB77F7FE2B353AAFB84C',
  budget: Object.freeze({ functionalRequests: 377, cleanupRequests: 55, applicationBytes: 60498984,
    objectIntentions: 20, completedObjects: 19, multipartIntentions: 3, unresolvedMultipart: 0 }) });
// Proposed limits: remote use requires a separate explicit authorization.
const CUMULATIVE_LIMITS = Object.freeze({ functionalRequests: 493, cleanupRequests: 66,
  applicationBytes: 67108864, objectIntentions: 23, completedObjects: 22,
  multipartIntentions: 3, unresolvedMultipart: 2 });
const PREVIOUS_PHASE_LIMITS = Object.freeze({ functionalRequests: 44, cleanupRequests: 8,
  applicationBytes: CUMULATIVE_LIMITS.applicationBytes - PARENT.budget.applicationBytes,
  objectIntentions: 1, completedObjects: 1, multipartIntentions: 0, unresolvedMultipart: 0 });
const PHASE_LIMITS = Object.freeze({ functionalRequests: 116, cleanupRequests: 11,
  applicationBytes: CUMULATIVE_LIMITS.applicationBytes - PARENT.budget.applicationBytes,
  objectIntentions: 3, completedObjects: 3, multipartIntentions: 0, unresolvedMultipart: 0 });
const PHASE_RUN_ID = '5f6360f0-696a-4b8e-9147-e1db4321dd83';
const PHASE_JOURNAL = `C:/Users/Utilizador/c4g-evidence/doc-mvp-01/idp-browser/${PHASE_RUN_ID}/r2-phase-journal.jsonl`;
const PHASE_BASELINE = Object.freeze({ sequence: 399,
  sha256: '6E87A494A96868CC291120CE0F257E24B0CABE3BD0B390577CDE98A78FB71DF1',
  budget: Object.freeze({ functionalRequests: 70, cleanupRequests: 6, applicationBytes: 11648,
    objectIntentions: 2, completedObjects: 2, multipartIntentions: 0, unresolvedMultipart: 0 }) });
const REMOTE_PLAN = VERIFIED_API_PLAN;
const ENDPOINT_SHA256 = 'aa1e81171a0a3b4a116a03856764404e7f76ef9e947f67ac895aaae1e4baec22';
const DOCUMENTS_BUCKET = 'c4g-test-documents';
const QUARANTINE_BUCKET = 'c4g-test-quarantine';
const ORIGIN = 'https://localhost:8543';
const DB_PORT = 55441;
const CLAMAV_PORT = 54310;
const KEYCLOAK_PORT = 8181;
const API_PORT = 5100;
const CONTROLLED_STORAGE_PORT = 5101;
const LABEL = 'c4g.proof=doc-mvp01-idp-browser';
const LOCAL_DIAGNOSTIC_AUTHORIZATION = 'LOCAL_UPLOAD_DIAGNOSTIC_2026_10_24';
const LOCAL_FULL_AUTHORIZATION = 'LOCAL_FULL_DIAGNOSTIC_2026_10_24';
const LOCAL_STORAGE_PATH = '/__doc_mvp01_storage__/';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const safe = value => String(value || '').replace(/https?:\/\/\S+/g, '[URL_REDACTED]').replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '[USER_PATH]');
function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function parseEnv(file) { const result = {}; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = /^([^#=]+)=(.*)$/.exec(line); if (match) result[match[1]] = match[2];
} return result; }
function cumulative(value) { const result = {}; for (const key of Object.keys(PARENT.budget)) {
  result[key] = key === 'unresolvedMultipart' ? Math.max(PARENT.budget[key], value[key]) : PARENT.budget[key] + value[key];
} return Object.freeze(result); }
function assertBudget(value) { const total = cumulative(value); for (const key of Object.keys(CUMULATIVE_LIMITS)) {
  assert(total[key] <= CUMULATIVE_LIMITS[key], `budget:${key}`);
} return total; }
function request(label, identity) { return Object.freeze({ tenantId: identity.tenantId,
  databaseGenerationId: identity.databaseGenerationId, expectedRevision: 1,
  correlationId: `${label}-${crypto.randomUUID()}`, idempotencyKey: `${label}-${crypto.randomUUID()}` }); }
function totp(secret) { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = []; for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest(), offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

function localSafeguards() {
  const budget = Object.freeze({ functionalRequests: 0, cleanupRequests: 0, applicationBytes: 0,
    objectIntentions: 0, completedObjects: 0, multipartIntentions: 0, unresolvedMultipart: 0 });
  return Object.freeze({ snapshot: () => budget, recordJournalInterpretation() {}, recordBudgetAuthorization() {}, close() {},
    async controlledFetch() { throw new Error('LOCAL_DIAGNOSTIC_R2_FORBIDDEN'); },
    async cleanupKnownResources() { return Object.freeze({ status: 'NOT_APPLICABLE' }); } });
}

function observedLocalStorage(events, base) {
  const methods = require('../../../backend/src/documents/objectStoragePort').METHODS;
  const port = Object.fromEntries(methods.map(method => [method, async (...args) => {
    events.push(Object.freeze({ kind: 'STORAGE_DOUBLE', method, at: new Date().toISOString() }));
    return base[method](...args);
  }]));
  port.createDownloadCapability = async () => {throw new Error('SIGNED_DOWNLOAD_FORBIDDEN_IN_THIS_PROOF')};
  return Object.freeze(port);
}

function validateParentJournal() {
  const bytes = fs.readFileSync(PARENT_JOURNAL), records = bytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  const reconstructed = reconstructProofJournal(records);
  assert.equal(reconstructed.sequence, PARENT.sequence); assert.equal(sha(bytes).toUpperCase(), PARENT.sha256);
  assert.deepEqual(reconstructed.budget, PARENT.budget); assert.equal(records.at(-1).event, 'JOURNAL_CLOSED');
}
function validatePhaseJournal() {
  const bytes = fs.readFileSync(PHASE_JOURNAL), records = bytes.toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
  const reconstructed = reconstructProofJournal(records);
  assert.equal(reconstructed.sequence, PHASE_BASELINE.sequence); assert.equal(sha(bytes).toUpperCase(), PHASE_BASELINE.sha256);
  assert.deepEqual(reconstructed.budget, PHASE_BASELINE.budget); assert.equal(records[0].proofTag, PHASE_RUN_ID);
  assert.equal(records.at(-1).event, 'JOURNAL_CLOSED');
  return reconstructed;
}
function assertRemotePlan(current) {
  for (const key of Object.keys(REMOTE_PLAN)) {
    const projected = key === 'unresolvedMultipart' ? Math.max(current[key], REMOTE_PLAN[key]) : current[key] + REMOTE_PLAN[key];
    assert(projected <= PHASE_LIMITS[key], `remote-plan:${key}:${projected}/${PHASE_LIMITS[key]}`);
  }
}

function realApiAudit(pool, organizationId, tenantId, diagnostics = []) {
  const append = createAppendService({ appendPort: new PostgresAppendRepository() });
  const operation = Object.freeze({ DOCUMENT_UPLOAD_INTENT_ACCEPTED: 'DOCUMENT_UPLOAD_INITIATE',
    DOCUMENT_UPLOAD_CONFIRMED: 'DOCUMENT_UPLOAD_CONFIRM', DOCUMENT_ACCESS_CAPABILITY_ISSUED: 'DOCUMENT_READ' });
  return createDocumentAuditPort(Object.freeze({ async accept(input) {
    diagnostics.push(Object.freeze({ kind: 'API_AUDIT_STARTED', eventCode: input.eventCode, at: new Date().toISOString() }));
    const context = input.context || {}, actor = context.actor || {};
    try {
      const now = new Date(), event = createAuditEvent({ trustedContext: { organizationId, tenantId,
      operationAuthority: 'TENANT', operationCode: operation[input.eventCode] || 'DOCUMENT_READ', source: 'API',
      channel: 'APPLICATION', synchronous: true }, input: { eventCode: input.eventCode,
      actor: actor.id ? { type: 'HUMAN', id: actor.id, membershipId: actor.membershipId || null,
        serviceActorCode: null, supportGrantId: null } : { type: 'SERVICE', id: 'F11_DOCUMENT_API',
        membershipId: null, serviceActorCode: 'F11_DOCUMENT_API', supportGrantId: null }, subject: null,
      resource: input.versionId ? { type: 'DOCUMENT_VERSION', id: input.versionId } : input.documentId
        ? { type: 'DOCUMENT', id: input.documentId } : null, decision: 'ACCEPT', outcome: 'SUCCESS',
      observedAt: now.toISOString(), correlationId: context.correlationId || createUuidV7({ now: () => now.getTime() }),
      causationId: context.causationId || null, idempotencyKey: `doc-api:${input.eventCode}:${input.versionId || input.documentId || crypto.randomUUID()}`,
      streamType: 'DATA', payload: { detailCode: input.eventCode } }, clock: () => now });
      const result = await transaction(pool, 'c4g_audit_writer', organizationId, client => append.append(event, client));
      diagnostics.push(Object.freeze({ kind: 'API_AUDIT_ACCEPTED', eventCode: input.eventCode, status: result?.status || null,
        at: new Date().toISOString() }));
      return result;
    } catch (error) {
      diagnostics.push(Object.freeze({ kind: 'API_AUDIT_FAILED', eventCode: input.eventCode,
        errorName: String(error?.name || 'Error').slice(0, 64), errorCode: String(error?.code || '').slice(0, 64),
        message: String(error?.message || '').slice(0, 160), at: new Date().toISOString() }));
      throw error;
    }
  } }));
}

async function waitHttp(url, attempts = 90) { let last = null; for (let attempt = 0; attempt < attempts; attempt += 1) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (response.ok) return response; last = `HTTP_${response.status}`; } catch(error) { last = error?.cause?.code || error?.code || error?.name; }
  await sleep(1000);
} throw new Error(`LOCAL_SERVICE_NOT_READY:${last}`); }

async function configureKeycloak({ realm, clientId, adminPassword, users }) {
  const tokenResponse = await fetch(`http://127.0.0.1:${KEYCLOAK_PORT}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'proof-admin', password: adminPassword }) });
  assert.equal(tokenResponse.ok, true); const token = (await tokenResponse.json()).access_token;
  const admin = async (route, method = 'GET', body = null) => { const response = await fetch(`http://127.0.0.1:${KEYCLOAK_PORT}/admin/realms${route}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`KEYCLOAK_ADMIN_${method}_${response.status}`);
    return response.status === 201 || response.status === 204 ? null : response.json(); };
  const executions = alias => admin(`/${realm}/authentication/flows/${alias}/executions`);
  const setRequirement = async (alias, executionId, requirement) => {
    const execution = (await executions(alias)).find(value => value.id === executionId); assert(execution);
    await admin(`/${realm}/authentication/flows/${alias}/executions`, 'PUT', { ...execution, requirement });
  };
  const addExecution = async (alias, provider, requirement, reference = null) => {
    await admin(`/${realm}/authentication/flows/${alias}/executions/execution`, 'POST', { provider });
    const matching = (await executions(alias)).filter(value => value.providerId === provider), execution = matching.at(-1); assert(execution);
    await setRequirement(alias, execution.id, requirement);
    if (reference) await admin(`/${realm}/authentication/executions/${execution.id}/config`, 'POST', {
      alias: `doc-mvp01-${reference}-${alias}-${provider}`, config: { 'default.reference.value': reference } });
    return execution;
  };
  const addLoaFlow = async (parent, alias, level, maxAge, authenticator, reference) => {
    await admin(`/${realm}/authentication/flows/${parent}/executions/flow`, 'POST', {
      alias, description: `DOC-MVP-01 disposable LoA ${level}`, provider: 'basic-flow', type: 'basic-flow' });
    const subflow = (await executions(parent)).filter(value => value.displayName === alias).at(-1); assert(subflow);
    await setRequirement(parent, subflow.id, 'CONDITIONAL');
    const condition = await addExecution(alias, 'conditional-level-of-authentication', 'REQUIRED');
    await admin(`/${realm}/authentication/executions/${condition.id}/config`, 'POST', {
      alias: `doc-mvp01-loa-${level}-condition`, config: { 'loa-condition-level': String(level), 'loa-max-age': String(maxAge) } });
    await addExecution(alias, authenticator, 'REQUIRED', reference);
  };
  await admin('', 'POST', { realm, enabled: true, sslRequired: 'all', registrationAllowed: false,
    loginWithEmailAllowed: true, passwordPolicy: 'length(16)', attributes: { 'acr.loa.map': JSON.stringify({ 'c4g-loa1': 1, 'c4g-loa2': 2 }) } });
  await admin(`/${realm}/clients`, 'POST', { clientId, enabled: true, publicClient: true, standardFlowEnabled: true,
    directAccessGrantsEnabled: false, redirectUris: [`${ORIGIN}/api/auth/oidc/callback`], webOrigins: [ORIGIN],
    attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': `${ORIGIN}/login`,
      'default.acr.values': 'c4g-loa2', 'minimum.acr.value': 'c4g-loa2' } });
  const browserFlow = 'doc-mvp01-browser', formsFlow = 'doc-mvp01-forms';
  await admin(`/${realm}/authentication/flows`, 'POST', { alias: browserFlow,
    description: 'DOC-MVP-01 disposable versioned LoA browser flow', providerId: 'basic-flow', topLevel: true, builtIn: false });
  await addExecution(browserFlow, 'auth-cookie', 'ALTERNATIVE');
  await admin(`/${realm}/authentication/flows/${browserFlow}/executions/flow`, 'POST', {
    alias: formsFlow, description: 'DOC-MVP-01 disposable interactive forms', provider: 'basic-flow', type: 'basic-flow' });
  const forms = (await executions(browserFlow)).find(value => value.displayName === formsFlow); assert(forms);
  await setRequirement(browserFlow, forms.id, 'ALTERNATIVE');
  await addLoaFlow(formsFlow, 'doc-mvp01-loa1', 1, 300, 'auth-username-password-form', 'pwd');
  await addLoaFlow(formsFlow, 'doc-mvp01-loa2', 2, 300, 'auth-otp-form', 'otp');
  const realmConfig = await admin(`/${realm}`); realmConfig.browserFlow = browserFlow;
  await admin(`/${realm}`, 'PUT', realmConfig);
  const client = (await admin(`/${realm}/clients?clientId=${encodeURIComponent(clientId)}`))[0]; assert(client);
  await admin(`/${realm}/client-scopes`, 'POST', { name: 'doc-mvp01-amr', protocol: 'openid-connect',
    attributes: { 'include.in.token.scope': 'false' } });
  const scope = (await admin(`/${realm}/client-scopes`)).find(value => value.name === 'doc-mvp01-amr'); assert(scope);
  await admin(`/${realm}/client-scopes/${scope.id}/protocol-mappers/models`, 'POST', { name: 'doc-mvp01-amr',
    protocol: 'openid-connect', protocolMapper: 'oidc-amr-mapper',
    config: { 'id.token.claim': 'true', 'access.token.claim': 'true', 'lightweight.claim': 'false' } });
  await admin(`/${realm}/clients/${client.id}/default-client-scopes/${scope.id}`, 'PUT');
  for (const user of users) {
    await admin(`/${realm}/users`, 'POST', { id: user.id, username: user.username,
      email: `${user.username}@example.invalid`, firstName: 'Synthetic', lastName: user.label, enabled: true, emailVerified: true,
      credentials: [{ type: 'password', value: user.password, temporary: false }, { type: 'otp', userLabel: 'DOC-MVP-01',
        secretData: JSON.stringify({ value: user.totp }), credentialData: JSON.stringify({ subType: 'totp', digits: 6,
          counter: 0, period: 30, algorithm: 'HmacSHA1', secretEncoding: 'BASE32' }) }] });
    const matches = await admin(`/${realm}/users?username=${encodeURIComponent(user.username)}&exact=true`);
    assert.equal(matches.length, 1); user.subject = matches[0].id;
  }
}

async function main() {
  const localUploadOnly = process.env.DOC_MVP01_IDP_BROWSER_LOCAL_DIAGNOSTIC === LOCAL_DIAGNOSTIC_AUTHORIZATION;
  const localFull = process.env.DOC_MVP01_IDP_BROWSER_LOCAL_FULL === LOCAL_FULL_AUTHORIZATION;
  const localDiagnostic = localUploadOnly || localFull;
  if (!localDiagnostic) assert.equal(process.env.DOC_MVP01_BROWSER_INCREMENT_AUTHORIZATION,'VERIFIED_API_A_B_42_5_EXPLICIT_AUTHORIZATION');
  validateParentJournal(); if (!localDiagnostic) validatePhaseJournal();
  const increment=localDiagnostic?null:loadHistory(path.dirname(PHASE_JOURNAL));
  const r2env = localDiagnostic ? Object.freeze({ C4G_R2_ENDPOINT: 'https://controlled-local.eu.r2.cloudflarestorage.com',
    C4G_R2_DOCUMENTS_BUCKET: 'controlled-local-documents', C4G_R2_QUARANTINE_BUCKET: 'controlled-local-quarantine',
    C4G_R2_ACCESS_KEY_ID: 'controlled-local-access-key', C4G_R2_SECRET_ACCESS_KEY: 'controlled-local-secret-key' }) : parseEnv(EXTERNAL_ENV);
  if (!localDiagnostic) {
    assert(fs.existsSync(EXTERNAL_ENV)); const required = ['C4G_R2_ENDPOINT', 'C4G_R2_DOCUMENTS_BUCKET', 'C4G_R2_QUARANTINE_BUCKET',
      'C4G_R2_ACCESS_KEY_ID', 'C4G_R2_SECRET_ACCESS_KEY']; for (const name of required) assert(r2env[name]);
    assert.equal(sha(Buffer.from(r2env.C4G_R2_ENDPOINT)), ENDPOINT_SHA256);
    assert.equal(r2env.C4G_R2_DOCUMENTS_BUCKET, DOCUMENTS_BUCKET); assert.equal(r2env.C4G_R2_QUARANTINE_BUCKET, QUARANTINE_BUCKET);
  }
  const runId = localDiagnostic ? crypto.randomUUID() : PHASE_RUN_ID, short = runId.slice(0, 8), prefix = `${runId}/`, realm = `doc-mvp01-${short}`;
  const evidence = path.join('C:/Users/Utilizador/c4g-evidence/doc-mvp-01', localFull ? 'idp-browser-local-full' : localDiagnostic ? 'idp-browser-local-upload' : 'idp-browser', runId,...(localDiagnostic?[]:['verified-api-increment-42-5']));
  fs.mkdirSync(evidence, { recursive: true });
  const stagingDirectory=path.join(evidence,'private-download-staging');
  const downloadStaging=createDownloadStaging({directory:stagingDirectory});
  const codePaths = ['test/integration/doc-mvp-01/browser-increment.js','test/integration/doc-mvp-01/browser-budget.js','frontend/src/api/documentNavigation.js','backend/src/routes/applicationSliceRoutes.js','test/integration/doc-mvp-01/shared-r2-budget.js','test/integration/doc-mvp-01/shared-r2-safeguards.js','test/integration/doc-mvp-01/shared-budget-storage.js','test/integration/doc-mvp-01/shared-budget-transport.js',
    'test/integration/doc-mvp-01/idp-browser-demo.js', 'test/integration/doc-mvp-01/browser-worker.js',
    'test/integration/doc-mvp-01/multiprocess-child.js', 'backend/src/documentWorker.js', 'backend/src/config/documentWorkerInfrastructure.js',
    'backend/src/documents/repository.js', 'backend/src/documents/scanService.js', 'backend/src/documents/worker.js',
    'backend/src/documents/ooxmlStructuralInspector.js', 'backend/src/documents/r2Storage.js', 'backend/src/async/workerProcessor.js',
    'backend/src/async/inboxRepository.js', 'backend/test/fixtures/documentWorkerEntrypointChild.js',
    'backend/test/fixtures/documentWorkerStorageProvider.js', 'backend/package-lock.json',
    'frontend/src/pages/Applications/ApplicationDocumentsReview.jsx'];
  codePaths.push('test/integration/doc-mvp-01/verified-api-increment.js','backend/src/documents/downloadStaging.js','backend/src/documents/applicationTransport.js','backend/src/documents/productionDocuments.js','backend/src/documents/audit.js','backend/src/applications/documentsReview.js','test/integration/doc-mvp-01/idp-browser-nginx.conf');
  for (const name of fs.readdirSync(path.join(ROOT, 'frontend/dist/assets')).filter(name=>name.endsWith('.js'))) codePaths.push(`frontend/dist/assets/${name}`);
  const codeHashes = Object.fromEntries(codePaths.map(name=>[name,sha(fs.readFileSync(path.join(ROOT,name)))]));
  fs.writeFileSync(path.join(evidence,'code-hashes.json'),`${JSON.stringify(codeHashes,null,2)}\n`,{flag:'wx'});
  const journalPath = localDiagnostic ? null : PHASE_JOURNAL;
  let safeguards = localSafeguards();
  if (!localDiagnostic) {
    checkIncrement(REMOTE_PLAN);
    fs.writeFileSync(path.join(evidence,'authorization.json'),JSON.stringify(increment,null,2)+'\n',{flag:'wx'});
  }
  const password = () => crypto.randomBytes(24).toString('base64url'), base32 = () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; return [...crypto.randomBytes(32)].map(value => alphabet[value & 31]).join(''); };
  const dbPassword = password(), adminPassword = password(), clientId = `doc-mvp01-${short}`;
  const users = [{ id: crypto.randomUUID(), username: `doc-a-${short}`, password: password(), totp: base32(), label: 'Requester A' },
    { id: crypto.randomUUID(), username: `doc-b-${short}`, password: password(), totp: base32(), label: 'Reviewer B' }];
  const names = { network: `c4g-doc-idp-${short}`, db: `c4g-doc-idp-db-${short}`,
    idp: `c4g-doc-idp-keycloak-${short}`, proxy: `c4g-doc-idp-proxy-${short}`, clamav: `c4g-doc-idp-clamav-${short}` };
  let adminPool, tenant, central, queue, runtimeFixture, legacyPool, server, controlledStorageServer, browser, storage, cleanupClient, workerLoop, activePage, budgetCoordinator, browserBlocker;
  let workerBusy = false, stopWorker = false;
  let proofStarted = false, cleanup = { status: 'NOT_STARTED' }, phase = 'PREPARE';
  let uploadPhase = 'NOT_STARTED', diagnosticContext = null, preserveResources = false;
  let browserRequestSequence = 0, browserResponseSequence = 0;
  const browserRequestOrder = new WeakMap(), browserEvents = [], candidateEvidence = [], storageEvents = [], downloadEvidence=[];
  const {OidcClient}=require('../../../backend/src/security/oidcClient');
  const originalOidcCallback=OidcClient.prototype.callback;
  OidcClient.prototype.callback=async function(...args){
    const result=await originalOidcCallback.apply(this,args);
    storageEvents.push({kind:'OIDC_VALIDATED_ASSURANCE',stepUp:args[1]?.stepUp===true,acr:result.claims.acr||null,
      amr:Array.isArray(result.claims.amr)?result.claims.amr.filter(value=>['pwd','otp','mfa'].includes(value)):[],
      ageSeconds:Math.floor(Date.now()/1000)-result.claims.auth_time,at:new Date().toISOString()});
    return result;
  };
  const resources = [];
  const ownedHttpServers = [];
  const ownedRequestWork = [];
  const workerRecord = record => record ? Object.freeze({
    organizationId: record.organizationId || record.organization_id || null,
    documentId: record.documentId || record.document_id || null,
    versionId: record.versionId || record.version_id || null,
    state: record.state || record.toState || null,
    scanState: record.scanState || record.scan_state || null,
    lockVersion: Number(record.lockVersion ?? record.lock_version ?? 0)
  }) : null;
  async function diagnosticSnapshot(label) {
    if (!tenant || !diagnosticContext) return Object.freeze({ label, available: false });
    const query = async (sql, values = []) => { try { return Object.freeze({ rows: (await tenant.query(sql, values)).rows, errorCode: null }); }
      catch (error) { return Object.freeze({ rows: [], errorCode: String(error?.code || error?.name || 'QUERY_FAILED').slice(0, 64) }); } };
    const values = [diagnosticContext.organizationId];
    const versions = await query(`SELECT v.organization_id,v.document_id,v.version_id,v.object_id,v.state,v.scan_state,v.lock_version,
      v.expected_size,v.observed_size,v.expected_file_class,v.expected_sha256,v.sha256,v.declared_mime,v.detected_mime,
      v.confirmed_at,v.updated_at,d.resource_type,d.resource_id
      FROM document_storage.document_version v JOIN document_storage.document d
      ON d.organization_id=v.organization_id AND d.document_id=v.document_id
      WHERE v.organization_id=$1 ORDER BY v.created_at`, values);
    const scans = await query(`SELECT s.version_id,s.attempt,s.result,s.result_code,s.input_digest,s.observed_at
      FROM document_storage.scan_result s JOIN document_storage.document_version v ON v.version_id=s.version_id
      WHERE v.organization_id=$1 ORDER BY s.version_id,s.attempt`, values);
    const inbox = await query(`SELECT consumer,job_type,job_version,organization_id,idempotency_key,execution_id,state,claim_owner,
      lease_until,fence,result_code,created_at,completed_at FROM async_exec.inbox WHERE organization_id=$1 ORDER BY created_at`, values);
    const audit = await query(`SELECT event_code,event_data->'resource' AS resource,event_data->'payload' AS payload
      FROM audit.event WHERE organization_id=$1 AND event_code='DOCUMENT_SCAN_COMPLETED'`, values);
    const outbox = await query(`SELECT logical_id,state,envelope->>'executionId' AS execution_id,
      envelope->>'jobType' AS job_type FROM async_exec.outbox WHERE organization_id=$1`, values);
    if ([versions,scans,inbox,audit,outbox].some(value=>value.errorCode)) preserveResources = true;
    return Object.freeze({ label, capturedAt: new Date().toISOString(), context: diagnosticContext, versions,
      scans, inbox, audit, outbox, workerEvents: storageEvents.filter(event => /^WORKER_|^DOCUMENT_SCAN_/.test(event.kind)),
      candidateEvents: [...candidateEvidence], downloadEvidence:[...downloadEvidence] });
  }
  async function preserveDiagnostic(label) {
    const snapshot = await diagnosticSnapshot(label);
    fs.writeFileSync(path.join(evidence, `diagnostic-${label.toLowerCase()}-${Date.now()}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return snapshot;
  }
  try {
    docker('network', 'create', '--label', LABEL, names.network); resources.push(['network', names.network]);
    docker('run', '-d', '--name', names.db, '--network', names.network, '--label', LABEL,
      '-e', `POSTGRES_PASSWORD=${dbPassword}`, '-e', 'POSTGRES_USER=postgres', '-e', 'POSTGRES_DB=postgres',
      '-p', `127.0.0.1:${DB_PORT}:5432`, 'postgres:17-alpine'); resources.push(['container', names.db]);
    docker('run', '-d', '--name', names.idp, '--network', names.network, '--network-alias', 'idp', '--label', LABEL,
      '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=proof-admin', '-e', `KC_BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}`,
      '-e', `KC_HOSTNAME=${ORIGIN}`, '-e', 'KC_HTTP_ENABLED=true', '-e', 'KC_PROXY_HEADERS=xforwarded',
      '-p', `127.0.0.1:${KEYCLOAK_PORT}:8080`, 'quay.io/keycloak/keycloak:26.8.0', 'start-dev'); resources.push(['container', names.idp]);
    docker('run', '-d', '--name', names.clamav, '--network', names.network, '--label', LABEL,
      '-e', 'CLAMAV_NO_FRESHCLAMD=true', '-e', 'CLAMD_CONF_TCPSocket=3310', '-e', 'CLAMD_CONF_TCPAddr=0.0.0.0',
      '-p', `127.0.0.1:${CLAMAV_PORT}:3310`, 'clamav/clamav:stable'); resources.push(['container', names.clamav]);
    for (let attempt = 0; attempt < 60; attempt += 1) { try { docker('exec', names.db, 'pg_isready', '-U', 'c4g_f12_admin', '-d', 'postgres'); break; } catch { if (attempt === 59) throw new Error('POSTGRES_NOT_READY'); await sleep(1000); } }
    await waitHttp(`http://127.0.0.1:${KEYCLOAK_PORT}/realms/master`);
    await configureKeycloak({ realm, clientId, adminPassword, users });
    const cert = path.resolve(ROOT, '.tmp/f2-integration/localhost.crt').replaceAll('\\', '/');
    const key = path.resolve(ROOT, '.tmp/f2-integration/localhost.key').replaceAll('\\', '/');
    const nginx = path.resolve(__dirname, 'idp-browser-nginx.conf').replaceAll('\\', '/');
    const dist = path.resolve(ROOT, 'frontend/dist').replaceAll('\\', '/');
    docker('run', '-d', '--name', names.proxy, '--network', names.network, '--label', LABEL,
      '-p', '127.0.0.1:8543:443', '-v', `${nginx}:/etc/nginx/conf.d/default.conf:ro`,
      '-v', `${cert}:/etc/nginx/tls/localhost.crt:ro`, '-v', `${key}:/etc/nginx/tls/localhost.key:ro`,
      '-v', `${dist}:/usr/share/nginx/html:ro`, 'nginx:1.28-alpine'); resources.push(['container', names.proxy]);

    phase = 'DATABASES';
    const adminUrl = `postgresql://postgres:${encodeURIComponent(dbPassword)}@127.0.0.1:${DB_PORT}/postgres`;
    adminPool = new Pool({ connectionString: adminUrl, max: 4 }); tenant = await createInfrastructure(adminPool);
    const identity = Object.freeze({ tenantId: runId, databaseGenerationId: crypto.randomUUID() });
    await createTenantMigrationRunner({ pool: tenant, entries: manifest, observationPublisher: { async publish() {} },
      timeoutMs: 60000, scheduler: { setTimeout, clearTimeout } }).migrate(request('idp-browser-to032', identity));
    const tenantEvidence = await preflightTenant(tenant, identity, manifest, { timeoutMs: 60000 });
    assert.equal(tenantEvidence.currentVersion, '032_document_worker_runtime');
    central = await require('../f13/central-authority-fixture').centralAuthorityFixture(adminUrl, { validateHistoricalRoundTrip: false });
    for (const pool of [adminPool, tenant, central.pool, central.authorityPool]) trackPool(pool);
    runtimeFixture = await require('../f13/runtime-fixture').runtimeFixture({ pool: tenant, evidence: tenantEvidence, sessions: { memberships: new Map() } });
    runtimeFixture.dependencies.membershipRepository = createMembershipRepository(central.pool, central.coordinator);
    const orgA = runId, orgB = crypto.randomUUID(), memberA = crypto.randomUUID(), memberBA = crypto.randomUUID(), memberBB = crypto.randomUUID();
    const actorA = await central.user(orgA, users[0].id, memberA, null, null, { displayName: 'Requester A' });
    const actorBA = await central.user(orgA, users[1].id, memberBA, null, null, { displayName: 'Reviewer B' });
    await central.user(orgB, users[1].id, memberBB, null, null, { displayName: 'Reviewer B' });
    await central.pool.query('UPDATE public.organization SET display_name=$2,legal_name=$2 WHERE id=$1', [orgA, 'Organização sintética A']);
    await central.pool.query('UPDATE public.organization SET display_name=$2,legal_name=$2 WHERE id=$1', [orgB, 'Organização sintética B']);
    const scope = organizationId => ({ type: 'ORGANIZATION', id: organizationId, organizationId });
    const grant = async (organizationId, membershipId, permissions) => central.data.change({ organizationId, membershipId,
      expectedVersion: 1, grants: permissions.map(permission => ({ permission, scope: scope(organizationId) })), assuranceRequirements: central.requirement });
    await grant(orgA, memberA, ['application.read', 'application.edit', 'opportunity.read', 'document.read',
      'document.download.request', 'document.upload.initiate', 'document.upload.confirm', 'document.version.create', 'document.version.list']);
    await grant(orgA, memberBA, ['application.read', 'application.review.decide', 'opportunity.read', 'document.read', 'document.download.request', 'document.version.list']);
    await grant(orgB, memberBB, ['application.read']);
    const issuer = `${ORIGIN}/realms/${realm}`;
    for (const user of users) await central.pool.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4)',
      [crypto.randomUUID(), user.id, issuer, user.subject]);
    const seeded = await seedApplication(tenant, orgA, memberA, users[0].id);
    diagnosticContext = Object.freeze({ organizationId: orgA, applicationId: seeded.applicationId,
      requesterSubjectId: users[0].id, reviewerSubjectId: users[1].id });

    phase = 'R2_INSTRUMENTATION';
    const target = Object.freeze({ runId, documentsBucket: r2env.C4G_R2_DOCUMENTS_BUCKET, quarantineBucket: r2env.C4G_R2_QUARANTINE_BUCKET,
      configuration: Object.freeze({ enabled: true, jurisdiction: 'eu', endpoint: r2env.C4G_R2_ENDPOINT,
        documentsBucket: r2env.C4G_R2_DOCUMENTS_BUCKET, quarantineBucket: r2env.C4G_R2_QUARANTINE_BUCKET, bucketAccess: 'PRIVATE',
        capabilities: Object.freeze({ layerCValidated: true, multipartConditionalValidated: true }) }),
      credentials: Object.freeze({ accessKeyId: r2env.C4G_R2_ACCESS_KEY_ID, secretAccessKey: r2env.C4G_R2_SECRET_ACCESS_KEY }) });
    const storageRoot = path.join(evidence, 'controlled-storage'); fs.mkdirSync(storageRoot);
    const source=fs.readFileSync(PHASE_JOURNAL),sourceHash=sha(source).toUpperCase();
    assert.equal(sourceHash,'6E87A494A96868CC291120CE0F257E24B0CABE3BD0B390577CDE98A78FB71DF1');
    const recovered=reconstructProofJournal(source.toString('utf8').trim().split(/\r?\n/).map(JSON.parse));assert.equal(recovered.sequence,399);
    fs.writeFileSync(path.join(evidence,'synthetic-source-phase.jsonl'),source,{flag:'wx'});
    const tokens={functional:crypto.randomBytes(32).toString('hex'),cleanup:crypto.randomBytes(32).toString('hex')};
    const sharedJournalPath=path.join(evidence,localDiagnostic?'synthetic-shared-budget.jsonl':'shared-r2-journal.jsonl');
    const budgetPort=fs.existsSync(sharedJournalPath)?replaySharedBudget(fs.readFileSync(sharedJournalPath,'utf8')).header.port:0;
    budgetCoordinator=await startCoordinator({journalPath:sharedJournalPath,port:budgetPort,tokens,
      baseline:increment?.baseline||cumulative(recovered.budget),limits:increment?.limits||{...CUMULATIVE_LIMITS,functionalRequests:493,cleanupRequests:66,objectIntentions:23,completedObjects:22},source:increment?.source||sourceHash});
    const budgetConfiguration={port:budgetCoordinator.port,token:tokens.functional};
    if (!localDiagnostic) safeguards=createSharedSafeguards({coordinator:budgetCoordinator,tokens,proofTag:runId,
      buckets:[DOCUMENTS_BUCKET,QUARANTINE_BUCKET],origin:new URL(r2env.C4G_R2_ENDPOINT).origin,parentBudget:increment.baseline});
    if (!localDiagnostic) checkIncrement(safeguards.snapshot());
    if (localDiagnostic) {
      const provider = createDocumentWorkerStorageProvider({ env: { NODE_ENV: 'test', DOCUMENT_WORKER_TEST_ADAPTERS: 'enabled', DOCUMENT_WORKER_TEST_STORAGE_ROOT: storageRoot,
        DOCUMENT_PROOF_BUDGET_PORT:String(budgetConfiguration.port),DOCUMENT_PROOF_BUDGET_TOKEN:budgetConfiguration.token } });
      storage = observedLocalStorage(storageEvents, provider.create({ organizationId: orgA }));
      queue = await prepareBrowserWorker({ tenant, central, identity, organizationId: orgA, storageRoot, port: DB_PORT, scannerPort: CLAMAV_PORT, events: storageEvents,budgetConfiguration });
    } else {
      const remoteClient = providerClient(target, safeguards), rawStorage = createR2AdapterBoundary(target.configuration,
        { organizationId: orgA, credentials: target.credentials, client: remoteClient });
      storage = Object.freeze({ ...rawStorage, async beginWrite(input) { await safeguards.registerObjectIntent({ Bucket: QUARANTINE_BUCKET,
        Key: `${orgA}/${input.objectId}`, sha256: input.expectedSha256, size: input.expectedSize }); return rawStorage.beginWrite(input); } });
      cleanupClient = providerClient(target, safeguards);
      queue = await prepareBrowserWorker({tenant,central,identity,organizationId:orgA,storageRoot,port:DB_PORT,scannerPort:CLAMAV_PORT,events:storageEvents,budgetConfiguration,
        remoteStorageEnv:{...r2env,DOCUMENT_PROOF_REMOTE_STORAGE:'R2',C4G_R2_LAYER_C_VALIDATED:'true',C4G_R2_MULTIPART_CONDITIONAL_VALIDATED:'true'}});
    }
    const scanner = createClamavScanner({ organizationId: orgA, storage, host: '127.0.0.1', port: CLAMAV_PORT, timeoutMs: 60000 });
    const repository = createDocumentRepository(tenant), workerPorts = createPostgresDocumentWorkerPorts({ pool: tenant, organizationId: orgA, tenantId: identity.tenantId });
    const apiAudit = realApiAudit(tenant, orgA, identity.tenantId, storageEvents);
    const jobs = queue.jobs;
    const documentInfrastructure = Object.freeze({ repositoryFactory: value => { assert.equal(value, orgA); return repository; },
      storageFactory: value => { assert.equal(value, orgA); return storage; }, auditFactory: value => { assert.equal(value, orgA); return apiAudit; },
      reconciliationFactory: value => { assert.equal(value, orgA); return workerPorts.reconciliation; }, jobs,
      id: crypto.randomUUID, downloadStaging, migrationReady: true, scannerReady: true, reconciliationLagSeconds: 0 });
    await waitForScanner(scanner);
    await queue.start();
    const drainWorker = () => queue.stop();

    phase = 'API_COMPOSITION';
    const env = { ...process.env, AUTH_MODE: 'oidc', NODE_ENV: 'production', PUBLIC_APP_URL: ORIGIN, CORS_ORIGIN: ORIGIN,
      OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId, OIDC_REDIRECT_URI: `${ORIGIN}/api/auth/oidc/callback`,
      OIDC_POST_LOGOUT_REDIRECT_URI: `${ORIGIN}/login`, SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
      SESSION_COOKIE_NAME: '__Host-c4g_doc_demo', AUTH_POLICY_VERSION: 'c4g-assurance-v1',
      SESSION_IDLE_MS: '1800000', SESSION_ABSOLUTE_MS: '28800000', OIDC_TRANSACTION_MS: '600000',
      AUTH_ASSURANCE_POLICY_JSON: JSON.stringify(RECOGNIZED_ASSURANCE_POLICIES['c4g-assurance-v1'].policy),
      PRIVILEGED_LOGIN_ASSURANCE_CATEGORY: 'recent-mfa', OIDC_PRIVILEGED_ROLE_NAMES: 'C4G_ADMIN',
      CENTRAL_DATABASE_URL: central.connectionString, AUTHORITY_DATABASE_URL: central.authorityConnectionString,
      AUTHORITY_COMMIT_PERMIT_SECRET: central.permitSecret, DB_HOST: '127.0.0.1', DB_PORT: String(DB_PORT), DB_NAME: 'postgres',
      DB_USER: 'c4g_f12_admin', DB_PASSWORD: dbPassword, OPPORTUNITIES_RUNTIME: 'f12', OPPORTUNITY_IMPORTS_RUNTIME: 'disabled',
      PROFILE_EDITORIAL_RUNTIME: 'disabled', DOCUMENTS_RUNTIME: 'f11-r2', DISABLE_NOTIFICATION_SCHEDULER: 'true',
      DISABLE_EU_FUNDING_CRON: 'true', DISABLE_LEGACY_DATA_BOOTSTRAP: 'true', C4G_RUNTIME: 'local', PORT: String(API_PORT),
      C4G_R2_ENDPOINT: r2env.C4G_R2_ENDPOINT, C4G_R2_DOCUMENTS_BUCKET: r2env.C4G_R2_DOCUMENTS_BUCKET,
      C4G_R2_QUARANTINE_BUCKET: r2env.C4G_R2_QUARANTINE_BUCKET, C4G_R2_ACCESS_KEY_ID: r2env.C4G_R2_ACCESS_KEY_ID,
      C4G_R2_SECRET_ACCESS_KEY: r2env.C4G_R2_SECRET_ACCESS_KEY, C4G_R2_LAYER_C_VALIDATED: 'true',
      C4G_R2_MULTIPART_CONDITIONAL_VALIDATED: 'true', C4G_CLAMAV_HOST: '127.0.0.1', C4G_CLAMAV_PORT: String(CLAMAV_PORT) };
    legacyPool = new Pool({ connectionString: adminUrl, max: 2 });
    trackPool(legacyPool);
    const routes = Object.fromEntries(['auth', 'dashboard', 'ubiStructure', 'users', 'professors', 'researchAreas', 'opportunities',
      'applications', 'partners', 'imports', 'integrations', 'matching', 'notifications'].map(key => [key, express.Router()]));
    const dependencies = { express, cors, centralPool: central.pool, authorityPool: central.authorityPool, legacyPool, routes, services: {},
      opportunityRuntimeDependencies: runtimeFixture.dependencies, applicationDocumentInfrastructure: documentInfrastructure };
    const createComposition = () => require('../../../backend/src/productionComposition').createProductionComposition({ env, dependencies });
    let composition = createComposition(); assert.equal(composition.documentBootstrap.ready, true);
    const startApi = () => new Promise((resolve, reject) => {
      ownedRequestWork.push(trackExpress(composition.app));
      server = composition.app.listen(API_PORT, '127.0.0.1');
      ownedHttpServers.push(watchServer(server));
      server.once('error', reject); server.once('listening', resolve);
    });
    await startApi(); await waitHttp(`${ORIGIN}/login`);

    phase = 'BROWSER';
    const docx = fixture('valid-docx');
    browserBlocker=await startBrowserEgressBlocker();
    browser = await chromium.launch({ headless: true, proxy:browserBlocker.proxy, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const recordBrowser = value => { const event = Object.freeze({ at: new Date().toISOString(), ...value });browserEvents.push(event);
      if (/^BROWSER_|^DOWNLOAD_|^REVOCATION_UI_/.test(event.kind)) {downloadEvidence.push(event);if(downloadEvidence.length>100)throw new Error('BROWSER_EVIDENCE_LIMIT');}
      if (event.path?.endsWith('/documents/candidates') || event.kind === 'ASSOCIATION_STATE') { candidateEvidence.push(event); if (candidateEvidence.length > 100) candidateEvidence.shift(); }
      if (browserEvents.length > 120) browserEvents.shift(); };
    const installDiagnostics = (page, browserContext) => {
      page.on('pageerror', error => recordBrowser({ browserContext, kind: 'JAVASCRIPT_ERROR', name: error.name || 'Error', message: safe(error.message).slice(0, 400) }));
      page.on('console', message => { if (message.type() === 'error') recordBrowser({ browserContext, kind: 'CONSOLE_ERROR', message: safe(message.text()).slice(0, 400) }); });
      page.on('request', request => { const url = new URL(request.url()); if (url.origin === ORIGIN && url.pathname.startsWith('/api/')) {
        const requestSequence = ++browserRequestSequence; browserRequestOrder.set(request, requestSequence);
        if (url.pathname.endsWith('/documents/upload-intents')) uploadPhase = 'INTENT_REQUESTED';
        if (/\/documents\/uploads\//.test(url.pathname)) uploadPhase = 'CONTENT_REQUESTED';
        recordBrowser({ browserContext, kind: 'HTTP_REQUEST', requestSequence, method: request.method(), path: url.pathname });
      } });
      page.on('requestfailed', request => { const url = new URL(request.url()); if (url.origin === ORIGIN) recordBrowser({ browserContext, kind: 'HTTP_REQUEST_FAILED',
        method: request.method(), path: url.pathname, reason: safe(request.failure()?.errorText).slice(0, 200) }); });
      page.on('response', async response => { try { const url = new URL(response.url()); if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/')) return;
        const entry = { kind: 'HTTP_RESPONSE', requestSequence: browserRequestOrder.get(response.request()) || null,
          responseSequence: ++browserResponseSequence, method: response.request().method(), path: url.pathname,
          status: response.status(), publicCode: null, correlationId: null };
        if ((response.headers()['content-type'] || '').includes('application/json')) { try { const body = await response.json();
          entry.publicCode = String(body?.error?.code || body?.code || '').slice(0, 96) || null;
          entry.correlationId = /^[0-9a-f-]{36}$/i.test(body?.correlationId || '') ? body.correlationId : null;
          if (url.pathname.endsWith('/documents/candidates')) entry.candidateProjection = Object.freeze({
            items: Object.freeze((body?.items || []).slice(0, 25).map(item => Object.freeze({
              documentId: item.documentId || null, versionId: item.versionId || null, state: item.state || null,
              scanState: item.scanState || null, usable: item.usable === true }))), nextCursor: body?.nextCursor || null });
        } catch {} }
        if (url.pathname.endsWith('/documents/upload-intents')) uploadPhase = response.ok() ? 'INTENT_ACCEPTED' : 'INTENT_REFUSED';
        if (/\/documents\/uploads\//.test(url.pathname)) uploadPhase = response.ok() ? 'CONTENT_CONFIRMED' : 'CONTENT_REFUSED';
        recordBrowser({ browserContext, ...entry });
      } catch {} });
    };
    const installR2Route = async(context,page)=>page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(![ORIGIN,`http://localhost:${KEYCLOAK_PORT}`].includes(url.origin))return route.abort('blockedbyclient');
      return route.continue();
    }); // Normal browser navigation; no provider GET, fulfilment or R2 reservation here.
    async function login(user) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
      const page = await context.newPage(), responses = []; await installR2Route(context,page);
      installDiagnostics(page, user.label);
      page.on('response', response => { try { const url = new URL(response.url()); if (url.hostname === 'localhost') {
        responses.push({ path: url.pathname, status: response.status() }); if (responses.length > 12) responses.shift();
      } } catch {} });
      await page.goto(`${ORIGIN}/login`);
      await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('#username').fill(user.username); await page.locator('#password').fill(user.password); await page.locator('#kc-login').click();
      await page.locator('#otp').fill(totp(user.totp)); await page.locator('#kc-login').click();
      try {
        await page.waitForURL(url => url.origin === ORIGIN && !url.pathname.startsWith('/api/'), { timeout: 30000, waitUntil: 'domcontentloaded' });
      } catch (cause) {
        const state = await page.evaluate(() => { let publicCode = null; try { publicCode = JSON.parse(document.body.innerText).code || null; } catch {}
          return { path: location.pathname, title: document.title, publicCode,
            error: document.querySelector('#input-error, .kc-feedback-text')?.textContent?.trim() || null }; }).catch(() => ({ path: 'UNAVAILABLE', title: null, publicCode: null, error: null }));
        throw Object.assign(new Error(`OIDC_LOGIN_NOT_COMPLETED:${JSON.stringify({ ...state, responses })}`), { cause });
      }
      const session = await page.evaluate(async () => { const response = await fetch('/api/auth/session'); return response.status; }); assert.equal(session, 200);
      return { context, page };
    }
    async function stepUp(current, user, returnPath) {
      // Fixture-only fresh IdP authentication; application session is retained.
      // The real callback still verifies original issuer/subject and real OTP evidence.
      await current.context.clearCookies({name:/^(KEYCLOAK_IDENTITY|KEYCLOAK_SESSION|AUTH_SESSION_ID|KC_RESTART)(_LEGACY)?$/});
      recordBrowser({kind:'OIDC_STEP_UP_FIXTURE_FRESH_SSO',applicationSessionPreserved:true});
      const stepUpResponse=await current.page.goto(`${ORIGIN}/api/auth/step-up?category=recent-mfa&returnTo=${encodeURIComponent(returnPath)}`);
      if(stepUpResponse?.status()>=400)throw new Error(`OIDC_STEP_UP_HTTP_${stepUpResponse.status()}`);
      const username = current.page.locator('#username'), password = current.page.locator('#password');
      if (await password.isVisible().catch(() => false)) {
        if (await username.isVisible().catch(() => false)) await username.fill(user.username);
        await password.fill(user.password); await current.page.locator('#kc-login').click();
      }
      await current.page.locator('#otp').waitFor({ state: 'visible', timeout: 30000 });
      await current.page.locator('#otp').fill(totp(user.totp)); await current.page.locator('#kc-login').click();
      await current.page.waitForURL(url => url.origin === ORIGIN && (url.pathname === returnPath||url.pathname==='/api/auth/oidc/callback'),
        { timeout: 30000, waitUntil: 'domcontentloaded' });
      if(new URL(current.page.url()).pathname==='/api/auth/oidc/callback')throw new Error('OIDC_STEP_UP_CALLBACK_REJECTED');
    }
    async function observeAssurance(user, requireOtp = false) {
      const row = (await central.pool.query(`SELECT store.sess FROM public.application_session session
        JOIN public.application_session_store store ON store.sid=session.sid
        WHERE session.global_user_id=$1 ORDER BY session.created_at DESC LIMIT 1`, [user.id])).rows[0];
      const evidence = row?.sess?.auth?.evidence, ageSeconds = Math.floor(Date.now() / 1000) - evidence?.authTime;
      browserEvents.push(Object.freeze({ kind: 'OIDC_ASSURANCE_OBSERVED', browserContext: user.label,
        acr: evidence?.acr || null, amr: Array.isArray(evidence?.amr) ? [...evidence.amr] : null, ageSeconds, at: new Date().toISOString() }));
      assert.equal(evidence?.acr, 'c4g-loa2');
      if (requireOtp) assert(evidence.amr.includes('otp'));
      assert(Number.isFinite(evidence.authTime) && ageSeconds <= 300);
      return evidence;
    }
    async function selectOrganization(page, organizationId) {
      const select = page.getByLabel(/Organiza.*ativa/i); await select.selectOption(organizationId);
      let active = false; for (let attempt = 0; attempt < 60 && !active; attempt += 1) {
        active = await select.inputValue() === organizationId; if (!active) await sleep(100);
      } assert.equal(active, true);
      await page.getByText(/A mudar de organiza/i).waitFor({ state: 'hidden' });
      const selected = await page.evaluate(async expected => { const response = await fetch('/api/auth/session');
        const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        return { status: response.status, organizationId: body?.organization?.id || null, matches: body?.organization?.id === expected }; }, organizationId);
      assert.deepEqual(selected, { status: 200, organizationId, matches: true });
    }
    const a = await login(users[0]), b = await login(users[1]);
    await observeAssurance(users[0]); await observeAssurance(users[1]);
    for (const current of [a, b]) {
      const persistedAuthenticationMaterial = await current.page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
      assert.deepEqual(persistedAuthenticationMaterial, {});
    }
    await selectOrganization(a.page, orgA); await selectOrganization(b.page, orgA);
    if (!localDiagnostic) {
      const initialInventory = await inventoryPrefix(cleanupClient, target);
      assert.equal(initialInventory.objects.length, 0); assert.equal(initialInventory.uploads.length, 0);
      proofStarted = true;
      assert.deepEqual(await storage.health(), { ready: true, adapter: 'r2-s3-v1' });
    } else {
      assert.deepEqual(await storage.health(), { ready: true, adapter: 'controlled-local-document-storage-v1' });
    }
    await waitForScanner(scanner);
    const applicationUrl = `${ORIGIN}/candidaturas/${seeded.applicationId}`; activePage = a.page; await a.page.goto(applicationUrl);
    await a.page.getByRole('heading', { name: 'Candidatura', exact: true }).waitFor();
    assert.equal(await a.page.getByRole('alert').count(), 0);
    uploadPhase = 'FILE_SELECTED';
    await a.page.getByLabel(/Ficheiro documental/i).setInputFiles({ name: docx.filename, mimeType: docx.mime, buffer: docx.bytes });
    await a.page.getByRole('button', { name: /Iniciar upload seguro/i }).click();
    const uploadAlert = a.page.getByRole('alert');
    await Promise.race([
      a.page.getByText(/Upload confirmado/i).waitFor({ timeout: 30000 }).then(() => { uploadPhase = 'UI_CONFIRMED'; }),
      uploadAlert.waitFor({ timeout: 30000 }).then(async () => { const text = (await uploadAlert.innerText()).slice(0, 300);
        throw new Error(`UPLOAD_UI_REFUSED:${uploadPhase}:${text}`); })
    ]);
    const availableOption = a.page.getByLabel(/Vers.*dispon.*vel/i).locator('option:not([value=""])');
    await availableOption.waitFor({ state: 'attached', timeout: 30000 });
    assert.equal(await availableOption.isDisabled(), false);
    if (localUploadOnly) {
      const version = (await tenant.query(`SELECT version_id,state,scan_state,observed_size,sha256,confirmed_at
        FROM document_storage.document_version WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1`, [orgA])).rows[0];
      assert(version); assert.equal(version.state, 'AVAILABLE'); assert.equal(version.scan_state, 'CLEAN');
      assert.equal(Number(version.observed_size), docx.size); assert.equal(version.sha256, docx.sha256); assert(version.confirmed_at);
      assert(storageEvents.some(event => event.method === 'beginWrite')); assert(storageEvents.some(event => event.method === 'write'));
      assert(storageEvents.some(event => event.method === 'commit')); assert(storageEvents.some(event => event.method === 'head'));
      await preserveDiagnostic('LOCAL_UPLOAD_SUCCESS');
      const result = { result: 'PASS', mode: 'LOCAL_CONTROLLED_STORAGE', runId, uploadPhase, applicationId: seeded.applicationId,
        versionId: version.version_id, state: version.state, scanState: version.scan_state, contentSha256: version.sha256,
        browserEvents, storageEvents, services: { oidc: 'REAL_KEYCLOAK', authority: 'REAL_CENTRAL', tenant: 'REAL_POSTGRESQL',
          queue: 'REAL_PG_BOSS', worker: 'REAL_DOCUMENT_WORKER_RUNTIME', scanner: 'REAL_CLAMAV_FRESHCLAM_DISABLED',
          storage: 'CONTROLLED_LOCAL_DOUBLE', browser: 'REAL_CHROME_PLAYWRIGHT' }, r2Requests: 0 };
      fs.writeFileSync(path.join(evidence, 'local-upload-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      process.stdout.write(`${JSON.stringify({ result: result.result, mode: result.mode, evidence, uploadPhase, r2Requests: 0 })}\n`);
      return;
    }
    const versionSelect = a.page.getByLabel(/Vers.*dispon.*vel/i), associateButton = a.page.getByRole('button', { name: /Associar vers/i });
    const associationState = async label => { const value = await versionSelect.inputValue(), options = await versionSelect.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, disabled: node.disabled, selected: node.selected })));
      const state = Object.freeze({ kind: 'ASSOCIATION_STATE', label, value, options, buttonDisabled: await associateButton.isDisabled(),
        pendingStatus: await a.page.getByText(/Envio por confirmar|Upload por confirmar/i).count() > 0, at: new Date().toISOString() });
      browserEvents.push(state);candidateEvidence.push(state);return state; };
    await associationState('BEFORE_SELECTION'); const selectedValues = await versionSelect.selectOption({ index: 1 }); await associationState('AFTER_SELECTION');
    await a.page.waitForFunction(expected => { const section = document.querySelector('section[aria-label="Documentos e revisão interna"]');
      const select = section?.querySelector('select'), button = [...(section?.querySelectorAll('button') || [])].find(node => node.textContent?.startsWith('Associar versão'));
      return select?.value === expected && button?.disabled === false; }, selectedValues[0], { polling: 'raf', timeout: 10000 });
    await associationState('READY_TO_ASSOCIATE');
    await associateButton.click(); await a.page.getByText(/Altera.*confirmada/i).waitFor();
    const downloadPromise = a.page.waitForEvent('download'); await a.page.getByRole('button', { name: /Descarregar vers/i }).click();
    const download = await downloadPromise, downloaded = fs.readFileSync(await download.path()); assert.equal(sha(downloaded), docx.sha256);
    assert.equal(new URL(download.url()).origin,ORIGIN);
    assert.equal(downloaded.length,docx.size);recordBrowser({kind:'BROWSER_DOWNLOAD_VERIFIED',size:downloaded.length,sha256:sha(downloaded)});
    for(let attempt=0;downloadStaging.snapshot().active&&attempt<50;attempt++)await sleep(20);
    assert.deepEqual(downloadStaging.snapshot(),{active:0,reserved:0});
    assert.equal(fs.readdirSync(stagingDirectory).filter(name=>name.endsWith('.part')).length,0);
    const stagingAcl=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '$a=Get-Acl -LiteralPath $env:PROOF_STAGING; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @{protected=$a.AreAccessRulesProtected;rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object {@{self=($_.IdentityReference.Value -eq $u);type=$_.AccessControlType.ToString();rights=$_.FileSystemRights.ToString();inherited=$_.IsInherited}})}|ConvertTo-Json -Depth 4'],
      {env:{...process.env,PROOF_STAGING:stagingDirectory},windowsHide:true,encoding:'utf8'}));
    assert.equal(stagingAcl.protected,true);assert(stagingAcl.rules.length>0);assert(stagingAcl.rules.every(rule=>rule.self&&rule.type==='Allow'&&!rule.inherited));
    fs.writeFileSync(path.join(evidence,'staging-assessment.json'),JSON.stringify({acl:stagingAcl,quotas:downloadStaging.snapshot(),residualFiles:0,delivery:'SAME_ORIGIN_API',size:downloaded.length,sha256:sha(downloaded)},null,2)+'\n',{flag:'wx'});
    await a.page.getByRole('button', { name: /Solicitar revis/i }).click(); await a.page.getByText(/Altera.*confirmada/i).waitFor();
    await a.page.screenshot({ path: path.join(evidence, 'requester-after-review-request.png'), fullPage: true });

    await stepUp(b, users[1], new URL(applicationUrl).pathname); await observeAssurance(users[1], true);
    await b.page.goto(applicationUrl);
    await b.page.getByRole('button', { name: /Registar decis/i }).waitFor();
    await b.page.getByLabel(/Coment.*rio/i).fill('Conjunto documental verificado por revisor sintético distinto.');
    await b.page.getByRole('button', { name: /Registar decis/i }).click(); await b.page.getByText(/Altera.*confirmada/i).waitFor();
    await b.page.getByText(/Aprovado internamente/i).waitFor();
    const historyText = await b.page.getByText(/Hist.*rico documental/i).locator('..').innerText();
    assert(historyText.includes('vers')); await b.page.screenshot({ path: path.join(evidence, 'reviewer-after-decision.png'), fullPage: true });

    await selectOrganization(b.page, orgB); await b.page.goto(applicationUrl); await b.page.getByRole('alert').waitFor();
    assert(!(await b.page.locator('body').innerText()).includes('Synthetic document application'));
    await b.page.close(); b.page = await b.context.newPage(); await installR2Route(b.context,b.page); installDiagnostics(b.page, users[1].label);
    await b.page.goto(ORIGIN); await b.page.getByLabel(/Organiza.*ativa/i).waitFor();
    await selectOrganization(b.page, orgA); await b.page.goto(applicationUrl); await b.page.getByRole('heading', { name: 'Candidatura', exact: true }).waitFor();
    const beforeRevocation = safeguards.snapshot();
    await createMembershipRepository(central.pool, central.coordinator).changeStatus({ membershipId: memberBA, status: 'REMOVED', reason: 'DOC_MVP01_BROWSER_PROOF' });
    const revocationEventIndex = browserEvents.length; await b.page.reload();
    const revokedOrganizationSelector = b.page.getByLabel(/Organiza.*ativa/i);
    const revokedOrganizationElement = await revokedOrganizationSelector.elementHandle(); assert(revokedOrganizationElement);
    await b.page.waitForFunction(select => select.value === '' && /Selecione/i.test(select.selectedOptions[0]?.textContent || ''),
      revokedOrganizationElement, { polling: 'raf', timeout: 30000 });
    const organizationPrompt = await revokedOrganizationSelector.locator('option:checked').innerText();
    assert(/Selecione.*organiza/i.test(organizationPrompt));
    // Observe the UI completing organization invalidation before issuing an
    // additional diagnostic read; do not race session regeneration on reload.
    const revokedSession = await b.page.evaluate(async () => { const response = await fetch('/api/auth/session'); const body = await response.json();
      return { status: response.status, organizationId: body?.organization?.id || null }; });
    assert.deepEqual(revokedSession, { status: 200, organizationId: null });
    const revocationStatuses = await b.page.locator('[role="status"]').allTextContents();
    assert.equal(await b.page.getByText('Synthetic document application').count(), 0);
    assert.equal(await b.page.getByRole('button', { name: /Repetir/i }).count(), 0);
    assert.equal(browserEvents.slice(revocationEventIndex).some(event => event.path?.includes(`/api/applications/${seeded.applicationId}`)), false);
    browserEvents.push(Object.freeze({ kind: 'REVOCATION_UI_STATE', organizationId: null, organizationPrompt: organizationPrompt.slice(0, 160),
      publicStatuses: revocationStatuses.map(value => value.slice(0, 160)),
      protectedLookupAttempted: false, retryOffered: false, at: new Date().toISOString() }));
    assert.deepEqual(safeguards.snapshot(), beforeRevocation);

    phase = 'RESTART';
    await new Promise(resolve => server.close(resolve)); server = null; await drainWorker();
    await queue.start();
    composition = createComposition(); await startApi(); await waitHttp(`${ORIGIN}/login`);
    await a.page.reload(); await a.page.getByText(/Aprovado internamente/i).waitFor({ timeout: 30000 });
    const persisted = await tenant.query(`SELECT r.request_id,d.decision,i.version_id FROM opportunity_catalog.application_review_request r
      JOIN opportunity_catalog.application_review_item i ON i.organization_id=r.organization_id AND i.request_id=r.request_id
      LEFT JOIN opportunity_catalog.application_review_decision d ON d.organization_id=r.organization_id AND d.request_id=r.request_id
      WHERE r.organization_id=$1 AND r.application_id=$2`, [orgA, seeded.applicationId]);
    assert.equal(persisted.rowCount, 1); assert.equal(persisted.rows[0].decision, 'APPROVED');

    await drainWorker();
    await Promise.all([a.page.goto('about:blank', { waitUntil: 'commit' }), b.page.goto('about:blank', { waitUntil: 'commit' })]);
    const pools = [tenant, central.pool, central.authorityPool, legacyPool].filter(Boolean); let idleSamples = 0;
    for (let attempt = 0; attempt < 50 && idleSamples < 3; attempt += 1) {
      const idle = pools.every(pool => pool.waitingCount === 0 && pool.idleCount === pool.totalCount);
      idleSamples = idle ? idleSamples + 1 : 0; if (idleSamples < 3) await sleep(100);
    }
    assert.equal(idleSamples, 3); storageEvents.push(Object.freeze({ kind: 'LOCAL_TEARDOWN_QUIESCED', at: new Date().toISOString() }));

    const diagnostic = await preserveDiagnostic('SUCCESS');
    assert.equal(preserveResources, false, 'Diagnostic queries must all succeed');
    assert.equal(diagnostic.inbox.rows.length, 1);
    assert.equal(diagnostic.inbox.rows[0].state, 'COMPLETED');
    assert.equal(diagnostic.inbox.rows[0].job_type, 'document.scan');
    assert(Number(diagnostic.inbox.rows[0].fence) >= 1);
    assert.equal(diagnostic.scans.rows.length, 1);
    assert.equal(diagnostic.scans.rows[0].result, 'CLEAN');
    assert.equal(diagnostic.scans.rows[0].result_code, 'OOXML_STRUCTURAL_APPROVED');
    assert.equal(diagnostic.scans.rows[0].input_digest, docx.sha256);
    assert.equal(diagnostic.scans.rows[0].version_id, persisted.rows[0].version_id);
    assert.equal(diagnostic.audit.rows.length, 1);
    assert.equal(diagnostic.outbox.rows[0].execution_id, diagnostic.inbox.rows[0].execution_id);
    const clamav = { version: docker('exec', names.clamav, 'clamdscan', '--version'), image: docker('inspect', '-f', '{{.Image}}', names.clamav),
      freshclamDisabled: docker('inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', names.clamav).includes('CLAMAV_NO_FRESHCLAMD=true') };
    assert.equal(clamav.freshclamDisabled, true);
    const beforeCleanup = { result: 'PASS_BEFORE_CLEANUP', runId, parent: PARENT, phaseBudget: safeguards.snapshot(),
      executionBudget:localDiagnostic?null:checkIncrement(safeguards.snapshot()),historicalAccounting:'INCOMPLETE_UNCHANGED', applicationId: seeded.applicationId,
      reviewRequestId: persisted.rows[0].request_id, versionId: persisted.rows[0].version_id, contentSha256: docx.sha256,
      services: { oidc: 'REAL_KEYCLOAK', apiComposition: 'PRODUCTION_COMPOSITION_WITH_EXPLICIT_REAL_INFRASTRUCTURE',
        authority: 'REAL_CENTRAL', tenant: 'REAL_POSTGRESQL', queue: 'REAL_PG_BOSS', worker: 'REAL_DOCUMENT_WORKER_RUNTIME',
        scanner: 'REAL_CLAMAV_FRESHCLAM_DISABLED', storage: localDiagnostic ? 'CONTROLLED_LOCAL_DOUBLE' : 'REAL_R2', browser: 'REAL_CHROME_PLAYWRIGHT' }, clamav,
      limitations: ['DEFAULT_API_DOCUMENT_INFRASTRUCTURE_COMPOSER_ABSENT', 'MFA_RECOVERY_UI_ABSENT',
        'WORKER_SUBPROCESS_REAL_LOADER_F9_TEST_STORAGE', 'VPS_SUPERVISION_NOT_VALIDATED'] };
    if (localFull) {
      const result = { ...beforeCleanup, result: 'PASS', mode: 'LOCAL_FULL_CONTROLLED_STORAGE', r2Requests: 0, codeHashes, syntheticSharedBudget:budgetCoordinator.snapshot(),
        cleanup: Object.freeze({ status: 'NOT_APPLICABLE' }) };
      fs.writeFileSync(path.join(evidence, 'local-full-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      process.stdout.write(`${JSON.stringify({ result: result.result, mode: result.mode, evidence, r2Requests: 0 })}\n`);
      return;
    }
    fs.writeFileSync(path.join(evidence, 'result-before-cleanup.json'), `${JSON.stringify(beforeCleanup, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    phase = 'CLEANUP'; cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3); proofStarted = false;
    const finalInventory = await inventoryPrefix(cleanupClient, target); assert.equal(finalInventory.objects.length, 0); assert.equal(finalInventory.uploads.length, 0);
    const result = { ...beforeCleanup, result: 'PASS', cleanup, finalPhaseBudget: safeguards.snapshot(),
      finalExecutionBudget:checkIncrement(safeguards.snapshot()), finalPrefixEmpty: true };
    fs.writeFileSync(path.join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ result: result.result, evidence, cleanup: cleanup.status,
      executionBudget:result.finalExecutionBudget })}\n`);
  } catch (error) {
    try { const proxyLog=docker('logs','--tail','60',names.proxy);
      fs.writeFileSync(path.join(evidence,`proxy-diagnostic-${Date.now()}.txt`),safe(proxyLog).replace(/(\/[A-Za-z0-9_/.%-]+)\?[^\s"]+/g,'$1?[QUERY_REDACTED]'),{flag:'wx'});
    } catch {}
    let diagnosticCapture = null;
    try { diagnosticCapture = await preserveDiagnostic('FAILURE'); }
    catch (captureError) {
      preserveResources = true;
      diagnosticCapture = Object.freeze({ available: false, errorCode: String(captureError?.code || captureError?.name || 'DIAGNOSTIC_CAPTURE_FAILED').slice(0, 64) });
    }
    const uiState = activePage ? await activePage.evaluate(() => ({ path: location.pathname,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent.trim().slice(0, 300)),
      statuses: [...document.querySelectorAll('[role="status"]')].map(node => node.textContent.trim().slice(0, 300)) })).catch(() => null) : null;
    fs.writeFileSync(path.join(evidence, `failure-${Date.now()}.json`), `${JSON.stringify({ phase, code: error.code || error.name,
      message: safe(error.message), stack: safe(error.stack), uploadPhase, uiState, diagnosticCapture, browserEvents, storageEvents,
      executionBudget:safeguards.snapshot(),historicalAccounting:'INCOMPLETE_UNCHANGED' }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    throw error;
  } finally {
    OidcClient.prototype.callback=originalOidcCallback;
    let drained = false;
    const shutdownEvents = [];
    try {
      await createLauncherDrain({ servers: ownedHttpServers, work: ownedRequestWork, pools: [tenant, central?.pool, central?.authorityPool, legacyPool, adminPool],
        closePools: false, graceMs: 5000, settleMs: 35000, record: event => shutdownEvents.push(event),
        stopProducers: async () => {
          stopWorker = true; if (workerLoop) { clearInterval(workerLoop); workerLoop = null; }
          if (browser) await browser.close();
          if (browserBlocker) await browserBlocker.close();
        },
        stopWorkers: async () => { if (queue) await queue.close(); },
        closeConsumers: async () => {
          if (controlledStorageServer) await new Promise((resolve, reject) => controlledStorageServer.close(error => error ? reject(error) : resolve()));
          if (runtimeFixture) await runtimeFixture.manager.closeAll();
        }
      })();
      drained = true;
    } catch (error) {
      preserveResources = true; process.exitCode = 1;
      shutdownEvents.push({ phase: 'FAILED_RESOURCES_PRESERVED', code: error.code || error.name, message: safe(error.message) });
    }
    fs.writeFileSync(path.join(evidence, 'shutdown.json'), JSON.stringify({ drained, events: shutdownEvents }, null, 2));
    if (proofStarted && cleanupClient) cleanup = await safeguards.cleanupKnownResources(cleanupClient, s3).catch(() => ({ status: 'UNCERTAIN' }));
    if(!localDiagnostic&&budgetCoordinator)fs.writeFileSync(path.join(evidence,'cleanup-final.json'),JSON.stringify({cleanup,executionBudget:safeguards.snapshot(),recordedAggregate:budgetCoordinator.snapshot(),historicalAccounting:'INCOMPLETE_UNCHANGED'},null,2)+'\n',{flag:'wx'});
    if (storage) await storage.shutdown().catch(() => {}); cleanupClient?.destroy?.();
    if (drained && central) await central.close({ retain: preserveResources });
    if (budgetCoordinator) await budgetCoordinator.close();
    if (drained) { if (tenant) await tenant.end(); if (legacyPool) await legacyPool.end(); if (adminPool) await adminPool.end(); }
    safeguards.close();
    downloadStaging.close();
    if (preserveResources) {
      for (const [kind, name] of resources) if (kind === 'container') try { docker('stop', '-t', '10', name); } catch {}
      fs.writeFileSync(path.join(evidence, `preserved-resources-${Date.now()}.json`), `${JSON.stringify({ status: 'PRESERVED_STOPPED', resources }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    } else {
      for (const [kind, name] of resources.reverse()) try { if (kind === 'container') docker('rm', '-f', '-v', name); else docker('network', 'rm', name); } catch {}
      // This directory was created exclusively for this run; never retain document bytes in evidence.
      const controlledRoot = path.resolve(evidence,'controlled-storage');
      if (localDiagnostic && controlledRoot.startsWith(path.resolve(evidence)+path.sep)) fs.rmSync(controlledRoot,{recursive:true,force:true});
    }
  }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${JSON.stringify({ code: error.code || error.name, message: safe(error.message) })}\n`); process.exitCode = 1; });
module.exports = { CUMULATIVE_LIMITS, PHASE_LIMITS, PHASE_BASELINE, PHASE_RUN_ID, REMOTE_PLAN, PARENT,
  assertBudget, assertRemotePlan, cumulative, validateParentJournal, validatePhaseJournal };
