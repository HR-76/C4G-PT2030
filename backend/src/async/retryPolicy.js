const { DEFAULTS } = require('./constants');
function nextRetry({ outcome, attempt, nowMs, deadlineMs, random = Math.random }) {
  if (outcome !== 'RETRYABLE' || !Number.isInteger(attempt) || attempt >= DEFAULTS.maxAttempts || nowMs >= deadlineMs) return null;
  const ceiling = Math.min(DEFAULTS.retryCapMs, DEFAULTS.retryBaseMs * (2 ** (attempt - 1)));
  const delayMs = Math.floor(Math.max(0, Math.min(0.999999999, random())) * ceiling);
  return nowMs + delayMs < deadlineMs ? Object.freeze({ delayMs, runAtMs: nowMs + delayMs }) : null;
}
module.exports = { nextRetry };
