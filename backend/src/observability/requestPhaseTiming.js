'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');

// Opt-in diagnostic (context/features/request-phase-timing.md): one stdout line
// per request with the time and count of each authority and session phase the
// coordinator already measures. It carries no identifier and no request data,
// changes no response, and a failure here never reaches the request.
const PHASES = new Set([
  ...['authority', 'sessionRead'].flatMap(category => ['pool', 'admission', 'lock', 'verify'].map(phase => `${category}.${phase}`)),
  'authority.setup', 'authority.work', 'authority.commit',
  // Schema admission reuse: signature reads, and the full verifications that still ran.
  'authority.signature', 'authority.preflight', 'tenant.signature',
  'touch.get', 'touch.validate', 'touch.set', 'touch.total', 'touch.joined',
  // Tenant phases overlap (resolve and transaction contain the others, and
  // revalidate/guard contain authority transactions): read them, do not add them.
  'tenant.resolve', 'tenant.acquire', 'tenant.metadata', 'tenant.verify', 'tenant.revalidate',
  'tenant.transaction', 'tenant.work', 'tenant.guard', 'tenant.commit',
  // Central catalogue reads (count of catalog.list = pages read) and the steps of a matching.
  'catalog.list', 'catalog.query', 'catalog.programmes', 'matching.central', 'matching.private', 'matching.match'
]);
const round = value => Math.round(value * 10) / 10;

// Any segment that is not a short lowercase word is a variable: identifiers,
// versions and names never reach the log. The query string is dropped.
function routeTemplate(url) {
  const path = String(url || '/').split('?', 1)[0];
  return path.split('/').map(segment => !segment || /^[a-z][a-z-]{0,39}$/.test(segment) ? segment : ':id').join('/') || '/';
}

function createRequestPhaseTiming({ write = line => { process.stdout.write(line + '\n'); }, now = () => performance.now(), clock = () => new Date() } = {}) {
  const requests = new AsyncLocalStorage();
  // Outside a request (startup, internal tasks) there is nothing to attribute.
  function observe(name, ms) {
    const phases = requests.getStore();
    if (!phases || !PHASES.has(name) || !Number.isFinite(ms) || ms < 0) return;
    const phase = phases.get(name) || { count: 0, ms: 0 };
    phase.count++; phase.ms += ms;
    phases.set(name, phase);
  }
  function middleware(req, res, next) {
    const phases = new Map(), start = now();
    let written = false;
    const finish = aborted => {
      if (written) return;
      written = true;
      try {
        write(JSON.stringify({
          // The browser gave up before the response ended; the phases are partial.
          ...(aborted ? { aborted: true } : {}),
          signalCode: 'c4g.api.request_phases', timestamp: clock().toISOString(), method: String(req.method || ''),
          route: routeTemplate(req.originalUrl), status: res.statusCode, totalMs: round(now() - start),
          phases: Object.fromEntries([...phases].map(([name, phase]) => [name, { count: phase.count, ms: round(phase.ms) }]))
        }));
      } catch { /* diagnostic only */ }
    };
    // 'finish' follows the session touch; 'close' covers an aborted response.
    res.once('finish', () => finish(false)); res.once('close', () => finish(res.writableFinished === false));
    requests.run(phases, next);
  }
  return Object.freeze({ observe, middleware });
}

// The one instance of this process, so code far from the composition (tenant
// resolution and execution) can time a step without new dependencies. With the
// diagnostic off, measurePhase calls the work and nothing else.
let active = null;
function setActiveRequestPhaseTiming(timing) { const previous = active; active = timing || null; return previous; }
function measurePhase(name, work) {
  const timing = active;
  if (!timing) return work();
  const start = performance.now(), done = () => timing.observe(name, performance.now() - start);
  let result;
  try { result = work(); } catch (error) { done(); throw error; }
  if (!result || typeof result.then !== 'function') { done(); return result; }
  return result.then(value => { done(); return value; }, error => { done(); throw error; });
}

function configuredRequestPhaseTiming(env = process.env) {
  const mode = env.REQUEST_PHASE_TIMING;
  if (mode === undefined || mode === '' || mode === 'off') return null;
  if (mode !== 'log') throw new TypeError('REQUEST_PHASE_TIMING must be "log" or "off".');
  const timing = createRequestPhaseTiming();
  setActiveRequestPhaseTiming(timing);
  return timing;
}

module.exports = { createRequestPhaseTiming, configuredRequestPhaseTiming, setActiveRequestPhaseTiming, measurePhase, routeTemplate, PHASES };
