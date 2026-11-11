'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAuthorityCoordinator } = require('../src/security/authorityCoordinator');
const { createPlatformBillingRepository, PAGE_SIZE } = require('../src/platformBilling/repository');
const { createPlatformBillingService } = require('../src/platformBilling/service');
const sql = require('../src/platformBilling/sql');

function cycleRow(overrides = {}) {
  return {
    cycle_id: randomUUID(), organization_id: randomUUID(), organization_name: 'Município Exemplo',
    organization_legal_name: 'Município de Exemplo', account_version_id: randomUUID(),
    period_start: '2026-01-01', period_end: '2026-12-31', service_description: 'Subscrição anual',
    currency: 'EUR', cycle_amount: '1230.000000', planned_issue_date: '2026-01-05', due_date: '2026-02-04',
    contract_reference: 'C-2026', cycle_state: 'ISSUED', cycle_revision: '3', document_id: randomUUID(),
    document_type: 'INVOICE', document_number: 'FT 2026/1', issue_date: '2026-01-05',
    document_due_date: '2026-02-04', document_state: 'ISSUED', document_revision: '1',
    adjusted_total: '1230.000000', credit_amount: '0.000000', debit_amount: '0.000000',
    paid_amount: '400.000000', balance_amount: '830.000000', payment_state: 'PARTIALLY_PAID', overdue: true,
    ...overrides
  };
}

test('billing summary and list projections preserve exact money, filters and stable pagination', async () => {
  const row = cycleRow(), calls = [];
  const client = { async query(statement, values) {
    calls.push({ statement, values });
    if (statement === sql.summary) return { rows: [{ currency: 'EUR', billed_amount: '1230.000000',
      received_amount: '400.000000', outstanding_amount: '830.000000', overdue_amount: '830.000000',
      document_count: '1', organizations_with_balance: '1' }] };
    if (statement === sql.cyclesCount) return { rows: [{ total: '26' }] };
    if (statement === sql.cyclesList) return { rows: [row] };
    throw new Error('Unexpected read query');
  } };
  const repository = createPlatformBillingRepository();
  const summary = await repository.summary(client, { filters: { from: '2026-01-01', to: '2026-12-31',
    currency: 'EUR' }, today: '2026-10-22' });
  assert.deepEqual(summary.currencies[0], { currency: 'EUR', billedAmount: '1230', receivedAmount: '400',
    outstandingAmount: '830', overdueAmount: '830', documentCount: 1, organizationsWithBalance: 1 });
  const filters = { q: 'Município', organizationId: row.organization_id, from: '2026-01-01', to: '2026-12-31',
    cycleStatus: 'ISSUED', paymentStatus: 'PARTIALLY_PAID', overdue: true, currency: 'EUR', page: 2 };
  const result = await repository.cycles(client, { filters, today: '2026-10-22' });
  assert.equal(result.total, 26);
  assert.equal(result.pageSize, PAGE_SIZE);
  assert.equal(result.items[0].cycleAmount, '1230');
  assert.equal(result.items[0].balanceAmount, '830');
  assert.equal(result.items[0].overdue, true);
  assert.deepEqual(calls.find(call => call.statement === sql.cyclesList).values,
    ['Município', row.organization_id, '2026-01-01', '2026-12-31', 'ISSUED',
      'PARTIALLY_PAID', true, 'EUR', '2026-10-22', 25, 25]);
});

