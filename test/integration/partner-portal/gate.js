'use strict';
// Offline by default. All infrastructure/PG imports are inside executeGate.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify, isDeepStrictEqual } = require('node:util');
const policy = require('./policy.json');
const { evaluateCapacity } = require('./capacity');
const { evaluateProbeEvidence } = require('./evidence');
const root = path.resolve(__dirname, '../../..');
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{64}$/;
function requireCheck(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }

function parseArgs(args) {
  if (!args.length || args.length === 1 && args[0] === '--plan') return { mode: 'plan' };
  if (args.length === 2 && args[0] === '--evaluate') return { mode: 'evaluate', file: args[1] };
  requireCheck(args.length === 5 && args[0] === '--execute' && args[1] === '--scope'
    && args[2] === policy.scope && args[3] === '--image-id' && imagePattern.test(args[4]), 'INVALID_GATE_ARGUMENTS');
  return { mode: 'execute', scope: args[2], imageId: args[4] };
}

function describePlan() {
  return { policy: policy.id, status: 'NOT_RUN', databaseExecuted: false, scope: policy.scope,
    postgresMajor: policy.postgresMajor, isolation: policy.isolation, requiredCases: policy.requiredCases,
    capacity: policy.capacity, productionCapacityApproved: false,
    executionRequirements: ['Explicit authorization for disposable infrastructure', 'Immutable locally available image ID',
      'Owned container identity verified before SQL', 'Source manifest matches reviewed files', 'No inherited database configuration'],
    creates: ['One new labelled PostgreSQL container, random loopback port and anonymous data volume',
      'Synthetic Central and two tenant databases, existing migrations and isolated roles/grants',
      'Fresh context/reviews/partner-portal-pg-<runId> evidence directory'],
    cleanup: 'Only the exact container created by this run, after rechecking ownership; remove its anonymous volumes',
    existingServices: 'Never stop, pause, reconfigure or use existing services/databases' };
}

function inspectOwnership(info, { containerId, imageId, runId, cleanup = false }) {
  requireCheck(idPattern.test(containerId) && imagePattern.test(imageId) && /^[a-f0-9]{32}$/.test(runId), 'INVALID_OWNERSHIP_REQUEST');
  requireCheck(info?.Id === containerId && info.Image === imageId && info.Name === `/c4g-partner-portal-${runId}`
    && info.Config?.Labels?.['c4g.partner-portal.run'] === runId, 'CONTAINER_OWNERSHIP_MISMATCH');
  requireCheck(Array.isArray(info.Mounts) && info.Mounts.every(mount => mount.Type === 'volume' || mount.Type === 'tmpfs'), 'UNEXPECTED_CONTAINER_MOUNT');
  if (cleanup) return { containerId, imageId, runId };
  const ports = info.NetworkSettings?.Ports?.['5432/tcp'];
  requireCheck(info.State?.Running === true && Array.isArray(ports) && ports.length === 1
    && ports[0].HostIp === '127.0.0.1' && /^\d+$/.test(ports[0].HostPort), 'INVALID_ISOLATED_ENDPOINT');
  const port = Number(ports[0].HostPort);
  requireCheck(Number.isSafeInteger(port) && port > 1024 && port <= 65535 && ![5432, 5433].includes(port), 'INVALID_ISOLATED_PORT');
  return { containerId, imageId, runId, host: '127.0.0.1', port };
}

// Refuse rather than redact accidentally captured connection strings/SQL or
// bearer material. Producers must emit counts, outcomes and digests only.
function safeEvidence(value, depth = 0) {
  requireCheck(depth <= 32, 'UNSAFE_EVIDENCE');
  if (typeof value === 'string') requireCheck(value.length <= 4096 && !/postgres(?:ql)?:\/\//i.test(value), 'UNSAFE_EVIDENCE');
  if (typeof value === 'number') requireCheck(Number.isFinite(value), 'UNSAFE_EVIDENCE');
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      requireCheck(!/^(?:password|secret|permitSecret|connectionString|adminUrl|credentials?|tokens?|sql|stack)$/i.test(key), 'UNSAFE_EVIDENCE');
      safeEvidence(item, depth + 1);
    }
  }
  return value;
}

