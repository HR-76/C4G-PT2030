'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAuthorityCoordinator } = require('../src/security/authorityCoordinator');
const { createUuidV7 } = require('../src/audit/uuidV7');
const { createBillingAudit } = require('../src/platformBilling/audit');
const { createPlatformBillingRepository } = require('../src/platformBilling/repository');
const { createPlatformBillingService } = require('../src/platformBilling/service');
const billingSql = require('../src/platformBilling/sql');
const onboardingSql = require('../src/platformOnboarding/sql');

const ACCOUNT = Object.freeze({
  idempotencyKey: '10000000-0000-4000-8000-000000000001', expectedRevision: 0,
  legalName: 'Entidade Exemplo, Lda.', taxCountry: 'PT', taxIdentifier: '500000000',
  addressLine1: 'Rua Um, 1', addressLine2: null, postalCode: '1000-001', locality: 'Lisboa', region: null,
  billingEmail: 'financeiro@example.org', contactName: 'Ana Silva', externalSource: null,
  externalCustomerRef: null, paymentTermsDays: 30, notes: null
});

function cycleCommand(organizationId, accountVersionId, idempotencyKey) {
  return Object.freeze({ organizationId, accountVersionId, periodStart: '2026-01-01', periodEnd: '2026-12-31',
    serviceDescription: 'Subscrição anual', currency: 'EUR', amount: '1200', plannedIssueDate: '2026-01-05',
    dueDate: '2026-02-04', contractReference: 'C-2026-01', notes: null, idempotencyKey });
}
function cycleEditCommand(organizationId, accountVersionId, idempotencyKey, expectedRevision, changes = {}) {
  const { organizationId: ignored, ...editable } = cycleCommand(organizationId, accountVersionId, idempotencyKey);
  return Object.freeze({ expectedRevision, ...editable, ...changes });
}

function repositoryFixture({ auditFailure = null } = {}) {
  const state = { accounts: new Map(), versions: new Map(), cycles: new Map(), receipts: new Map(),
    activities: [], cycleRevisions: [], audit: [], calls: [] };
  const ids = [
    '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000005'
  ];
  const client = { async query(statement, values = []) {
    state.calls.push({ statement, values });
    if (statement === billingSql.receiptByKey) return { rows: [state.receipts.get(values.slice(0, 3).join(':'))].filter(Boolean) };
    if (statement === billingSql.accountByOrganizationForUpdate) return { rows: [state.accounts.get(values[0])].filter(Boolean) };
    if (statement === billingSql.insertAccount) {
      const row = { id: values[0], organization_id: values[1], revision: 1, current_version: 1 };
      state.accounts.set(values[1], row); return { rows: [row] };
    }
    if (statement === billingSql.insertAccountVersion) {
      const row = { id: values[0], billing_account_id: values[1], organization_id: values[2], version: values[3] };
      state.versions.set(row.id, row); return { rows: [row] };
    }
    if (statement === billingSql.updateAccountHead) {
      const row = state.accounts.get(values[1]);
      if (!row || Number(row.revision) !== values[3]) return { rows: [] };
      Object.assign(row, { revision: values[2], current_version: values[2] }); return { rows: [row] };
    }
    if (statement === billingSql.accountVersionById) {
      const row = state.versions.get(values[0]); return { rows: row?.organization_id === values[1] ? [row] : [] };
    }
    if (statement === billingSql.insertCycle) {
      const row = { id: values[0], organization_id: values[1], account_version_id: values[2],
        period_start: values[3], period_end: values[4], service_description: values[5], currency: values[6],
        amount: values[7], planned_issue_date: values[8], due_date: values[9], contract_reference: values[10],
        notes: values[11], state: 'DRAFT', revision: 1 };
      state.cycles.set(row.id, row); return { rows: [row] };
    }
    if (statement === billingSql.cycleForUpdate) {
      const row = state.cycles.get(values[0]); return { rows: row?.organization_id === values[1] ? [row] : [] };
    }
    if (statement === billingSql.updateCycle) {
      const row = state.cycles.get(values[0]);
      if (!row || row.organization_id !== values[1] || row.revision !== values[13] || row.state !== 'DRAFT') return { rows: [] };
      Object.assign(row, { account_version_id: values[2], period_start: values[3], period_end: values[4],
        service_description: values[5], currency: values[6], amount: values[7], planned_issue_date: values[8],
        due_date: values[9], contract_reference: values[10], notes: values[11], revision: row.revision + 1 });
      return { rows: [row] };
    }
    if (statement === billingSql.transitionCycle) {
      const row = state.cycles.get(values[0]);
      if (!row || row.organization_id !== values[1] || row.revision !== values[4]) return { rows: [] };
      Object.assign(row, { state: values[2], revision: row.revision + 1 }); return { rows: [row] };
    }
    if (statement === billingSql.insertCycleRevision) {
      const row = state.cycles.get(values[0]);
      if (!row) return { rows: [] };
      const revision = { ...row, changed_by: values[1], change_reason: values[2] };
      state.cycleRevisions.push(revision); return { rows: [revision] };
    }
    if (statement === billingSql.insertActivity) {
      state.activities.push(values); return { rows: [{ id: randomUUID(), occurred_at: new Date().toISOString() }] };
    }
    if (statement === billingSql.insertReceipt) {
      const row = { intent_digest: values[4], result_projection: JSON.parse(values[5]) };
      state.receipts.set(values.slice(0, 3).join(':'), row); return { rows: [row] };
    }
    throw new Error(`Unexpected billing query: ${statement}`);
  } };
  const repository = createPlatformBillingRepository({ id: () => ids.shift(), correlationId: createUuidV7,
    audit: async (receivedClient, event) => {
      assert.equal(receivedClient, client); state.audit.push(event);
      if (auditFailure) throw auditFailure;
    } });
  return { state, client, repository };
}

