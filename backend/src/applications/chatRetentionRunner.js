'use strict';
// One-shot executor for the daily chat retention. Environment adapters supply the tenant list and the
// pool factory (local profile today, VPS provisioning later); this module owns batching and failure isolation.
const { createChatRetentionService } = require('./chatRetention');

const DEFAULT_MAX_BATCHES = 200;

async function runChatRetention({ listTenants, openTenant, retentionDays = 90, batchSize = 50, maxBatches = DEFAULT_MAX_BATCHES, log = () => {} }) {
  if (typeof listTenants !== 'function' || typeof openTenant !== 'function') throw new TypeError('Chat retention runner requires tenant adapters.');
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10000) throw new TypeError('Chat retention batch cap is invalid.');
  const summary = { tenants: 0, applications: 0, messages: 0, failures: 0, incomplete: 0 };
  for (const tenant of await listTenants()) {
    let handle;
    try {
      handle = await openTenant(tenant);
      const service = createChatRetentionService({ pool: handle.pool, organizationId: tenant.organizationId, retentionDays, batchSize });
      let applications = 0;
      let messages = 0;
      let more = true;
      let batches = 0;
      while (more && batches < maxBatches) {
        const result = await service.runOnce();
        applications += result.applications;
        messages += result.messages;
        more = result.more;
        batches += 1;
      }
      if (more) summary.incomplete += 1;
      summary.tenants += 1;
      summary.applications += applications;
      summary.messages += messages;
      // Counts only: chat text never reaches logs.
      log({ event: 'CHAT_RETENTION_TENANT_DONE', organizationId: tenant.organizationId, applications, messages, batches, incomplete: more });
    } catch (error) {
      summary.failures += 1;
      log({ event: 'CHAT_RETENTION_TENANT_FAILED', organizationId: tenant?.organizationId ?? null, code: error?.code || 'UNKNOWN' });
    } finally {
      try { await handle?.close?.(); } catch { /* closing must not hide the tenant outcome */ }
    }
  }
  log({ event: 'CHAT_RETENTION_RUN_DONE', ...summary });
  return Object.freeze(summary);
}

module.exports = { DEFAULT_MAX_BATCHES, runChatRetention };
