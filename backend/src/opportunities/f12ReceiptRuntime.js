'use strict';

const { createF12ReceiptTenantReader } = require('./f12ReceiptTenantReader');
const { createF12ServiceReceipts } = require('./f12ServiceReceipts');

function createF12ReceiptRuntime({ central, recoveryCentral = central, tenantRuntimeDependencies }) {
  const receipts = createF12ServiceReceipts({
    central, recoveryCentral, withVerifiedTenant: createF12ReceiptTenantReader(tenantRuntimeDependencies)
  });
  async function recoverPending({ after = null, limit = 20 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('F12 recovery batch size is invalid.');
    }
    const { rows } = await recoveryCentral.query(
      `SELECT transaction_id FROM f12_service_authority.commit_guard
        WHERE state IN ('PREPARED','UNKNOWN') AND ($1::uuid IS NULL OR transaction_id > $1)
        ORDER BY transaction_id LIMIT $2`, [after, limit]);
    const results = [];
    for (const { transaction_id: nonce } of rows) {
      let state;
      try { state = await receipts.recover(nonce); }
      catch { state = 'UNAVAILABLE'; }
      results.push(Object.freeze({ nonce, state }));
    }
    return Object.freeze({
      results: Object.freeze(results), next: rows.length === limit ? rows.at(-1).transaction_id : null
    });
  }
  return Object.freeze({ ...receipts, recoverPending });
}

module.exports = { createF12ReceiptRuntime };
