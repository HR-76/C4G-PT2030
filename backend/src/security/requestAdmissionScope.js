'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');

// Evidence that the Central schema passed its full preflight, valid only inside
// the HTTP request that collected it (context/decisions/request-scoped-central-admission.md).
// It is never shared between requests, never holds a failure and expires with
// the longest authority transaction. Without a request scope every caller
// verifies again, exactly as before.
function createRequestAdmissionScope({ now = () => performance.now(), maxAgeMs = 10000 } = {}) {
  const requests = new AsyncLocalStorage();
  const run = work => requests.run(new Map(), work);
  async function admit(key, verify) {
    const held = requests.getStore();
    if (!held) return verify();
    const evidence = held.get(key);
    if (evidence && now() - evidence.at < maxAgeMs) return evidence.value;
    // Only a completed, successful verification is kept. Concurrent first
    // admissions each verify; none waits on, or inherits, another's outcome.
    const value = await verify();
    held.set(key, { value, at: now() });
    return value;
  }
  return Object.freeze({ run, admit });
}

const scope = createRequestAdmissionScope();
// Mount after the body parsers: a stream callback would otherwise leave the scope.
const requestAdmissionMiddleware = (req, res, next) => scope.run(next);

module.exports = {
  createRequestAdmissionScope, requestAdmissionMiddleware,
  runInRequestAdmissionScope: scope.run, admitWithinRequest: scope.admit
};
