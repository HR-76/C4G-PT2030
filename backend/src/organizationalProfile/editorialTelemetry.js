'use strict';
const OPERATIONS = new Set(['profile.editorial.submit','profile.editorial.approve','profile.editorial.publish','profile.editorial.read']);
function createEditorialTelemetry({ metrics, clock = () => Date.now() }) {
  return Object.freeze({ async observe(operation, work) {
    if (!OPERATIONS.has(operation) || typeof work !== 'function') throw new TypeError('Invalid editorial observation.');
    const start = clock(); let resultClass = 'success';
    try { return await work(); } catch (error) {
      resultClass = ['F13_AUTHORIZATION_REQUIRED','F13_RESOURCE_NOT_AVAILABLE'].includes(error.code) ? 'denied'
        : ['F13_INVALID_INPUT','F13_UNKNOWN_FIELD'].includes(error.code) ? 'invalid'
          : ['F13_STALE_REVISION','F13_STATE_CONFLICT','F13_IDEMPOTENCY_CONFLICT','F13_COMPLETION_INCOMPLETE','F13_APPROVAL_STALE'].includes(error.code) ? 'conflict' : 'unavailable';
      throw error;
    } finally {
      try { metrics.record('c4g.profile_editorial.operation', 1, { operation, resultClass });
        metrics.record('c4g.profile_editorial.duration', Math.max(0, clock() - start) / 1000, { operation, resultClass }); } catch {}
    }
  } });
}
module.exports = { createEditorialTelemetry };
