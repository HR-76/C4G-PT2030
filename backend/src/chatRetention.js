'use strict';
// Entrypoint of the daily chat retention (one-shot; launched by the system scheduler, e.g. a systemd timer).
// Exit code: 0 done, 1 failures, unfinished work or invalid configuration.
const line = entry => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

async function main({ env = process.env, log = line, infrastructureFactory = null } = {}) {
  const { createChatRetentionInfrastructure } = require('./config/chatRetentionInfrastructure');
  const { runChatRetention } = require('./applications/chatRetentionRunner');
  const infrastructure = await (infrastructureFactory || createChatRetentionInfrastructure)({ env });
  try {
    const summary = await runChatRetention({ listTenants: infrastructure.listTenants, openTenant: infrastructure.openTenant,
      retentionDays: infrastructure.retentionDays, batchSize: infrastructure.batchSize, maxBatches: infrastructure.maxBatches, log });
    return summary.failures > 0 || summary.incomplete > 0 ? 1 : 0;
  } finally { await infrastructure.close(); }
}

module.exports = { main };
if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => {
    // Codes only: configuration and driver messages can carry connection data.
    line({ event: 'CHAT_RETENTION_RUN_FAILED', code: /^[A-Z0-9_]{1,60}$/.test(String(error?.code || '')) ? error.code : 'UNKNOWN' });
    process.exitCode = 1;
  });
}
