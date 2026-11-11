'use strict';

// pg emits 'error' on the pool when an idle client fails (server restart,
// provider closing idle connections). Without a listener Node raises it as an
// uncaught exception and the process exits. The pool already discards the
// broken client, so the only work here is to report it without details: the
// driver message can carry connection data.
const guarded = new WeakSet();
const NAME = /^[A-Za-z0-9_.-]{1,48}$/;
const CODE = /^[A-Z0-9_]{1,40}$/;
const MAX_TIMEOUT_MS = 3600000;
const DEFAULT_TIMEOUTS = Object.freeze({ statementMs: 30000, idleInTransactionMs: 60000 });

function guardPool(pool, name, { write = line => process.stderr.write(line) } = {}) {
  if (!NAME.test(String(name))) throw new TypeError('Pool name is invalid.');
  if (!pool || typeof pool.on !== 'function' || guarded.has(pool)) return pool;
  guarded.add(pool);
  pool.on('error', error => {
    const code = CODE.test(String(error?.code || '')) ? error.code : 'UNKNOWN';
    try { write(`C4G_DB_POOL_IDLE_ERROR pool=${name} code=${code}\n`); } catch { /* Reporting must not raise. */ }
  });
  return pool;
}

function timeout(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMEOUT_MS) {
    throw new TypeError(`${name} must be an integer between 0 and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

// Server-side backstops for API pools; 0 disables one. Code that sets a
// tighter SET LOCAL value inside its own transaction keeps that value.
function runtimePoolTimeouts(env, prefix) {
  const statement = timeout(env, `${prefix}_STATEMENT_TIMEOUT_MS`, DEFAULT_TIMEOUTS.statementMs);
  const idle = timeout(env, `${prefix}_IDLE_IN_TRANSACTION_TIMEOUT_MS`, DEFAULT_TIMEOUTS.idleInTransactionMs);
  return { ...(statement ? { statement_timeout: statement } : {}), ...(idle ? { idle_in_transaction_session_timeout: idle } : {}) };
}

module.exports = { DEFAULT_TIMEOUTS, guardPool, runtimePoolTimeouts };
