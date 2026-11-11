'use strict';

const OPERATIONS = new Set(['scope.create','scope.read','scope.rename','scope.reparent','scope.archive']);
const RESULTS = new Set(['success','denied','conflict','invalid','unavailable']);

function createOrganizationalScopeTelemetry({ metrics, tracer = null, clock = () => Date.now() }) {
  if (!metrics || typeof metrics.record !== 'function') throw new TypeError('Organizational scope metrics port is required.');
  async function observe(operation, work) {
    if (!OPERATIONS.has(operation) || typeof work !== 'function') throw new TypeError('Organizational scope telemetry input is invalid.');
    const started = clock();
    const run = async () => {
      try {
        const value = await work();
        try { metrics.record('c4g.organizational_scope.operation', 1, { operation, resultClass: 'success' });
          metrics.record('c4g.organizational_scope.duration', Math.max(0, clock() - started) / 1000, { operation, resultClass: 'success' }); } catch {}
        return value;
      } catch (error) {
        const resultClass = error?.publicCode === 'RESOURCE_NOT_AVAILABLE' ? 'denied'
          : /CONFLICT|REVISION/.test(error?.code || '') ? 'conflict' : error instanceof TypeError ? 'invalid' : 'unavailable';
        try { metrics.record('c4g.organizational_scope.operation', 1, { operation,
          resultClass: RESULTS.has(resultClass) ? resultClass : 'unavailable' }); } catch {}
        throw error;
      }
    };
    if (tracer && typeof tracer.startActiveSpan === 'function') return tracer.startActiveSpan(operation, span => Promise.resolve(run()).finally(() => span.end()));
    return run();
  }
  return Object.freeze({ observe });
}

module.exports = { OPERATIONS, RESULTS, createOrganizationalScopeTelemetry };