test('billing account writes create immutable versions, replay safely and enforce CAS', async () => {
  const f = repositoryFixture(), organizationId = randomUUID(), actorId = randomUUID();
  const created = await f.repository.accountWrite(f.client, { organizationId, actorId, command: ACCOUNT });
  assert.equal(created.revision, 1);
  assert.equal(f.state.versions.size, 1);
  assert.deepEqual(await f.repository.accountWrite(f.client, { organizationId, actorId, command: ACCOUNT }), created);
  assert.equal(f.state.versions.size, 1);
  await assert.rejects(() => f.repository.accountWrite(f.client, { organizationId, actorId,
    command: { ...ACCOUNT, legalName: 'Outra entidade' } }), error => error.code === 'IDEMPOTENCY_CONFLICT');
  const updated = await f.repository.accountWrite(f.client, { organizationId, actorId,
    command: { ...ACCOUNT, idempotencyKey: randomUUID(), expectedRevision: 1, billingEmail: 'nova@example.org' } });
  assert.equal(updated.revision, 2);
  assert.equal(f.state.versions.size, 2);
  await assert.rejects(() => f.repository.accountWrite(f.client, { organizationId, actorId,
    command: { ...ACCOUNT, idempotencyKey: randomUUID(), expectedRevision: 1 } }), error => error.code === 'STALE_REVISION');
  assert.equal(f.state.activities.length, 2);
  assert.equal(f.state.audit.length, 2);
});

