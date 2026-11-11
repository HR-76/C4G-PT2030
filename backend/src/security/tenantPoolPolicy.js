'use strict';

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} is invalid.`);
  return value;
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new TypeError('Tenant pool policy is required.');
  const copy = Object.freeze({
    globalLimit: integer(policy.globalLimit, 'globalLimit', 1),
    perTenantLimit: integer(policy.perTenantLimit, 'perTenantLimit', 1),
    operationalReserve: integer(policy.operationalReserve, 'operationalReserve'),
    globalQueueLimit: integer(policy.globalQueueLimit, 'globalQueueLimit', 1),
    perTenantQueueLimit: integer(policy.perTenantQueueLimit, 'perTenantQueueLimit', 1),
    operationalQueueReserve: integer(policy.operationalQueueReserve, 'operationalQueueReserve'),
    acquireTimeoutMs: integer(policy.acquireTimeoutMs, 'acquireTimeoutMs', 1),
    leaseTimeoutMs: integer(policy.leaseTimeoutMs, 'leaseTimeoutMs', 1),
    idleTimeoutMs: integer(policy.idleTimeoutMs, 'idleTimeoutMs', 1),
    drainTimeoutMs: integer(policy.drainTimeoutMs, 'drainTimeoutMs', 1),
    circuitFailureThreshold: integer(policy.circuitFailureThreshold, 'circuitFailureThreshold', 1),
    circuitResetMs: integer(policy.circuitResetMs, 'circuitResetMs', 1),
    backoffBaseMs: integer(policy.backoffBaseMs, 'backoffBaseMs', 1),
    maxBackoffMs: integer(policy.maxBackoffMs, 'maxBackoffMs', 1)
  });
  if (copy.operationalReserve >= copy.globalLimit || copy.perTenantLimit > copy.globalLimit
      || copy.operationalQueueReserve >= copy.globalQueueLimit
      || copy.perTenantQueueLimit > copy.globalQueueLimit
      || copy.backoffBaseMs > copy.maxBackoffMs) throw new TypeError('Tenant pool policy limits are inconsistent.');
  return copy;
}

module.exports = { validatePolicy };
