'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { createOpportunityReceiptWorker } = require('../src/config/opportunityReceiptWorker');
const { JOBS } = require('../src/opportunities/jobs');

test('receipt worker polls the two F12 jobs and drains before closing infrastructure', async () => {
  const events = [];
  const unused = async () => { throw new Error('unexpected delivery'); };
  let tick;
  const runtime = createOpportunityReceiptWorker({
    compositionDependencies: {
      receiptRuntimeDependencies: { central: { query: unused }, tenantRuntimeDependencies: {} },
      authorization: { authorize: unused },
      authorizationOperationCatalog: createProductionCatalogs({ catalogVersion: 'f12' }).operationCatalog,
      createTenantRuntime({ operationCatalog }) {
        assert.equal(operationCatalog.size, 10);
        return { resolve: unused };
      },
      tenantRepository: { withTransactionClient: unused, scanDuplicateBatch: unused,
        recordCandidate: unused, recomputeCurrentQuality: unused },
      jobContextPort: { resolveOrganizationContext: unused },
      continuationPort: { enqueue: unused }
    },
    queue: { async claim({ type }) { events.push(type); return []; }, async shutdown() { events.push('queue-close'); },
      complete: unused, heartbeat: unused, fail: unused, deadLetter: unused, cancel: unused },
    transactionResolver: { resolve: unused },
    retryPort: { schedule: unused },
    deadLetterPort: { record: unused },
    relay: { async poll() { events.push('relay'); } },
    close: async () => { events.push('infrastructure-close'); },
    scheduler: { setTimeout(work) { tick = work; return 1; }, clearTimeout() { tick = null; } }
  });
  await runtime.start();
  await runtime.start();
  assert.deepEqual(events, ['relay', ...JOBS]);
  assert.equal(typeof tick, 'function');
  await Promise.all([runtime.shutdown(), runtime.shutdown()]);
  assert.deepEqual(events, ['relay', ...JOBS, 'queue-close', 'infrastructure-close']);
  assert.equal(tick, null);
  await assert.rejects(runtime.runOnce(), /F12_RECEIPT_WORKER_STOPPING/);
});
