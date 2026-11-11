'use strict';

const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILE = path.join(ROOT, '.tmp', 'local-platform', 'runtime.json');
const HEALTH_URL = 'http://localhost:3000/api/local-health';
const MINIMUM_NODE_VERSION = Object.freeze([24, 5, 0]);
const IDENTITY_PROJECT = 'c4g-f2-integration';
const IDENTITY_SERVICES = Object.freeze(['keycloak', 'proxy']);

class LocalStartupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalStartupError';
    this.code = code;
  }
}

function nodeVersionSupported(version = process.versions.node) {
  const parts = String(version).split('.').map(value => Number.parseInt(value, 10));
  if (parts.length < 2 || parts.some(Number.isNaN)) return false;
  for (let index = 0; index < MINIMUM_NODE_VERSION.length; index += 1) {
    const value = parts[index] || 0;
    if (value > MINIMUM_NODE_VERSION[index]) return true;
    if (value < MINIMUM_NODE_VERSION[index]) return false;
  }
  return true;
}

function validateRuntimeState(state) {
  if (!state || state.phase !== 'READY' || !state.installationId || !state.target || !state.identity) {
    throw new LocalStartupError(
      'LOCAL_DEV_SETUP_REQUIRED',
      'O ambiente local não está preparado. Execute "npm run setup:local" na raiz.'
    );
  }
  return state;
}