test('billing cycles preserve snapshots and reasons while enforcing edit and transition CAS', async () => {
  const f = repositoryFixture(), organizationId = randomUUID(), actorId = randomUUID();
  const account = await f.repository.accountWrite(f.client, { organizationId, actorId, command: ACCOUNT });
  const created = await f.repository.cycleCreate(f.client, { actorId,
    command: cycleCommand(organizationId, account.accountVersionId, randomUUID()) });
  assert.deepEqual({ revision: created.revision, state: created.state }, { revision: 1, state: 'DRAFT' });
  const edited = await f.repository.cycleEdit(f.client, { organizationId, cycleId: created.cycleId, actorId,
    command: cycleEditCommand(organizationId, account.accountVersionId, randomUUID(), 1, { amount: '1300' }) });
  assert.equal(edited.revision, 2);
  const ready = await f.repository.cycleTransition(f.client, { organizationId, cycleId: created.cycleId, actorId,
    command: { toState: 'READY_TO_ISSUE', reason: null, expectedRevision: 2, idempotencyKey: randomUUID() } });
  assert.equal(ready.state, 'READY_TO_ISSUE');
  await assert.rejects(() => f.repository.cycleEdit(f.client, { organizationId, cycleId: created.cycleId, actorId,
    command: cycleEditCommand(organizationId, account.accountVersionId, randomUUID(), 3) }),
  error => error.code === 'BILLING_CYCLE_NOT_EDITABLE');
  const cancelled = await f.repository.cycleTransition(f.client, { organizationId, cycleId: created.cycleId, actorId,
    command: { toState: 'CANCELLED', reason: 'Contrato terminado', expectedRevision: 3, idempotencyKey: randomUUID() } });
  assert.equal(cancelled.revision, 4);
  assert.equal(f.state.cycleRevisions.at(-1).change_reason, 'Contrato terminado');
  await assert.rejects(() => f.repository.cycleTransition(f.client, { organizationId, cycleId: created.cycleId, actorId,
    command: { toState: 'READY_TO_ISSUE', reason: null, expectedRevision: 4, idempotencyKey: randomUUID() } }),
  error => error.code === 'CYCLE_TRANSITION_NOT_ALLOWED');
});

test('timeline and F7 happen before the idempotency receipt and use the same transaction client', async () => {
  const failure = Object.assign(new Error('audit unavailable'), { code: 'AUDIT_FAILURE' });
  const f = repositoryFixture({ auditFailure: failure }), organizationId = randomUUID(), actorId = randomUUID();
  await assert.rejects(() => f.repository.accountWrite(f.client, { organizationId, actorId, command: ACCOUNT }),
    error => error === failure);
  assert.equal(f.state.activities.length, 1);
  assert.equal(f.state.audit.length, 1);
  assert.equal(f.state.receipts.size, 0);
  const activityIndex = f.state.calls.findIndex(call => call.statement === billingSql.insertActivity);
  const receiptIndex = f.state.calls.findIndex(call => call.statement === billingSql.insertReceipt);
  assert.notEqual(activityIndex, -1);
  assert.equal(receiptIndex, -1);
});

test('billing audit appends a non-sensitive platform event through the central ledger', async () => {
  const calls = [], client = { async query(statement, values) {
    calls.push({ statement, values });
    if (statement === onboardingSql.auditPrepare) return { rows: [{ stream_id: randomUUID(), sequence: 1,
      previous_hash: null, accepted_at: new Date() }] };
    if (statement === onboardingSql.auditAppend) return { rows: [{ status: 'APPENDED', event_id: values[0], event_hash: values[21] }] };
    throw new Error('Unexpected audit query');
  } };
  const audit = createBillingAudit(), resourceId = randomUUID();
  const result = await audit(client, { actorId: randomUUID(), eventCode: 'PLATFORM_BILLING_CYCLE_CHANGED',
    resourceType: 'BILLING_CYCLE', resourceId, previousRevision: 1, newRevision: 2,
    detailCode: 'STALE_REVISION', correlationId: createUuidV7(), idempotencyKey: `billing:CYCLE_EDIT:${randomUUID()}`,
    decision: 'ACCEPT', outcome: 'CONFLICT' });
  assert.equal(result.status, 'APPENDED');
  assert.deepEqual(calls.map(call => call.statement), [onboardingSql.auditPrepare, onboardingSql.auditAppend]);
  const persisted = JSON.parse(calls[1].values[22]);
  assert.equal(persisted.operationCode, 'PLATFORM_BILLING');
  assert.deepEqual(persisted.payload, { detailCode: 'STALE_REVISION', newVersion: '2', previousVersion: '1' });
  assert.equal(persisted.decision, 'ACCEPT');
  assert.equal(persisted.outcome, 'CONFLICT');
  assert.equal(JSON.stringify(persisted).includes('amount'), false);
});

