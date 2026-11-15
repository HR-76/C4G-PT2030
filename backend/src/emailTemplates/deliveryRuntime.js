'use strict';

function configuredDeliveryHistory({ env, pool, keycloak, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  const mode = env.EMAIL_HISTORY_RUNTIME || 'disabled';
  if (mode === 'disabled') return null;
  if (mode !== 'central-keycloak-v1' || !keycloak) throw new TypeError('Email history configuration is invalid.');
  const history = require('./deliveryHistory').createDeliveryHistory({ pool, keycloak });
  let timer = null, pending = null, failure = false, closed = false;
  async function sweep() {
    if (pending) return pending;
    pending = history.retention({central:!pool.productionCapability}).then(() => { failure = false; }).catch(() => { failure = true; })
      .finally(() => { pending = null; });
    return pending;
  }
  return Object.freeze({
    ...history,
    async list(input, request) {
      const result = await history.list(input, request);
      return { ...result, retentionHealthy: failure ? false : pool.productionCapability ? null : true };
    },
    async ready() {
      if (closed) throw new Error('EMAIL_HISTORY_CLOSED');
      await sweep();
      if (failure) throw Object.assign(new Error('EMAIL_HISTORY_UNAVAILABLE'), { code: 'EMAIL_HISTORY_UNAVAILABLE' });
      if (!timer) {
        timer = setIntervalImpl(() => { void sweep(); }, 60000);
        timer.unref?.();
      }
    },
    async close() {
      closed = true;
      if (timer) clearIntervalImpl(timer);
      timer = null;
      await pending;
    }
  });
}

module.exports = { configuredDeliveryHistory };
