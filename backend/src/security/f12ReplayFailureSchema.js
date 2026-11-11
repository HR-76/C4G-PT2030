'use strict';

const { tenantSchemaSnapshot, tenantSchemaFingerprint } = require('./tenantSchemaFingerprint');
const { f12ReceiptSchemaEvidence } = require('./f12ReceiptSchemaEvidence');

async function fingerprintReplayFailureSchema(client) {
  return tenantSchemaFingerprint({
    structure: await tenantSchemaSnapshot(client, ['f12_replay_failure']),
    security: await f12ReceiptSchemaEvidence(client, 'f12_replay_failure',
      ['c4g_f12_receipt_issuer', 'c4g_opportunity_tenant_runtime'])
  });
}

module.exports = { fingerprintReplayFailureSchema };
