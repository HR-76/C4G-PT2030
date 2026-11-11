'use strict';

// Guard for integration tests that TRUNCATE, DROP or create tables. The refusal is deliberately
// generic: it never echoes the URL, host, database name or credentials.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const DEFAULT_PORTS = new Set(['5432', '5433']);
const SYNTHETIC_NAME = /^[a-z0-9]+_synthetic_[a-z0-9_]*[a-z0-9]$/;

function refuse() {
  const error = new Error('A disposable local database target is required: loopback host, a non-default port and a <gate>_synthetic_<name> database.');
  error.code = 'DISPOSABLE_TARGET_REQUIRED';
  return error;
}

// options.prefix / options.exact narrow the accepted database name for a specific gate.
function assertDisposableTarget(connectionString, { prefix = '', exact = null } = {}) {
  let target;
  try { target = new URL(connectionString); } catch { throw refuse(); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw refuse();
  if (!LOOPBACK.has(target.hostname)) throw refuse();
  if (!target.port || DEFAULT_PORTS.has(target.port)) throw refuse();
  const database = decodeURIComponent(target.pathname.slice(1));
  if (!SYNTHETIC_NAME.test(database)) throw refuse();
  if (!database.startsWith(prefix) || (exact !== null && database !== exact)) throw refuse();
  return target;
}

module.exports = Object.freeze({ assertDisposableTarget });
