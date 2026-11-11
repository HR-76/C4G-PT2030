'use strict';

// In-process fixed-window limiter keyed by client address. It bounds what one
// address can cost the API and the Central database; it is not a substitute
// for limits at the proxy, and counters are not shared between API instances.
const DEFAULTS = Object.freeze({ authPerMinute: 60, apiPerMinute: 3000 });
const WINDOW_MS = 60000;
const MAX_KEYS = 50000;

function positiveInteger(value, name, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000000) {
    throw new TypeError(`${name} must be an integer between 1 and 1000000.`);
  }
  return parsed;
}

function loadRateLimitConfig(env = {}) {
  return Object.freeze({
    authPerMinute: positiveInteger(env.RATE_LIMIT_AUTH_PER_MINUTE, 'RATE_LIMIT_AUTH_PER_MINUTE', DEFAULTS.authPerMinute),
    apiPerMinute: positiveInteger(env.RATE_LIMIT_API_PER_MINUTE, 'RATE_LIMIT_API_PER_MINUTE', DEFAULTS.apiPerMinute)
  });
}

function createRateLimiter({ limit, windowMs = WINDOW_MS, maxKeys = MAX_KEYS, now = Date.now,
  keyOf = req => req.ip || req.socket?.remoteAddress || 'unknown' }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1
    || !Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new TypeError('Rate limiter configuration is invalid.');
  const windows = new Map();
  let nextSweep = 0;
  function sweep(instant) {
    if (instant < nextSweep) return;
    for (const [key, entry] of windows) if (entry.resetAt <= instant) windows.delete(key);
    nextSweep = instant + windowMs;
  }
  return function rateLimit(req, res, next) {
    const instant = now(), key = String(keyOf(req));
    sweep(instant);
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= instant) {
      // Bounded memory: under a flood of distinct addresses the oldest window is dropped.
      if (!entry && windows.size >= maxKeys) windows.delete(windows.keys().next().value);
      entry = { count: 0, resetAt: instant + windowMs };
      windows.set(key, entry);
    }
    entry.count++;
    if (entry.count <= limit) return next();
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - instant) / 1000))));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: { code: 'RATE_LIMITED' } });
  };
}

module.exports = { DEFAULTS, createRateLimiter, loadRateLimitConfig };