test('billing service requires a live C4G admin and binds writes to organization and actor scopes', async t => {
  for (const name of ['assertAuthorityAdmission', 'assertAuthoritySecurity']) {
    t.mock.method(require('../src/security/authoritySecurityManifest'), name, async () => {});
  }
  t.mock.method(require('../src/security/authorityProtocolQueries'), 'execute', (client, statement, values) => client.query(statement, values));
  const actorId = randomUUID(), organizationId = randomUUID(), scopeSets = [];
  let admin = true, accountFailure = null;
  const repositoryCalls = [], rejected = [];
  const central = { release() {}, async query(statement, values = []) {
    const normalized = String(statement).replace(/\s+/g, ' ').trim();
    if (normalized.includes('c4g_database_identity')) return { rows: [{ valid: true }] };
    if (normalized.startsWith('INSERT INTO public.authority_write_request')) { scopeSets.push(values[1]); return { rows: [] }; }
    if (normalized.startsWith('SELECT state,deadline FROM public.authority_write_request')) return { rows: [{ state: 'WAITING', deadline: new Date(Date.now() + 10000) }] };
    if (normalized.includes('FROM public.authority_write_request') && normalized.includes('epoch<')) return { rows: [] };
    if (normalized.includes('FROM public.authority_commit_guard') && normalized.includes('state IN')) return { rows: [] };
    if (normalized === onboardingSql.admin) return { rows: admin ? [{ id: values[1] }] : [] };
    if (normalized === billingSql.organizationAvailable) return { rows: [{ id: values[0] }] };
    return { rows: [], rowCount: 0 };
  } };
  const coordinator = createAuthorityCoordinator({ pool: { connect: async () => central, query: (...args) => central.query(...args) },
    permitSecret: 'synthetic-platform-billing-permit-secret' });
  const called = name => async (client, input) => { repositoryCalls.push({ name, client, input }); return { name }; };
  const repository = { accountWrite: async (client, input) => {
    if (accountFailure) throw accountFailure;
    repositoryCalls.push({ name: 'accountWrite', client, input }); return { revision: input.command.expectedRevision + 1 };
  }, cycleCreate: called('cycleCreate'), cycleEdit: called('cycleEdit'), cycleTransition: called('cycleTransition'),
  documentRecord: called('documentRecord'), documentTransition: called('documentTransition'),
  paymentRecord: called('paymentRecord'), paymentReverse: called('paymentReverse'), summary: called('summary'),
  cycles: called('cycles'), cycleDetail: called('cycleDetail'), accountDetail: called('accountDetail'),
  cycleOrganization: async () => organizationId, documentOrganization: async () => organizationId,
  paymentOrganization: async () => organizationId };
  const reader = { release() {}, async query(statement, values = []) {
    if (statement === billingSql.readAdmin) return { rows: admin ? [{ id: values[1] }] : [] };
    return { rows: [] };
  } };
  const centralPool = { connect: async () => reader };
  const service = createPlatformBillingService({ coordinator, centralPool, repository,
    rejectionAudit: async (client, input) => { assert.equal(typeof client.query, 'function'); rejected.push(input); return { status: 'APPENDED' }; } });
  const request = { user: { id: actorId }, sessionID: 'session', authContext: { sessionId: 'session' } };
  assert.deepEqual(await service.accountWrite(organizationId, ACCOUNT, request), { revision: 1 });
  assert.equal(repositoryCalls.length, 1);
  assert.equal(scopeSets.some(scopes => scopes.includes(`ORG:${organizationId}`) && scopes.includes(`SUBJECT:${actorId}`)), true);
  const cycleId = randomUUID(), documentId = randomUUID(), paymentId = randomUUID();
  assert.deepEqual(await service.documentRecord(cycleId, {
    sourceCode: 'TOCONLINE', issuerReference: 'C4G-PT', documentType: 'INVOICE', documentNumber: 'FT 1',
    externalDocumentId: null, issueDate: '2026-01-05', dueDate: '2026-02-04', currency: 'EUR',
    subtotal: '100', taxTotal: '23', total: '123', correctsDocumentId: null,
    expectedCycleRevision: 2, idempotencyKey: randomUUID()
  }, request), { name: 'documentRecord' });
  assert.deepEqual(await service.paymentRecord(documentId, {
    amount: '123', currency: 'EUR', paidOn: '2026-01-20', methodCode: 'BANK_TRANSFER',
    externalReference: null, note: null, idempotencyKey: randomUUID()
  }, request), { name: 'paymentRecord' });
  assert.deepEqual(await service.documentTransition(documentId, {
    toState: 'CANCELLED', reason: 'Anulação externa', expectedRevision: 1, idempotencyKey: randomUUID()
  }, request), { name: 'documentTransition' });
  assert.deepEqual(await service.paymentReverse(paymentId, {
    amount: '123', reversedOn: '2026-01-21', reason: 'Transferência devolvida', idempotencyKey: randomUUID()
  }, request), { name: 'paymentReverse' });
  assert.deepEqual(repositoryCalls.slice(1).map(call => call.name),
    ['documentRecord', 'paymentRecord', 'documentTransition', 'paymentReverse']);
  assert.equal(repositoryCalls[1].input.cycleId, cycleId);
  assert.equal(repositoryCalls[2].input.documentId, documentId);
  assert.equal(repositoryCalls[3].input.documentId, documentId);
  assert.equal(repositoryCalls[4].input.paymentId, paymentId);
  admin = false;
  await assert.rejects(() => service.accountWrite(organizationId, { ...ACCOUNT, idempotencyKey: randomUUID() }, request),
    error => error.code === 'C4G_ADMIN_REQUIRED');
  assert.equal(repositoryCalls.length, 5);
  assert.deepEqual({ decision: rejected[0].decision, outcome: rejected[0].outcome,
    detailCode: rejected[0].detailCode, resourceId: rejected[0].resourceId },
  { decision: 'DENY', outcome: 'REFUSED', detailCode: 'C4G_ADMIN_REQUIRED', resourceId: organizationId });
  admin = true;
  accountFailure = Object.assign(new Error('private revision state'), { code: 'STALE_REVISION' });
  await assert.rejects(() => service.accountWrite(organizationId, { ...ACCOUNT, idempotencyKey: randomUUID() }, request),
    error => error === accountFailure);
  assert.deepEqual({ decision: rejected[1].decision, outcome: rejected[1].outcome,
    detailCode: rejected[1].detailCode },
  { decision: 'ACCEPT', outcome: 'CONFLICT', detailCode: 'STALE_REVISION' });
  accountFailure = Object.assign(new Error('BILLING_PAYMENT_EXCEEDS_BALANCE'), { code: '23514' });
  await assert.rejects(() => service.accountWrite(organizationId, { ...ACCOUNT, idempotencyKey: randomUUID() }, request),
    error => error === accountFailure);
  assert.deepEqual({ outcome: rejected[2].outcome, detailCode: rejected[2].detailCode },
    { outcome: 'REFUSED', detailCode: 'BILLING_PAYMENT_EXCEEDS_BALANCE' });
  assert.equal(JSON.stringify(rejected).includes('private revision state'), false);
});
