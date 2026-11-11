'use strict';

const { isAbsolute } = require('node:path');
const { randomUUID } = require('node:crypto');
const { createF12LocalComposition } = require('../opportunities/localComposition');
const { createWorkerProcessor } = require('../async/workerProcessor');
const { WorkerLifecycle } = require('../async/workerLifecycle');
const { InboxRepository } = require('../async/inboxRepository');
const { consumer } = require('../opportunities/f12InterruptedDeliveryRecovery');

function createOpportunityReceiptWorker({ compositionDependencies, queue, transactionResolver,
  relay, retryPort, deadLetterPort, interruptedDeliveryRecovery, terminalReceiptPort, close, telemetry, errorObserver,
  scheduler = { setTimeout, clearTimeout }, pollIntervalMs = 1000 }) {
  if (!compositionDependencies?.receiptRuntimeDependencies || typeof relay?.poll !== 'function'
      || typeof close !== 'function' || !['claim', 'complete', 'heartbeat', 'fail', 'deadLetter', 'cancel', 'shutdown']
        .every(method => typeof queue?.[method] === 'function')
      || typeof retryPort?.schedule !== 'function' || typeof deadLetterPort?.record !== 'function'
      || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 60000) {
    throw new TypeError('F12 receipt worker infrastructure is incomplete.');
  }
  const composition = createF12LocalComposition({ ...compositionDependencies, telemetry });
  const { jobs: registry } = composition;
  const lifecycle = new WorkerLifecycle({ queue, run: async () => {}, telemetry });
  const processor = createWorkerProcessor({ queue, registry, transactionResolver, lifecycle,
    inbox: new InboxRepository(), retryPort, deadLetterPort, errorObserver, terminalReceiptPort,
    consumer, workerId: 'f12-opportunity-' + randomUUID() });
  let timer, active, stopping, started = false;
  async function runOnce() {
    if (stopping) throw new Error('F12_RECEIPT_WORKER_STOPPING');
    if (active) return active;
    const poll = async () => {
      await interruptedDeliveryRecovery?.poll();
      await relay.poll();
      for (const type of registry.types) {
        if (stopping) break;
        await processor.processOnce({ type, batchSize: 5 });
      }
    };
    active = (telemetry ? telemetry.run({ name: 'poll f12 opportunity jobs', kind: 1 }, poll) : poll())
      .finally(() => { active = null; });
    return active;
  }
  function schedule() {
    if (stopping) return;
    timer = scheduler.setTimeout(() => {
      timer = null;
      runOnce().catch(() => {}).finally(schedule);
    }, pollIntervalMs);
  }
  async function start() {
    if (stopping) throw new Error('F12_RECEIPT_WORKER_STOPPING');
    if (started) return;
    started = true;
    try { await runOnce(); } catch (error) { started = false; throw error; }
    schedule();
  }
  function shutdown() {
    stopping ||= Promise.resolve().then(async () => {
      if (timer != null) scheduler.clearTimeout(timer);
      try {
        await active?.catch(() => {});
        await lifecycle.shutdown();
      } finally {
        await close();
      }
    });
    return stopping;
  }
  return Object.freeze({ registry, queue, start, runOnce, shutdown });
}

async function loadOpportunityReceiptWorker({ env, telemetry }) {
  const modulePath = env.F12_OPPORTUNITY_WORKER_PROVIDER;
  if (modulePath && !isAbsolute(modulePath)) {
    throw new TypeError('F12 opportunity worker provider path must be absolute.');
  }
  const { createOpportunityReceiptWorkerInfrastructure } = modulePath
    ? require(modulePath) : require('./opportunityReceiptWorkerInfrastructure');
  if (typeof createOpportunityReceiptWorkerInfrastructure !== 'function') {
    throw new TypeError('F12 opportunity worker provider contract is invalid.');
  }
  const infrastructure = await createOpportunityReceiptWorkerInfrastructure({ env, telemetry });
  try {
    return createOpportunityReceiptWorker({ ...infrastructure, telemetry });
  } catch (error) {
    try { await infrastructure?.queue?.shutdown?.(); }
    finally { await infrastructure?.close?.(); }
    throw error;
  }
}

module.exports = { createOpportunityReceiptWorker, loadOpportunityReceiptWorker };
