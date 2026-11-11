'use strict';
// Daily scheduled collection, run inside the funding worker (it already builds the repository with every
// capability flag the API uses). One request per source per Lisbon day: the request id is derived from the
// day and source, so a restart, a second worker or a manual retry is the same request, never a second run.
// The request is made as a dedicated service account (an active C4G_ADMIN without any interactive login).
const crypto = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_NAME = /^[A-Z][A-Z0-9_]{1,40}$/;
const DEFAULT_AT = '04:00';
const TIME_ZONE = 'Europe/Lisbon';
// Intentional or transient states of the source: skip today without raising an alarm.
const SKIPPED_TODAY = Object.freeze(['OPPORTUNITY_V2_EU_SUSPENDED', 'OPPORTUNITY_V2_SOURCE_FENCE_STALE', 'FUNDING_EU_V2_WRITER_REQUIRED', 'FUNDING_WORKER_UPGRADE_REQUIRED']);
// Another run is active (for example a manual one): try again later today.
const RETRYABLE = Object.freeze(['FUNDING_BUSY']);
const invalid = () => Object.assign(new Error('FUNDING_SCHEDULE_CONFIGURATION_INVALID'), { code: 'FUNDING_SCHEDULE_CONFIGURATION_INVALID' });

function lisbonParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function requestIdFor(day, source) {
  const bytes = crypto.createHash('sha256').update(`c4g-funding-scheduled-refresh|${day}|${source}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function minutesOf(at) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
  if (!match) throw invalid();
  return Number(match[1]) * 60 + Number(match[2]);
}

// Off unless FUNDING_TENDERS_SCHEDULE=daily-v1; any other value, or a partial configuration, fails closed.
function loadScheduleConfiguration(env, allowedSources) {
  if (env.FUNDING_TENDERS_SCHEDULE === undefined || env.FUNDING_TENDERS_SCHEDULE === '') return null;
  if (env.FUNDING_TENDERS_SCHEDULE !== 'daily-v1') throw invalid();
  const userId = env.FUNDING_TENDERS_SCHEDULE_USER_ID;
  if (typeof userId !== 'string' || !UUID.test(userId)) throw invalid();
  const sources = (env.FUNDING_TENDERS_SCHEDULE_SOURCES ?? 'EU_FUNDING_TENDERS').split(',').map(value => value.trim());
  if (!sources.length || new Set(sources).size !== sources.length || sources.some(source => !SOURCE_NAME.test(source) || !allowedSources.includes(source))) throw invalid();
  const at = env.FUNDING_TENDERS_SCHEDULE_AT ?? DEFAULT_AT;
  minutesOf(at);
  return { userId, sources, at };
}

function createScheduledRefresh({ repository, userId, sources, at = DEFAULT_AT, clock = () => new Date(), scheduler = { setTimeout, clearTimeout },
  intervalMs = 60000, retryMs = 10 * 60 * 1000, maxAttempts = 6, log = () => {} }) {
  if (!repository || typeof repository.enqueue !== 'function' || !UUID.test(userId || '') || !Array.isArray(sources) || !sources.length) throw invalid();
  const dueMinutes = minutesOf(at);
  const state = new Map();
  let timer = null;
  let running = false;
  let closed = false;

  async function attempt(day, source, now) {
    const key = `${day}|${source}`;
    const entry = state.get(key) || { done: false, attempts: 0, nextAt: 0 };
    state.set(key, entry);
    if (entry.done || now.getTime() < entry.nextAt) return;
    entry.attempts += 1;
    try {
      const run = await repository.enqueue(userId, requestIdFor(day, source), source);
      entry.done = true;
      log({ event: 'FUNDING_REFRESH_REQUESTED', source, day, runId: run?.runId ?? null, status: run?.status ?? null });
    } catch (error) {
      const reason = /^[A-Z0-9_]{1,60}$/.test(String(error?.code || '')) ? error.code : 'UNKNOWN';
      if (SKIPPED_TODAY.includes(reason)) {
        entry.done = true;
        log({ event: 'FUNDING_REFRESH_SKIPPED', source, day, reason });
      } else if ((RETRYABLE.includes(reason) || reason === 'UNKNOWN') && entry.attempts < maxAttempts) {
        entry.nextAt = now.getTime() + retryMs;
      } else {
        // Configuration errors (for example a revoked service account) are reported once and not repeated today.
        entry.done = true;
        log({ event: 'FUNDING_REFRESH_FAILED', source, day, reason, attempts: entry.attempts });
      }
    }
  }

  async function tick() {
    if (running || closed) return;
    running = true;
    try {
      const now = clock();
      const { day, minutes } = lisbonParts(now);
      for (const key of state.keys()) if (!key.startsWith(`${day}|`)) state.delete(key);
      if (minutes < dueMinutes) return;
      for (const source of sources) await attempt(day, source, now);
    } finally { running = false; }
  }

  function schedule() {
    if (closed) return;
    timer = scheduler.setTimeout(async () => {
      timer = null;
      try { await tick(); } catch { /* a failed tick must not stop the schedule */ }
      schedule();
    }, intervalMs);
    timer?.unref?.();
  }

  return Object.freeze({
    start() { if (!timer && !closed) schedule(); },
    tick,
    async shutdown() { closed = true; if (timer) { scheduler.clearTimeout(timer); timer = null; } }
  });
}

module.exports = { DEFAULT_AT, createScheduledRefresh, loadScheduleConfiguration, requestIdFor };