test('cycle detail projects account snapshot, fiscal documents, immutable payments and timeline', async () => {
  const row = cycleRow({
    cycle_notes: 'Nota interna', cycle_created_at: new Date('2026-01-01T10:00:00Z'),
    cycle_updated_at: new Date('2026-01-05T10:00:00Z'), legal_name: 'Município de Exemplo', tax_country: 'PT',
    tax_identifier: '501234567', address_line_1: 'Praça Central, 1', address_line_2: null,
    postal_code: '1000-100', locality: 'Lisboa', region: null, billing_email: 'financeiro@example.invalid',
    contact_name: 'Equipa Financeira', external_source: 'TOCONLINE', external_customer_ref: 'CLIENT-1',
    payment_terms_days: 30, account_notes: null
  });
  const document = { id: row.document_id, billing_cycle_id: row.cycle_id, organization_id: row.organization_id,
    source_code: 'TOCONLINE', issuer_reference: 'C4G-PT', document_type: 'INVOICE', document_number: 'FT 2026/1',
    external_document_id: 'doc-1', issue_date: '2026-01-05', due_date: '2026-02-04', currency: 'EUR',
    subtotal: '1000.000000', tax_total: '230.000000', total: '1230.000000', corrects_document_id: null,
    state: 'ISSUED', revision: '1', created_at: new Date('2026-01-05T10:00:00Z'),
    updated_at: new Date('2026-01-05T10:00:00Z') };
  const paymentId = randomUUID(), actorId = randomUUID();
  const client = { async query(statement) {
    if (statement === sql.cycleDetail) return { rows: [row] };
    if (statement === sql.cycleDocuments) return { rows: [document] };
    if (statement === sql.cyclePayments) return { rows: [{ id: paymentId, billing_document_id: row.document_id,
      record_type: 'PAYMENT', reverses_payment_id: null, amount: '400.000000', currency: 'EUR',
      effective_on: '2026-01-20', method_code: 'BANK_TRANSFER', external_reference: 'TRX-1', note: null,
      created_by: actorId, created_at: new Date('2026-01-20T10:00:00Z') }] };
    if (statement === sql.cycleTimeline) return { rows: [{ id: randomUUID(), operation_code: 'PAYMENT_RECORD',
      occurred_at: new Date('2026-01-20T10:00:00Z'), actor_id: actorId,
      event_code: 'PLATFORM_BILLING_PAYMENT_RECORDED', resource_type: 'BILLING_PAYMENT', resource_id: paymentId,
      previous_revision: null, new_revision: null, detail_code: 'PAYMENT_RECORDED', correlation_id: randomUUID() }] };
    throw new Error('Unexpected detail query');
  } };
  const detail = await createPlatformBillingRepository().cycleDetail(client,
    { cycleId: row.cycle_id, today: '2026-10-22' });
  assert.equal(detail.accountSnapshot.taxIdentifier, '501234567');
  assert.equal(detail.documents[0].total, '1230');
  assert.equal(detail.payments[0].amount, '400');
  assert.equal(detail.timeline[0].previousRevision, null);
  assert.equal(detail.cycleCreatedAt, '2026-01-01T10:00:00.000Z');
  assert.deepEqual(detail.allowedActions, { editCycle: false, readyCycle: false, cancelCycle: false,
    recordPrimaryDocument: false, recordCorrectiveDocument: true, recordPayment: true });
  assert.deepEqual(detail.documents[0].allowedActions, { cancel: false, credit: false });
  assert.deepEqual(detail.payments[0].allowedActions, { reverse: true });
});

test('cycle detail suppresses payment and reversal actions when balances are exhausted', async () => {
  const row = cycleRow({ paid_amount: '1230.000000', balance_amount: '0.000000', payment_state: 'PAID',
    payment_terms_days: 30 });
  const paymentId = randomUUID(), settledPaymentId = randomUUID();
  const document = { id: row.document_id, billing_cycle_id: row.cycle_id, source_code: 'TOCONLINE',
    issuer_reference: 'C4G-PT', document_type: 'INVOICE', document_number: 'FT 2026/1', external_document_id: null,
    issue_date: '2026-01-05', due_date: '2026-02-04', currency: 'EUR', subtotal: '1000', tax_total: '230',
    total: '1230', corrects_document_id: null, state: 'ISSUED', revision: '1', created_at: new Date(), updated_at: new Date() };
  const client = { async query(statement) {
    if (statement === sql.cycleDetail) return { rows: [row] };
    if (statement === sql.cycleDocuments) return { rows: [document] };
    if (statement === sql.cyclePayments) return { rows: [
      { id: paymentId, billing_document_id: row.document_id, record_type: 'PAYMENT', reverses_payment_id: null,
        amount: '1230', currency: 'EUR', effective_on: '2026-01-20', method_code: 'BANK_TRANSFER',
        external_reference: null, note: null, created_by: randomUUID(), created_at: new Date() },
      { id: randomUUID(), billing_document_id: row.document_id, record_type: 'REVERSAL', reverses_payment_id: paymentId,
        amount: '1230', currency: 'EUR', effective_on: '2026-01-21', method_code: 'BANK_TRANSFER',
        external_reference: null, note: null, created_by: randomUUID(), created_at: new Date() },
      { id: settledPaymentId, billing_document_id: row.document_id, record_type: 'PAYMENT', reverses_payment_id: null,
        amount: '1230', currency: 'EUR', effective_on: '2026-01-22', method_code: 'BANK_TRANSFER',
        external_reference: null, note: null, created_by: randomUUID(), created_at: new Date() }
    ] };
    if (statement === sql.cycleTimeline) return { rows: [] };
    throw new Error('Unexpected detail query');
  } };
  const detail = await createPlatformBillingRepository().cycleDetail(client,
    { cycleId: row.cycle_id, today: '2026-10-22' });
  assert.equal(detail.allowedActions.recordPayment, false);
  assert.equal(detail.payments[0].allowedActions.reverse, false);
  assert.equal(detail.documents[0].allowedActions.cancel, false);
});