function readRuntimeState(filename = RUNTIME_FILE) {
  if (!fs.existsSync(filename)) return validateRuntimeState(null);
  try {
    return validateRuntimeState(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch (error) {
    if (error instanceof LocalStartupError) throw error;
    throw new LocalStartupError(
      'LOCAL_DEV_STATE_INVALID',
      'O estado privado local é inválido. Reveja .tmp/local-platform/runtime.json antes de continuar.'
    );
  }
}

function requiredDependencyFiles(root = ROOT) {
  return [
    path.join(root, 'backend', 'node_modules', 'nodemon', 'bin', 'nodemon.js'),
    path.join(root, 'backend', 'node_modules', 'pg', 'package.json'),
    path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(root, 'frontend', 'node_modules', 'react', 'package.json')
  ];
}

function assertLocalPrerequisites({ root = ROOT, nodeVersion = process.versions.node } = {}) {
  if (!nodeVersionSupported(nodeVersion)) {
    throw new LocalStartupError(
      'LOCAL_DEV_NODE_UNSUPPORTED',
      `Node ${nodeVersion} não é suportado. Instale Node 24.5.0 ou posterior.`
    );
  }
  const missing = requiredDependencyFiles(root).filter(filename => !fs.existsSync(filename));
  if (missing.length) {
    throw new LocalStartupError(
      'LOCAL_DEV_DEPENDENCIES_MISSING',
      'Faltam dependências npm. Execute "npm install" em backend e frontend.'
    );
  }
}

function buildServices(state, root = ROOT) {
  const services = [{
    name: 'api',
    cwd: path.join(root, 'backend'),
    command: process.execPath,
    args: [path.join(root, 'backend', 'node_modules', 'nodemon', 'bin', 'nodemon.js'), '--exitcrash', state.catalogRead?.mode === 'controlled' ? 'scripts/startCatalogControlled.js' : 'scripts/startDev.js']
  }];
  if (state.funding && state.catalogRead?.mode !== 'controlled') {
    services.push({
      name: 'worker',
      cwd: path.join(root, 'backend'),
      command: process.execPath,
      args: ['scripts/localPlatform/worker.js']
    });
  }
  services.push({
    name: 'web',
    cwd: path.join(root, 'frontend'),
    command: process.execPath,
    args: [path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js')]
  });
  return services;
}

function canConnect(port, host = 'localhost', timeoutMs = 1000) {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host });
    const finish = reachable => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function readHealth(fetchImpl = globalThis.fetch, timeoutMs = 1500, signal) {
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(HEALTH_URL, {
      signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

function isReadyHealth(health) {
  return Boolean(health && health.status === 200 && health.body?.ready === true
    && health.body.environment === 'C4G local');
}

function readLocalIdentityCertificate(root = ROOT) {
  try {
    const { parse } = require('../backend/node_modules/dotenv');
    const settings = parse(fs.readFileSync(path.join(root, '.tmp', 'f2-integration', '.env')));
    if (!settings.NODE_EXTRA_CA_CERTS) throw new Error('missing');
    return fs.readFileSync(path.resolve(root, settings.NODE_EXTRA_CA_CERTS));
  } catch {
    throw new LocalStartupError(
      'LOCAL_DEV_IDENTITY_CA_INVALID',
      'O certificado da identidade local não está disponível. Confirme NODE_EXTRA_CA_CERTS no perfil privado indicado em LOCAL.md.'
    );
  }
}

function fetchLocalIdentity(url, {
  signal,
  root = ROOT,
  readCertificate = readLocalIdentityCertificate,
  requestImpl = https.get
} = {}) {
  const ca = readCertificate(root);
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, { ca, rejectUnauthorized: true, signal }, response => {
      response.once('error', reject);
      if (response.statusCode !== 200) {
        response.resume();
        resolve({ ok: false });
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          response.destroy();
          reject(new Error('LOCAL_IDENTITY_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('end', () => resolve({
        ok: true,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    request.once('error', reject);
  });
}

async function isLocalIdentityReady(issuer, {
  connect = canConnect,
  fetchImpl = fetchLocalIdentity,
  timeoutMs = 1500
} = {}) {
  try {
    const expected = new URL(issuer);
    if (expected.protocol !== 'https:' || expected.hostname !== 'localhost' || expected.port !== '8443'
      || expected.username || expected.password || expected.search || expected.hash
      || !/^\/realms\/[a-z0-9-]+\/?$/.test(expected.pathname)) return false;
    if (!await connect(8443, 'localhost')) return false;
    const discovery = new URL(`${expected.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`, expected.origin);
    const response = await fetchImpl(discovery, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const metadata = await response.json();
    return metadata?.issuer === issuer && typeof metadata.authorization_endpoint === 'string';
  } catch (error) {
    if (error instanceof LocalStartupError && error.code === 'LOCAL_DEV_IDENTITY_CA_INVALID') throw error;
    return false;
  }
}

function identityRecoveryProfile(root, issuer, runDocker) {
  const inspected = runDocker(['inspect', 'c4g-f2-integration-proxy-1', '--format', '{{json .Mounts}}']);
  if (inspected.error || inspected.status !== 0) {
    throw new LocalStartupError('LOCAL_DEV_IDENTITY_START_FAILED',
      'Não foi possível consultar o proxy local existente. Abra o Docker Desktop e confirme os contentores c4g-f2-integration.');
  }
  const unknownProfile = () => new LocalStartupError('LOCAL_DEV_IDENTITY_PROFILE_UNKNOWN',
    'O proxy local não usa um perfil de identidade reconhecido. Reveja o encaminhamento indicado em LOCAL.md.');
  let mounts;
  try { mounts = JSON.parse(inspected.stdout); } catch { throw unknownProfile(); }
  if (!Array.isArray(mounts)) throw unknownProfile();
  const configs = mounts.filter(mount => mount?.Type === 'bind' && mount.Destination === '/etc/nginx/conf.d/default.conf');
  if (configs.length !== 1 || typeof configs[0].Source !== 'string') throw unknownProfile();
  const normalized = filename => {
    const resolved = path.resolve(filename);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const mounted = normalized(configs[0].Source);
  const standard = path.join(root, 'test', 'integration', 'f2', 'nginx.conf');
  const native = path.join(root, '.tmp', 'f2-integration', 'demo-nginx.conf');
  if (mounted === normalized(standard)) return 'keycloak';
  if (mounted !== normalized(native)) throw unknownProfile();
  let configuration;
  try { configuration = fs.readFileSync(native, 'utf8').replace(/#.*$/gm, ''); } catch { throw unknownProfile(); }
  const routes = [
    /location\s*=\s*\/realms\/c4g-native-local\s*\{([^{}]*)\}/,
    /location\s+\^~\s+\/realms\/c4g-native-local\/\s*\{([^{}]*)\}/
  ];
  if (!routes.every(pattern => {
    const body = configuration.match(pattern)?.[1];
    return body && /\bset\s+\$native_email_backend\s+http:\/\/native-email-idp:8080\s*;/.test(body)
      && /\bproxy_pass\s+\$native_email_backend\s*;/.test(body);
  })) throw unknownProfile();
  return new URL(issuer).pathname.replace(/\/$/, '') === '/realms/c4g-native-local' ? 'native-email' : 'keycloak';
}

async function ensureLocalIdentity({
  root = ROOT,
  issuer,
  connect = canConnect,
  fetchImpl = (url, options) => fetchLocalIdentity(url, { ...options, root }),
  spawnSyncImpl = spawnSync,
  timeoutMs = 60000,
  databaseTimeoutMs = 30000,
  intervalMs = 500,
  log = console.log
} = {}) {
  const ready = () => isLocalIdentityReady(issuer, { connect, fetchImpl });
  if (await ready()) return { started: false };

  const composeFile = path.join(root, 'test', 'integration', 'f2', 'compose.yaml');
  const envFile = path.join(root, '.tmp', 'f2-integration', '.env');
  if (!fs.existsSync(composeFile) || !fs.existsSync(envFile)) {
    throw new LocalStartupError(
      'LOCAL_DEV_IDENTITY_NOT_PREPARED',
      'O Keycloak local existente não está preparado. Confirme test/integration/f2/compose.yaml e .tmp/f2-integration/.env.'
    );
  }

  const runDocker = args => spawnSyncImpl('docker', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000, maxBuffer: 128 * 1024, windowsHide: true
  });
  const assertStarted = result => {
    if (result.error || result.status !== 0) {
      throw new LocalStartupError('LOCAL_DEV_IDENTITY_START_FAILED',
        'Não foi possível iniciar a identidade local. Abra o Docker Desktop e confirme os contentores existentes indicados em LOCAL.md.');
    }
  };
  const profile = identityRecoveryProfile(root, issuer, runDocker);
  log('Identidade local indisponível; a iniciar ou retomar os contentores existentes...');
  if (profile === 'native-email') {
    assertStarted(runDocker(['start', 'c4g-native-email-pg']));
    const databaseDeadline = Date.now() + databaseTimeoutMs;
    let databaseReady = false;
    do {
      const probe = runDocker(['exec', 'c4g-native-email-pg', 'pg_isready', '-q']);
      if (!probe.error && probe.status === 0) { databaseReady = true; break; }
      await delay(intervalMs);
    } while (Date.now() < databaseDeadline);
    if (!databaseReady) throw new LocalStartupError('LOCAL_DEV_IDENTITY_DATABASE_TIMEOUT',
      'A base da identidade local não ficou disponível. Confirme o contentor c4g-native-email-pg no Docker Desktop.');
    assertStarted(runDocker(['start', 'c4g-native-email-idp']));
  }
  assertStarted(runDocker([
    'compose',
    '--project-name', IDENTITY_PROJECT,
    '--env-file', envFile,
    '-f', composeFile,
    'start',
    ...IDENTITY_SERVICES
  ]));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready()) {
      log('Keycloak local disponível em https://localhost:8443.');
      return { started: true };
    }
    await delay(intervalMs);
  }
  throw new LocalStartupError(
    'LOCAL_DEV_IDENTITY_TIMEOUT',
    'O Keycloak local foi iniciado, mas não ficou disponível em https://localhost:8443 dentro de 60 segundos.'
  );
}

async function assertExternalServices(state, connect = canConnect, ensureIdentity = ensureLocalIdentity) {
  if (!await connect(5432, 'localhost')) {
    throw new LocalStartupError(
      'LOCAL_DEV_SERVICE_UNAVAILABLE',
      'Pré-requisito indisponível: PostgreSQL (localhost:5432).'
    );
  }
  await ensureIdentity({ connect, issuer: state.identity.issuer });
}

async function assertApplicationPortsFree(state, connect = canConnect) {
  const ports = [3000, 5000];
  if (state.memberAccess || state.admissionAccess) ports.push(5285);
  const occupied = [];
  for (const port of ports) {
    if (await connect(port, 'localhost')) occupied.push(port);
  }
  if (occupied.length) {
    throw new LocalStartupError(
      'LOCAL_DEV_PORT_IN_USE',
      `Porta ocupada: ${occupied.join(', ')}. Pare o processo anterior e repita o arranque.`
    );
  }
}

function prefixOutput(stream, service, destination) {
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', line => destination.write(`[${service}] ${line}\n`));
  return lines;
}

async function terminateProcessTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

class ServiceSupervisor {
  constructor(services, { spawnImpl = spawn, terminateImpl = terminateProcessTree } = {}) {
    this.services = services;
    this.spawnImpl = spawnImpl;
    this.terminateImpl = terminateImpl;
    this.children = [];
    this.stopping = false;
    this.failure = new Promise(resolve => { this.reportFailure = resolve; });
  }

  start() {
    for (const service of this.services) {
      const child = this.spawnImpl(service.command, service.args, {
        cwd: service.cwd,
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true
      });
      this.children.push({ service, child });
      if (child.stdout) prefixOutput(child.stdout, service.name, process.stdout);
      if (child.stderr) prefixOutput(child.stderr, service.name, process.stderr);
      child.once('error', error => {
        if (!this.stopping) this.reportFailure({
          type: 'failure',
          error: new Error(`${service.name} não arrancou: ${error.message}`)
        });
      });
      child.once('exit', (code, signal) => {
        if (!this.stopping) this.reportFailure({
          type: 'failure',
          error: new Error(`${service.name} terminou inesperadamente (${signal || `código ${code}`}).`)
        });
      });
    }
  }

  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    const running = this.children.filter(({ child }) => child.exitCode === null && child.signalCode === null);
    await Promise.all(running.map(({ child }) => this.terminateImpl(child)));
    await Promise.all(this.children.map(({ child }) => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    })));
  }
}

async function waitForReady({
  connect = canConnect, fetchImpl = globalThis.fetch, timeoutMs = 60000, intervalMs = 500, signal
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let apiReachable = false;
  let lastHealth = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { type: 'cancelled' };
    apiReachable ||= await connect(5000);
    if (apiReachable) {
      if (signal?.aborted) return { type: 'cancelled' };
      lastHealth = await readHealth(fetchImpl, 1500, signal);
      if (signal?.aborted) return { type: 'cancelled' };
      if (isReadyHealth(lastHealth)) return { type: 'ready', health: lastHealth.body };
    }
    try {
      await delay(intervalMs, undefined, signal ? { signal } : undefined);
    } catch (error) {
      if (error.name === 'AbortError') return { type: 'cancelled' };
      throw error;
    }
  }
  const detail = lastHealth?.body
    ? ` Estado: worker=${Boolean(lastHealth.body.workerReady)}, admission=${Boolean(lastHealth.body.admissionReady)}.`
    : '';
  throw new LocalStartupError(
    'LOCAL_DEV_READINESS_TIMEOUT',
    `A aplicação não ficou pronta em 60 segundos.${detail}`
  );
}

function stopRequest() {
  let resolveRequest;
  const promise = new Promise(resolve => { resolveRequest = resolve; });
  const onSignal = signal => resolveRequest({ type: 'signal', signal });
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return {
    promise,
    dispose() {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  };
}

async function main() {
  const state = readRuntimeState();
  assertLocalPrerequisites();

  const existing = await readHealth();
  if (isReadyHealth(existing)) {
    console.log(`C4G já está disponível em ${HEALTH_URL.replace('/api/local-health', '')}`);
    return;
  }

  await assertApplicationPortsFree(state);
  await assertExternalServices(state);

  const services = buildServices(state);
  const supervisor = new ServiceSupervisor(services);
  const requestedStop = stopRequest();
  let failed = false;
  try {
    console.log(`A iniciar C4G local: ${services.map(service => service.name).join(', ')}...`);
    supervisor.start();
    const readinessAbort = new AbortController();
    let startup;
    try {
      startup = await Promise.race([
        waitForReady({ signal: readinessAbort.signal }),
        supervisor.failure,
        requestedStop.promise
      ]);
    } finally {
      readinessAbort.abort();
    }
    if (startup.type === 'failure') throw startup.error;
    if (startup.type === 'signal') return;
    console.log('C4G pronta em http://localhost:3000 — Ctrl+C para encerrar.');
    const outcome = await Promise.race([supervisor.failure, requestedStop.promise]);
    if (outcome.type === 'failure') throw outcome.error;
  } catch (error) {
    failed = true;
    const code = error.code || 'LOCAL_DEV_START_FAILED';
    console.error(`${code}: ${error.message}`);
  } finally {
    requestedStop.dispose();
    console.log('A encerrar os serviços locais...');
    await supervisor.stop();
    if (failed) process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(error => {
    const code = error.code || 'LOCAL_DEV_START_FAILED';
    console.error(`${code}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  LocalStartupError,
  ServiceSupervisor,
  assertApplicationPortsFree,
  assertExternalServices,
  assertLocalPrerequisites,
  buildServices,
  ensureLocalIdentity,
  fetchLocalIdentity,
  isLocalIdentityReady,
  isReadyHealth,
  nodeVersionSupported,
  readRuntimeState,
  terminateProcessTree,
  waitForReady
};
