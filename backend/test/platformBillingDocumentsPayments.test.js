'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { command } = require('../src/platformBilling/contracts');
const { createPlatformBillingRepository } = require('../src/platformBilling/repository');
const sql = require('../src/platformBilling/sql');

function units(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
function amount(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1000000n;
  const fraction = String(absolute % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
function documentCommand(overrides = {}) {
  return command('documentRecord', {
    sourceCode: 'TOCONLINE', issuerReference: 'C4G-PT', documentType: 'INVOICE',
    documentNumber: 'FT 2026/1', externalDocumentId: 'external-1', issueDate: '2026-01-05',
    dueDate: '2026-02-04', currency: 'EUR', subtotal: '1000', taxTotal: '230', total: '1230',
    correctsDocumentId: null, expectedCycleRevision: 2, idempotencyKey: randomUUID(), ...overrides
  });
}
function paymentCommand(overrides = {}) {
  return command('paymentRecord', { amount: '400', currency: 'EUR', paidOn: '2026-01-20',
    methodCode: 'BANK_TRANSFER', externalReference: 'TRX-1', note: null,
    idempotencyKey: randomUUID(), ...overrides });
}

function fixture({ auditFailure = null } = {}) {
  const organizationId = randomUUID(), actorId = randomUUID(), cycleId = randomUUID();
  const state = {
    cycles: new Map([[cycleId, { id: cycleId, organization_id: organizationId, currency: 'EUR', amount: '1230',
      state: 'READY_TO_ISSUE', revision: 2 }]]),
    documents: new Map(), payments: new Map(), receipts: new Map(), documentRevisions: [], cycleRevisions: [],
    activities: [], audit: []
  };
  const client = { async query(statement, values = []) {
    if (statement === sql.receiptByKey) return { rows: [state.receipts.get(values.slice(0, 3).join(':'))].filter(Boolean) };
    if (statement === sql.cycleForUpdate) {
      const row = state.cycles.get(values[0]); return { rows: row?.organization_id === values[1] ? [row] : [] };
    }
    if (statement === sql.insertDocument) {
      const row = { id: values[0], billing_cycle_id: values[1], organization_id: values[2], source_code: values[3],
        issuer_reference: values[4], document_type: values[5], document_number: values[6], external_document_id: values[7],
        issue_date: values[8], due_date: values[9], currency: values[10], subtotal: values[11], tax_total: values[12],
        total: values[13], corrects_document_id: values[14], state: 'ISSUED', revision: 1,
        created_by: values[15], updated_by: values[15] };
      state.documents.set(row.id, row); return { rows: [row] };
    }
    if (statement === sql.documentById || statement === sql.documentForUpdate) {
      const row = state.documents.get(values[0]); return { rows: row?.organization_id === values[1] ? [row] : [] };
    }
    if (statement === sql.transitionDocument) {
      const row = state.documents.get(values[0]);
      if (!row || row.organization_id !== values[1] || row.revision !== values[4]) return { rows: [] };
      Object.assign(row, { state: values[2], revision: row.revision + 1 }); return { rows: [row] };
    }
    if (statement === sql.insertDocumentRevision) {
      const row = state.documents.get(values[0]);
      if (!row) return { rows: [] };
      const revision = { ...row, reason: values[1], changed_by: values[2] };
      state.documentRevisions.push(revision); return { rows: [revision] };
    }
    if (statement === sql.transitionCycle) {
      const row = state.cycles.get(values[0]);
      if (!row || row.organization_id !== values[1] || row.revision !== values[4]) return { rows: [] };
      Object.assign(row, { state: values[2], revision: row.revision + 1 }); return { rows: [row] };
    }
    if (statement === sql.insertCycleRevision) {
      const row = state.cycles.get(values[0]);
      if (!row) return { rows: [] };
      const revision = { ...row, reason: values[2], changed_by: values[1] };
      state.cycleRevisions.push(revision); return { rows: [revision] };
    }
    if (statement === sql.documentAdjustments) {
      const relevant = [...state.documents.values()].filter(row => row.organization_id === values[1]
        && row.corrects_document_id === values[0] && row.state !== 'CANCELLED');
      const credits = relevant.filter(row => row.document_type === 'CREDIT_NOTE')
        .reduce((sum, row) => sum + units(row.total), 0n);
      const debits = relevant.filter(row => row.document_type === 'DEBIT_NOTE')
        .reduce((sum, row) => sum + units(row.total), 0n);
      return { rows: [{ credit_amount: amount(credits), debit_amount: amount(debits) }] };
    }
    if (statement === sql.insertPayment) {
      const row = { id: values[0], organization_id: values[1], billing_document_id: values[2], record_type: values[3],
        reverses_payment_id: values[4], amount: values[5], currency: values[6], effective_on: values[7],
        method_code: values[8], external_reference: values[9], note: values[10], created_by: values[11] };
      const document = state.documents.get(row.billing_document_id);
      if (row.record_type === 'PAYMENT') {
        const net = [...state.payments.values()].filter(item => item.billing_document_id === row.billing_document_id)
          .reduce((sum, item) => sum + (item.record_type === 'PAYMENT' ? units(item.amount) : -units(item.amount)), 0n);
        const corrections = [...state.documents.values()].filter(item => item.corrects_document_id === document.id
          && item.state !== 'CANCELLED');
        const adjusted = units(document.total) + corrections.filter(item => item.document_type === 'DEBIT_NOTE')
          .reduce((sum, item) => sum + units(item.total), 0n) - corrections.filter(item => item.document_type === 'CREDIT_NOTE')
          .reduce((sum, item) => sum + units(item.total), 0n);
        if (net + units(row.amount) > adjusted) throw Object.assign(new Error('excess'), { code: '23514' });
      } else {
        const original = state.payments.get(row.reverses_payment_id);
        const reversed = [...state.payments.values()].filter(item => item.reverses_payment_id === original.id)
          .reduce((sum, item) => sum + units(item.amount), 0n);
        if (reversed + units(row.amount) > units(original.amount)) throw Object.assign(new Error('invalid reversal'), { code: '23514' });
      }
      state.payments.set(row.id, row); return { rows: [row] };
    }
    if (statement === sql.paymentById) {
      const row = state.payments.get(values[0]), document = row && state.documents.get(row.billing_document_id);
      return { rows: row?.organization_id === values[1] ? [{ ...row, billing_cycle_id: document.billing_cycle_id,
        document_type: document.document_type, document_state: document.state }] : [] };
    }
    if (statement === sql.paymentForUpdate) {
      const row = state.payments.get(values[0]); return { rows: row?.organization_id === values[1] ? [row] : [] };
    }
    if (statement === sql.documentBalance) {
      const document = state.documents.get(values[0]);
      if (!document || document.organization_id !== values[1]) return { rows: [] };
      const records = [...state.payments.values()].filter(row => row.billing_document_id === document.id);
      const paid = records.reduce((sum, row) => sum + (row.record_type === 'PAYMENT' ? units(row.amount) : -units(row.amount)), 0n);
      const corrections = [...state.documents.values()].filter(row => row.corrects_document_id === document.id
        && row.state !== 'CANCELLED');
      const credits = corrections.filter(row => row.document_type === 'CREDIT_NOTE')
        .reduce((sum, row) => sum + units(row.total), 0n);
      const debits = corrections.filter(row => row.document_type === 'DEBIT_NOTE')
        .reduce((sum, row) => sum + units(row.total), 0n);
      const adjusted = units(document.total) + debits - credits;
      return { rows: [{ total: amount(adjusted), paid_amount: amount(paid), balance_amount: amount(adjusted - paid),
        payment_count: String(records.filter(row => row.record_type === 'PAYMENT').length),
        reversal_count: String(records.filter(row => row.record_type === 'REVERSAL').length) }] };
    }
    if (statement === sql.insertActivity) { state.activities.push(values); return { rows: [{ id: randomUUID() }] }; }
    if (statement === sql.insertReceipt) {
      const row = { intent_digest: values[4], result_projection: JSON.parse(values[5]) };
      state.receipts.set(values.slice(0, 3).join(':'), row); return { rows: [row] };
    }
    throw new Error(`Unexpected query: ${statement}`);
  } };
  const repository = createPlatformBillingRepository({ id: randomUUID, audit: async (received, event) => {
    assert.equal(received, client); state.audit.push(event);
    if (auditFailure && event.eventCode === 'PLATFORM_BILLING_PAYMENT_RECORDED') throw auditFailure;
  } });
  return { organizationId, actorId, cycleId, state, client, repository };
}

async function issueInvoice(f, overrides = {}) {
  return f.repository.documentRecord(f.client, { organizationId: f.organizationId, cycleId: f.cycleId,
    actorId: f.actorId, command: documentCommand(overrides) });
}

test('primary external document transitions the cycle atomically and replays idempotently', async () => {
  const f = fixture(), input = documentCommand();
  const result = await f.repository.documentRecord(f.client, { organizationId: f.organizationId, cycleId: f.cycleId,
    actorId: f.actorId, command: input });
  assert.deepEqual({ cycleState: result.cycleState, cycleRevision: result.cycleRevision,
    documentState: result.documentState }, { cycleState: 'ISSUED', cycleRevision: 3, documentState: 'ISSUED' });
  assert.equal(f.state.documentRevisions.length, 1);
  assert.equal(f.state.cycleRevisions.length, 1);
  assert.deepEqual(await f.repository.documentRecord(f.client, { organizationId: f.organizationId, cycleId: f.cycleId,
    actorId: f.actorId, command: input }), result);
  assert.equal(f.state.documents.size, 1);
  await assert.rejects(() => f.repository.documentRecord(f.client, { organizationId: f.organizationId,
    cycleId: f.cycleId, actorId: f.actorId, command: { ...input, documentNumber: 'FT 2026/2' } }),
  error => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('partial and full external credit notes preserve documents and credit the cycle only in full', async () => {
  const f = fixture(), invoice = await issueInvoice(f);
  const partial = await f.repository.documentRecord(f.client, { organizationId: f.organizationId, cycleId: f.cycleId,
    actorId: f.actorId, command: documentCommand({ documentType: 'CREDIT_NOTE', documentNumber: 'NC 2026/1',
      subtotal: '500', taxTotal: '115', total: '615', correctsDocumentId: invoice.documentId,
      expectedCycleRevision: 3, idempotencyKey: randomUUID() }) });
  assert.equal(partial.cycleState, 'ISSUED');
  const full = await f.repository.documentRecord(f.client, { organizationId: f.organizationId, cycleId: f.cycleId,
    actorId: f.actorId, command: documentCommand({ documentType: 'CREDIT_NOTE', documentNumber: 'NC 2026/2',
      subtotal: '500', taxTotal: '115', total: '615', correctsDocumentId: invoice.documentId,
      expectedCycleRevision: 3, idempotencyKey: randomUUID() }) });
  assert.equal(full.cycleState, 'CREDITED');
  assert.equal(f.state.documents.get(invoice.documentId).state, 'CREDITED');
  assert.equal(f.state.documents.size, 3);
  const cancelled = await f.repository.documentTransition(f.client, { organizationId: f.organizationId,
    documentId: full.documentId, actorId: f.actorId, command: command('documentTransition', {
      toState: 'CANCELLED', reason: 'Nota de crédito anulada no sistema fiscal', expectedRevision: 1,
      idempotencyKey: randomUUID()
    }) });
  assert.equal(cancelled.cycleState, 'ISSUED');
  assert.equal(f.state.documents.get(invoice.documentId).state, 'ISSUED');
  assert.equal(f.state.documents.get(full.documentId).state, 'CANCELLED');
});

test('payments derive partial, paid and reversed balances without changing prior records', async () => {
  const f = fixture(), invoice = await issueInvoice(f);
  const first = await f.repository.paymentRecord(f.client, { organizationId: f.organizationId,
    documentId: invoice.documentId, actorId: f.actorId, command: paymentCommand() });
  assert.deepEqual({ paid: first.paidAmount, balance: first.balanceAmount, state: first.paymentState },
    { paid: '400', balance: '830', state: 'PARTIALLY_PAID' });
  const second = await f.repository.paymentRecord(f.client, { organizationId: f.organizationId,
    documentId: invoice.documentId, actorId: f.actorId,
    command: paymentCommand({ amount: '830', externalReference: 'TRX-2', idempotencyKey: randomUUID() }) });
  assert.equal(second.paymentState, 'PAID');
  const reversal = await f.repository.paymentReverse(f.client, { organizationId: f.organizationId,
    paymentId: first.paymentId, actorId: f.actorId, command: command('paymentReverse', {
      amount: '400', reversedOn: '2026-01-21', reason: 'Transferência devolvida', idempotencyKey: randomUUID()
    }) });
  assert.deepEqual({ paid: reversal.paidAmount, balance: reversal.balanceAmount, state: reversal.paymentState },
    { paid: '830', balance: '400', state: 'PARTIALLY_PAID' });
  assert.equal(f.state.payments.get(first.paymentId).record_type, 'PAYMENT');
  assert.equal(f.state.payments.size, 3);
});

test('fully reversed payment yields REVERSED and F7 failure leaves no receipt', async () => {
  const f = fixture(), invoice = await issueInvoice(f);
  const payment = await f.repository.paymentRecord(f.client, { organizationId: f.organizationId,
    documentId: invoice.documentId, actorId: f.actorId, command: paymentCommand({ amount: '1230' }) });
  const reversal = await f.repository.paymentReverse(f.client, { organizationId: f.organizationId,
    paymentId: payment.paymentId, actorId: f.actorId, command: command('paymentReverse', {
      amount: '1230', reversedOn: '2026-01-21', reason: 'Pagamento devolvido', idempotencyKey: randomUUID()
    }) });
  assert.equal(reversal.paymentState, 'REVERSED');
  const failure = Object.assign(new Error('F7 unavailable'), { code: 'AUDIT_FAILURE' });
  const failed = fixture({ auditFailure: failure }), failedInvoice = await issueInvoice(failed);
  await assert.rejects(() => failed.repository.paymentRecord(failed.client, { organizationId: failed.organizationId,
    documentId: failedInvoice.documentId, actorId: failed.actorId, command: paymentCommand() }),
  error => error === failure);
  const key = [...failed.state.receipts.keys()].find(value => value.includes('PAYMENT_RECORD'));
  assert.equal(key, undefined);
});

test('document and payment guards reject stale revisions, wrong currency and paid cancellation', async () => {
  const f = fixture();
  await assert.rejects(() => issueInvoice(f, { expectedCycleRevision: 1 }), error => error.code === 'STALE_REVISION');
  await assert.rejects(() => issueInvoice(f, { currency: 'USD' }), error => error.code === 'BILLING_CURRENCY_MISMATCH');
  const invoice = await issueInvoice(f);
  await f.repository.paymentRecord(f.client, { organizationId: f.organizationId, documentId: invoice.documentId,
    actorId: f.actorId, command: paymentCommand() });
  await assert.rejects(() => f.repository.documentRecord(f.client, { organizationId: f.organizationId,
    cycleId: f.cycleId, actorId: f.actorId, command: documentCommand({ documentType: 'CREDIT_NOTE',
      documentNumber: 'NC EXCESS/1', subtotal: '731.707317', taxTotal: '168.292683', total: '900',
      correctsDocumentId: invoice.documentId, expectedCycleRevision: 3, idempotencyKey: randomUUID()
    }) }), error => error.code === 'BILLING_CREDIT_EXCEEDS_BALANCE');
  await assert.rejects(() => f.repository.documentTransition(f.client, { organizationId: f.organizationId,
    documentId: invoice.documentId, actorId: f.actorId, command: command('documentTransition', {
      toState: 'CANCELLED', reason: 'Anulação externa', expectedRevision: 1, idempotencyKey: randomUUID()
    }) }), error => error.code === 'BILLING_DOCUMENT_HAS_PAYMENTS');
});

test('an issued debit note cannot be cancelled when its removal would leave payments above the adjusted total', async () => {
  const f = fixture(), invoice = await issueInvoice(f);
  const debit = await f.repository.documentRecord(f.client, { organizationId: f.organizationId, cycleId: f.cycleId,
    actorId: f.actorId, command: documentCommand({ documentType: 'DEBIT_NOTE', documentNumber: 'ND 2026/1',
      subtotal: '81.300813', taxTotal: '18.699187', total: '100', correctsDocumentId: invoice.documentId,
      expectedCycleRevision: 3, idempotencyKey: randomUUID() }) });
  await f.repository.paymentRecord(f.client, { organizationId: f.organizationId, documentId: invoice.documentId,
    actorId: f.actorId, command: paymentCommand({ amount: '1300' }) });
  await assert.rejects(() => f.repository.documentTransition(f.client, { organizationId: f.organizationId,
    documentId: debit.documentId, actorId: f.actorId, command: command('documentTransition', {
      toState: 'CANCELLED', reason: 'Debit note cancelled externally', expectedRevision: 1,
      idempotencyKey: randomUUID()
    }) }), error => error.code === 'BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE');
  assert.equal(f.state.documents.get(debit.documentId).state, 'ISSUED');
});