function verifySourceManifest(manifest, actual) {
  requireCheck(manifest?.schemaVersion === 1 && manifest.files && Object.keys(manifest.files).length > 0
    && Object.values(manifest.files).every(hash => /^[a-f0-9]{64}$/.test(hash))
    && isDeepStrictEqual(manifest.files, actual), 'SOURCE_MANIFEST_DRIFT');
  return true;
}

function collectSourceHashes(workspace = root) {
  const files = {};
  function walk(relative) {
    const location = path.join(workspace, relative);
    if (!fs.existsSync(location)) return;
    for (const name of fs.readdirSync(location).sort()) {
      const item = `${relative}/${name}`, full = path.join(workspace, item), stat = fs.lstatSync(full);
      requireCheck(!stat.isSymbolicLink(), 'SOURCE_SYMLINK_NOT_ALLOWED');
      if (stat.isDirectory()) walk(item);
      else if (/\.(?:js|json|sql|ps1)$/.test(name) && item !== 'test/integration/partner-portal/sources.json') {
        files[item] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  }
  for (const directory of ['backend/src', 'backend/database', 'backend/scripts', 'backend/prototypes', 'test/integration']) walk(directory);
  for (const file of ['backend/package.json', 'backend/package-lock.json', 'backend/test/support/partnerBrowseContract.js']) {
    files[file] = createHash('sha256').update(fs.readFileSync(path.join(workspace, file))).digest('hex');
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1));
}

function evaluateGate(report) {
  const failures = [], incomplete = [];
  if (report?.errorCode) failures.push('EXECUTION_ERROR');
  if (report?.execution !== 'POSTGRESQL') incomplete.push('POSTGRESQL_NOT_EXECUTED');
  if (!report?.sourceVerification) incomplete.push('SOURCES_NOT_VERIFIED');
  if (!imagePattern.test(report?.imageId || '') || !idPattern.test(report?.containerId || '')
    || !/^[a-f0-9]{32}$/.test(report?.runId || '')) incomplete.push('MISSING_RUN_IDENTITY');
  if (report?.postgresMajor !== policy.postgresMajor || report?.isolation !== policy.isolation) failures.push('DATABASE_PREREQUISITES');
  const probes = evaluateProbeEvidence(report?.repository, report?.authority);
  failures.push(...probes.failures); incomplete.push(...probes.incomplete);
  // Stored verdicts are never sufficient: recompute capacity from raw samples.
  const capacity = evaluateCapacity(report?.capacity?.samples || [], policy.capacity);
  const scenarios = require('./capacityProbe').CAPACITY_SCENARIOS;
  const expectedCounts = new Map(scenarios.map(scenario => [scenario.id, scenario.count]));
  if (Array.isArray(report?.capacity?.samples) && report.capacity.samples.some(row => row?.candidates !== expectedCounts.get(row?.scenarioId))) failures.push('CAPACITY_WORKLOAD_DRIFT');
  if (report?.capacity?.environmentVerified !== true) incomplete.push('UNVERIFIED_CAPACITY_ENVIRONMENT');
  if (!Array.isArray(report?.capacity?.observationErrors)) incomplete.push('MISSING_CAPACITY_OBSERVER_STATUS');
  else if (report.capacity.observationErrors.length) failures.push('CAPACITY_OBSERVER_ERRORS');
  const warmups = report?.capacity?.warmups;
  if (!Array.isArray(warmups) || warmups.length !== policy.capacity.expectedScenarioIds.length * 2) incomplete.push('MISSING_WARMUPS');
  else {
    const keys = warmups.map(row => `${row?.scenarioId}:${row?.variant}`);
    const wanted = policy.capacity.expectedScenarioIds.flatMap(id => [`${id}:before`, `${id}:after`]);
    if (new Set(keys).size !== keys.length || keys.some(key => !wanted.includes(key))) incomplete.push('INVALID_WARMUP_COVERAGE');
    for (const row of warmups) {
      const count = expectedCounts.get(row?.scenarioId), expectedError = count > 10000 ? 'LIMIT_EXCEEDED' : null;
      if (!row || row.candidates !== count || row.pair !== 0 || row.order !== 0 || row.expectedErrorCode !== expectedError
        || row.errorCode !== expectedError || row.success !== (expectedError === null)) { failures.push('WARMUP_FAILED'); continue; }
      for (const field of ['operationMs', 'admissionMs', 'responseBytes', 'cleanupMs', 'nodeRssPeakBytes', 'nodeHeapPeakBytes', 'postgresTempBytes', 'rowsRead']) {
        if (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] < 0) incomplete.push('UNMEASURED_WARMUP');
      }
      if (row.operationMs > 10000 || row.admissionMs > 5000 || row.responseBytes > 1048576 || row.cleanupMs > 10000
        || row.rowsRead !== Math.min(count, 10001) || row.nodeRssPeakBytes <= 0 || row.nodeHeapPeakBytes <= 0
        || row.success && row.afterSuccessQueries !== 0) failures.push('WARMUP_BUDGET_OR_PROTOCOL_FAILED');
    }
  }
  if (capacity.status === 'INCOMPLETE') incomplete.push('CAPACITY_INCOMPLETE');
  else if (capacity.status !== 'PASS') failures.push('CAPACITY_FAILED');
  if (report?.cleanup?.environmentClosed !== true || report?.cleanup?.containerRemoved !== true
    || !Array.isArray(report?.cleanup?.errors) || report.cleanup.errors.length) failures.push('CLEANUP_NOT_PROVEN');
  return { status: failures.length ? 'FAIL' : incomplete.length ? 'NOT_RUN' : 'PASS', failures, incomplete,
    capacity, productionCapacityApproved: false, integrationAuthorized: false };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function withDeadline(work, milliseconds, code) {
  let timeout;
  try { return await Promise.race([work, new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error(code), { code })), milliseconds); })]); }
  finally { clearTimeout(timeout); }
}
function localDockerEndpoint(endpoint, platform = process.platform) {
  return typeof endpoint === 'string' && (platform === 'win32'
    ? /^npipe:\/{4}\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(endpoint)
    : /^unix:\/\/\/(?!\/)[^\r\n]+$/.test(endpoint));
}
function unsafeInheritedEnvironment(environment) {
  return Object.keys(environment).some(key => /^(?:PG[A-Z_]|DATABASE_URL$|F13_|OPPORTUNITY_|DOCUMENT_|DOTENV_|NODE_OPTIONS$|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$)/i.test(key));
}
function safeCode(error, fallback = 'GATE_FAILED') { return typeof error?.code === 'string' && /^[A-Z0-9_]{2,80}$/.test(error.code) ? error.code : fallback; }
function recordExecutionError(report, error) {
  // Setup's exact allowlist is recorded separately. Do not echo an arbitrary
  // driver/application code just because it looks like an uppercase identifier.
  if (error?.code === 'ENVIRONMENT_SETUP_TIMEOUT') report.errorCode = 'ENVIRONMENT_SETUP_TIMEOUT';
  else report.errorCode = report.setupDiagnostic?.status === 'FAILED' ? 'ENVIRONMENT_SETUP_FAILED' : safeCode(error);
}
async function docker(args) {
  const result = await promisify(execFile)('docker', args, { windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  return result.stdout.trim();
}
async function readContainer(command, containerId) {
  const result = JSON.parse(await command(['inspect', containerId]));
  requireCheck(Array.isArray(result) && result.length === 1, 'CONTAINER_INSPECTION_FAILED');
  return result[0];
}

async function executeGate(options, { command = docker } = {}) {
  // Also enforce at the API boundary, before filesystem or subprocess work.
  requireCheck(options.scope === policy.scope && imagePattern.test(options.imageId || ''), 'EXECUTION_SCOPE_REQUIRED');
  requireCheck(!unsafeInheritedEnvironment(process.env), 'UNSAFE_INHERITED_CONFIGURATION');
  const manifestBytes = fs.readFileSync(path.join(__dirname, 'sources.json'));
  const manifest = JSON.parse(manifestBytes);
  verifySourceManifest(manifest, collectSourceHashes());
  // A remote daemon's 127.0.0.1 mapping is not this machine's loopback. Pin a
  // locally addressed context and daemon ID for every subsequent command.
  const contextName = await command(['context', 'show']);
  requireCheck(/^[a-zA-Z0-9_.-]{1,100}$/.test(contextName), 'DOCKER_CONTEXT_INVALID');
  const contexts = JSON.parse(await command(['context', 'inspect', contextName]));
  requireCheck(contexts.length === 1 && contexts[0].Name === contextName
    && localDockerEndpoint(contexts[0].Endpoints?.docker?.Host), 'LOCAL_DOCKER_REQUIRED');
  const endpoint = contexts[0].Endpoints.docker.Host;
  const pinnedCommand = args => command(['--context', contextName, ...args]);
  const daemonId = await pinnedCommand(['info', '--format', '{{.ID}}']);
  requireCheck(typeof daemonId === 'string' && daemonId.length > 0 && daemonId.length < 200, 'DOCKER_ID_REQUIRED');
  async function ownCommand(args) {
    const current = JSON.parse(await command(['context', 'inspect', contextName]));
    requireCheck(current.length === 1 && current[0].Endpoints?.docker?.Host === endpoint, 'DOCKER_CONTEXT_DRIFT');
    requireCheck(await pinnedCommand(['info', '--format', '{{.ID}}']) === daemonId, 'DOCKER_DAEMON_DRIFT');
    return pinnedCommand(args);
  }
  const image = JSON.parse(await ownCommand(['image', 'inspect', options.imageId]));
  requireCheck(image.length === 1 && image[0].Id === options.imageId && image[0].Os === 'linux', 'LOCAL_IMAGE_REQUIRED');
  const runId = randomBytes(16).toString('hex'), name = `c4g-partner-portal-${runId}`;
  const output = path.join(root, 'context/reviews', `partner-portal-pg-${runId}`);
  fs.mkdirSync(output); // Unique directory, no overwrite or recursive deletion.
  const report = { schemaVersion: 1, runId, imageId: options.imageId, execution: 'NOT_RUN', sourceVerification: true,
    sourceManifestHash: createHash('sha256').update(manifestBytes).digest('hex'),
    localDockerContext: contextName, daemonId,
    startedAt: new Date().toISOString(), cleanup: { environmentClosed: false, containerRemoved: false, errors: [] } };
  fs.writeFileSync(path.join(output, 'sources.json'), manifestBytes, { flag: 'wx' });
  const password = randomBytes(32).toString('hex');
  let containerId, env, creationAttempted = false;
  const persist = () => fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(safeEvidence(report), null, 2) + '\n');
  try {
    creationAttempted = true;
    containerId = await ownCommand(['run', '--detach', '--pull', 'never', '--name', name,
      '--label', `c4g.partner-portal.run=${runId}`, '--env', 'POSTGRES_USER=partner_gate_admin',
      '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=postgres',
      '--publish', '127.0.0.1::5432', options.imageId]);
    requireCheck(idPattern.test(containerId), 'INVALID_CONTAINER_ID');
    report.containerId = containerId;
    const identity = { containerId, imageId: options.imageId, runId };
    const endpoint = inspectOwnership(await readContainer(ownCommand, containerId), identity);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await ownCommand(['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'partner_gate_admin', '-d', 'postgres']); ready = true; break; }
      catch { await sleep(1000); }
    }
    requireCheck(ready, 'POSTGRES_START_TIMEOUT');
    inspectOwnership(await readContainer(ownCommand, containerId), identity);
    const { Client } = require('../../../backend/node_modules/pg');
    const adminUrl = `postgresql://partner_gate_admin:${password}@127.0.0.1:${endpoint.port}/postgres`;
    const preflight = new Client({ connectionString: adminUrl, ssl: false, connectionTimeoutMillis: 5000 });
    try {
      await preflight.connect();
      const observed = (await preflight.query("SELECT current_setting('server_version_num')::int AS version,current_setting('transaction_isolation') AS isolation")).rows[0];
      report.postgresMajor = Math.floor(observed.version / 10000); report.isolation = observed.isolation;
      requireCheck(report.postgresMajor === policy.postgresMajor && report.isolation === policy.isolation, 'POSTGRES_PREREQUISITES_FAILED');
    } finally { await preflight.end(); }
    env = await withDeadline(require('./environment').createEnvironment({ adminUrl, runId,
      onSetupDiagnostic: diagnostic => { report.setupDiagnostic = safeEvidence(diagnostic); }
    }), 180000, 'ENVIRONMENT_SETUP_TIMEOUT');
    report.execution = 'POSTGRESQL';
    report.repository = safeEvidence(await withDeadline(require('./repositoryProbe').runRepositoryGate(env), 180000, 'REPOSITORY_PROBE_TIMEOUT')); persist();
    report.authority = safeEvidence(await withDeadline(require('./authorityProbe').runAuthorityGate(env), 120000, 'AUTHORITY_PROBE_TIMEOUT')); persist();
    report.capacity = safeEvidence(await withDeadline(require('./capacityProbe').runCapacityGate(env, { repetitions: policy.capacity.expectedRepetitions }), 900000, 'CAPACITY_PROBE_TIMEOUT')); persist();
  } catch (error) {
    recordExecutionError(report, error); // Never echo driver messages, args, URLs or stacks.
  } finally {
    if (env) {
      try { await withDeadline(env.close(), 10000, 'ENVIRONMENT_CLOSE_TIMEOUT'); report.cleanup.environmentClosed = true; }
      catch (error) { report.cleanup.errors.push(safeCode(error, 'ENVIRONMENT_CLOSE_FAILED')); }
    }
    if (creationAttempted && !idPattern.test(containerId || '')) {
      // A lost docker-run response is ambiguous. Resolve only the unique name
      // generated here, then verify every ownership field before removal.
      try {
        const observed = await readContainer(ownCommand, name);
        inspectOwnership(observed, { containerId: observed.Id, imageId: options.imageId, runId, cleanup: true });
        containerId = observed.Id; report.containerId = containerId;
      } catch (error) { report.cleanup.errors.push(safeCode(error, 'CONTAINER_CREATION_UNCERTAIN')); }
    }
    if (containerId && idPattern.test(containerId)) {
      try {
        inspectOwnership(await readContainer(ownCommand, containerId), { containerId, imageId: options.imageId, runId, cleanup: true });
        await ownCommand(['rm', '--force', '--volumes', containerId]);
        const residual = await ownCommand(['container', 'ls', '--all', '--no-trunc', '--filter', `id=${containerId}`, '--format', '{{.ID}}']);
        requireCheck(residual === '', 'CONTAINER_REMAINS');
        report.cleanup.containerRemoved = true;
      } catch (error) { report.cleanup.errors.push(safeCode(error, 'CONTAINER_CLEANUP_FAILED')); }
    }
    report.finishedAt = new Date().toISOString(); report.verdict = evaluateGate(report); persist();
  }
  return { report: path.relative(root, path.join(output, 'evidence.json')).replaceAll('\\', '/'), ...report.verdict };
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.mode === 'plan') return describePlan();
  if (options.mode === 'execute') return executeGate(options);
  const report = JSON.parse(fs.readFileSync(options.file, 'utf8'));
  safeEvidence(report);
  const sourceBytes = fs.readFileSync(path.join(path.dirname(options.file), 'sources.json'));
  requireCheck(createHash('sha256').update(sourceBytes).digest('hex') === report.sourceManifestHash, 'SOURCE_MANIFEST_HASH_MISMATCH');
  verifySourceManifest(JSON.parse(sourceBytes), collectSourceHashes());
  return evaluateGate(report);
}
if (require.main === module) main().then(result => {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.status !== 'PASS' && !result.executionRequirements) process.exitCode = 1;
}).catch(error => { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; });
module.exports = { parseArgs, describePlan, inspectOwnership, safeEvidence, verifySourceManifest, collectSourceHashes, evaluateGate, executeGate, main, localDockerEndpoint, withDeadline, unsafeInheritedEnvironment, recordExecutionError };
