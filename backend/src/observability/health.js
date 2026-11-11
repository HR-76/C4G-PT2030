'use strict';
const { HEALTH_STATES } = require('./catalogs');

class HealthRegistry {
  constructor({ clock = () => Date.now(), timeoutMs = 2000, cacheMs = 5000, staleMs = 10000, concurrency = 4 } = {}) {
    Object.assign(this, { clock, timeoutMs, cacheMs, staleMs, concurrency });
    this.probes = new Map();
    this.cache = new Map();
    this.inFlight = new Map();
  }

  register(def) {
    if (!def || !/^[a-z][a-z0-9_.-]+$/.test(def.code) || this.probes.has(def.code)
        || !['REQUIRED', 'DEGRADABLE', 'DISABLED', 'FUTURE'].includes(def.criticality)
        || typeof def.check !== 'function') throw new TypeError('Health dependency is invalid.');
    this.probes.set(def.code, Object.freeze({ ...def }));
  }

  async _run(def) {
    const cached = this.cache.get(def.code), now = this.clock();
    if (cached && now - cached.at <= this.cacheMs) return cached;
    const pending = this.inFlight.get(def.code);
    if (pending) return pending;

    const controller = new AbortController();
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        // Publish TIMEOUT before abort listeners can settle the underlying probe.
        resolve({ ok: false, reason: 'TIMEOUT' });
        controller.abort();
      }, this.timeoutMs);
    });
    const execution = Promise.resolve().then(() => def.check({ signal: controller.signal }))
      .then(value => {
        const ok = value === true || value?.ok === true;
        return { ok, reason: ok ? 'OK' : 'FAILED', ...(value?.details === undefined ? {} : { details: value.details }) };
      },
        () => ({ ok: false, reason: 'FAILED' }));
    const response = Promise.race([execution, timeout]).then(value => {
      clearTimeout(timer);
      const result = { ...value, at: now };
      this.cache.set(def.code, result);
      return result;
    });
    this.inFlight.set(def.code, response);
    // A probe may ignore cancellation. Keep its settled timeout response shared
    // until the real execution finishes, even after the normal cache expires.
    Promise.all([execution, response]).then(() => {
      if (this.inFlight.get(def.code) === response) this.inFlight.delete(def.code);
    });
    return response;
  }

  async check() {
    const entries = [...this.probes.values()];
    const results = [];
    for (let i = 0; i < entries.length; i += this.concurrency) {
      results.push(...await Promise.all(entries.slice(i, i + this.concurrency)
        .map(async def => ({ def, result: await this._run(def) }))));
    }
    let status = 'READY';
    const reasons = [];
    for (const { def, result } of results) {
      if (['DISABLED', 'FUTURE'].includes(def.criticality)) continue;
      if (!result.ok) {
        reasons.push(def.code.toUpperCase());
        status = def.criticality === 'REQUIRED' ? 'UNAVAILABLE' : status === 'READY' ? 'DEGRADED' : status;
      }
    }
    if (!HEALTH_STATES.includes(status)) throw new Error('Invalid health state.');
    return Object.freeze({ status, reasons: Object.freeze(reasons.sort()) });
  }

  live() { return Object.freeze({ status: 'LIVE', schemaVersion: 1 }); }

  async checkDependency(code) {
    const probe = this.probes.get(code);
    return probe ? this._run(probe) : null;
  }
}

module.exports = { HealthRegistry };
