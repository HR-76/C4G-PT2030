'use strict';
// Historical read-only reconciliation. A PASS here is not an archive permit.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Pool } = require('../backend/node_modules/pg');
const cfg = require('../backend/scripts/localPlatform/config');
const { loadPackage } = require('../backend/src/opportunities/v2/euLegacyPreapproval');
const { validateReceiptExport } = require('./eu-legacy-receipts-check.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');

function receiptMatchesEvent(receipt, loaded, event) {
  const data = event?.event_data;
  return event?.event_id === receipt.eventId && event.event_hash === receipt.eventHash
    && event.actor_type === 'HUMAN' && event.actor_id === receipt.actorId
    && event.organization_id === null && event.tenant_id === null
    && event.ledger_location === 'CENTRAL' && event.stream_id === 'PLATFORM:OPERATIONS'
    && event.stream_type === 'OPERATIONS' && event.event_code === 'SENSITIVE_ACTION_ALLOWED'
    && event.audit_class === 'CRITICAL_PRE_EFFECT'
    && data?.operationCode === 'OPPORTUNITY_CENTRAL_MANAGE'
    && data?.source === 'EU_LEGACY_PREARCHIVE'
    && data?.decision === 'ACCEPT' && data?.outcome === 'SUCCESS'
    && data?.resource?.type === 'EU_LEGACY_PREARCHIVE'
    && data.resource.id === receipt.externalIdentifier
    && data?.subject?.type === 'EU_EVIDENCE_CONTENT'
    && data.subject.id === sha(loaded.item.contentDigest + ':' + loaded.item.evidenceFingerprint)
    && data?.payload?.detailCode === 'EU_LEGACY_PREARCHIVE_APPROVED'
    && data.payload.policyVersion === 'eu-legacy-prearchive-v1'
    && data.payload.scopeType === 'EU_LEGACY_PREARCHIVE'
    && data.payload.scopeDigest === receipt.bindingDigest
    && data.payload.semanticDigest === receipt.itemDigest
    && data.correlationId === receipt.requestId
    && Date.parse(event.accepted_at) >= Date.parse(loaded.plan.createdAt)
    && Date.parse(event.accepted_at) <= Date.parse(loaded.plan.expiresAt);
}
async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && path.isAbsolute(argv[0]));
  const bytes = fs.readFileSync(argv[0]);
  assert(bytes.length > 0 && bytes.length <= 512 * 1024);
  const value = JSON.parse(bytes.toString('utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(cfg.root, 'output', `eu-legacy-preapproval-${value.packageId}`, 'plan.json')));
  assert.equal(plan.packageId, value.packageId);
  const now = Date.now(), verificationTime = Math.min(now, Date.parse(plan.expiresAt) - 1);
  const local = validateReceiptExport(value, { now, verificationTime, allowPartial: true });
  const config = cfg.readConfig();
  const pool = new Pool({ ...cfg.connection(config, config.centralDatabase), max: 1,
    options: '-c default_transaction_read_only=on -c statement_timeout=20000' });
  try {
    const events = (await pool.query(`SELECT event_id,event_hash,actor_type,actor_id,
      organization_id,tenant_id,ledger_location,stream_id,stream_type,event_code,
      audit_class,event_data,accepted_at FROM audit.event
      WHERE event_id=ANY($1::uuid[])`, [value.receipts.map(receipt => receipt.eventId)])).rows;
    assert.equal(events.length, value.receipts.length);
    const byId = new Map(events.map(event => [event.event_id, event]));
    for (const receipt of value.receipts) {
      const loaded = loadPackage(cfg.root, value.packageId, receipt.itemDigest, verificationTime);
      assert(receiptMatchesEvent(receipt, loaded, byId.get(receipt.eventId)));
    }
    console.log(JSON.stringify({ status: 'LEDGER_RECONCILED_HISTORICAL', packageId: value.packageId,
      receipts: local.receipts, matchedEvents: events.length, missing: local.missing,
      expired: local.expired, archiveAuthorized: false,
      fileSha256: sha(bytes), databaseWrites: 0 }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_LEDGER_RECONCILIATION_FAILED');
  process.exitCode = 1;
});
module.exports = { receiptMatchesEvent, main };