test('account detail distinguishes a known organization without billing setup from a missing organization', async () => {
  const organizationId = randomUUID();
  const repository = createPlatformBillingRepository();
  const empty = await repository.accountDetail({ query: async () => ({ rows: [{ organization_id: organizationId,
    organization_name: 'Sem conta', organization_legal_name: 'Sem Conta, Lda.', organization_status: 'ACTIVE',
    account_id: null }] }) }, { organizationId });
  assert.equal(empty.account, null);
  await assert.rejects(() => repository.accountDetail({ query: async () => ({ rows: [] }) }, { organizationId }),
    error => error.code === 'RESOURCE_NOT_AVAILABLE');
});

function coordinatorFixture() {
  const central = { release() {}, async query(statement) {
    const normalized = String(statement).replace(/\s+/g, ' ').trim();
    if (normalized.includes('c4g_database_identity')) return { rows: [{ valid: true }] };
    return { rows: [] };
  } };
  return createAuthorityCoordinator({ pool: { connect: async () => central, query: (...args) => central.query(...args) },
    permitSecret: 'synthetic-platform-billing-reader-secret' });
}

test('read service authorizes twice inside a five-second read-only transaction', async t => {
  for (const name of ['assertAuthorityAdmission', 'assertAuthoritySecurity']) {
    t.mock.method(require('../src/security/authoritySecurityManifest'), name, async () => {});
  }
  t.mock.method(require('../src/security/authorityProtocolQueries'), 'execute', (client, statement, values) => client.query(statement, values));
  const actorId = randomUUID(), request = { user: { id: actorId }, sessionID: 'billing-session',
    authContext: { sessionId: 'billing-session' } };
  const calls = [], client = { released: false, release() { this.released = true; }, async query(statement) {
    calls.push(statement);
    if (statement === sql.readAdmin) return { rows: [{ id: actorId }] };
    return { rows: [] };
  } };
  const repository = {
    accountWrite() {}, cycleCreate() {}, cycleEdit() {}, cycleTransition() {}, documentRecord() {},
    documentTransition() {}, paymentRecord() {}, paymentReverse() {}, cycles() {}, cycleDetail() {}, accountDetail() {},
    cycleOrganization() {}, documentOrganization() {}, paymentOrganization() {},
    async summary(received, input) {
      assert.equal(received, client); assert.equal(input.today, '2026-10-22'); return { currencies: [] };
    }
  };
  const service = createPlatformBillingService({ coordinator: coordinatorFixture(),
    centralPool: { connect: async () => client }, repository, today: () => '2026-10-22' });
  assert.deepEqual(await service.summary({}, request), { currencies: [] });
  assert.deepEqual(calls, ['BEGIN READ ONLY', "SET LOCAL statement_timeout='5s'", sql.readAdmin, sql.readAdmin, 'COMMIT']);
  assert.equal(client.released, true);
});

test('read service refuses untrusted requests before connection and revocation before return', async t => {
  for (const name of ['assertAuthorityAdmission', 'assertAuthoritySecurity']) {
    t.mock.method(require('../src/security/authoritySecurityManifest'), name, async () => {});
  }
  t.mock.method(require('../src/security/authorityProtocolQueries'), 'execute', (client, statement, values) => client.query(statement, values));
  const actorId = randomUUID(), request = { user: { id: actorId }, sessionID: 'billing-session',
    authContext: { sessionId: 'billing-session' } };
  let connects = 0, authorizations = 0;
  const client = { release() {}, async query(statement) {
    if (statement === sql.readAdmin) return { rows: ++authorizations === 1 ? [{ id: actorId }] : [] };
    return { rows: [] };
  } };
  const repository = {
    accountWrite() {}, cycleCreate() {}, cycleEdit() {}, cycleTransition() {}, documentRecord() {},
    documentTransition() {}, paymentRecord() {}, paymentReverse() {}, cycles() {}, cycleDetail() {}, accountDetail() {},
    cycleOrganization() {}, documentOrganization() {}, paymentOrganization() {},
    async summary() { return { currencies: [] }; }
  };
  const service = createPlatformBillingService({ coordinator: coordinatorFixture(),
    centralPool: { connect: async () => { connects += 1; return client; } }, repository, today: () => '2026-10-22' });
  await assert.rejects(() => service.summary({}, {}), error => error.code === 'C4G_ADMIN_REQUIRED');
  assert.equal(connects, 0);
  await assert.rejects(() => service.summary({}, request), error => error.code === 'C4G_ADMIN_REQUIRED');
  assert.equal(connects, 1);
});
