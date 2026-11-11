'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { civilDate, command, decimal, query } = require('../src/platformBilling/contracts');

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function rejects(code, work) {
  assert.throws(work, error => error?.code === code && error.message === 'Platform billing request refused.');
}

function account(overrides = {}) {
  return {
    idempotencyKey: ID,
    expectedRevision: 0,
    legalName: 'Entidade Exemplo, Lda.',
    taxCountry: 'PT',
    taxIdentifier: '501234567',
    addressLine1: 'Rua Central, 10',
    addressLine2: null,
    postalCode: '1000-100',
    locality: 'Lisboa',
    region: null,
    billingEmail: 'faturacao@example.pt',
    contactName: 'Equipa Financeira',
    externalSource: 'TOCONLINE',
    externalCustomerRef: 'CLIENTE-42',
    paymentTermsDays: 30,
    notes: null,
    ...overrides
  };
}

function cycle(overrides = {}) {
  return {
    organizationId: ID,
    accountVersionId: OTHER_ID,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    serviceDescription: 'Subscrição anual da C4G Funding Platform',
    currency: 'EUR',
    amount: '12000.000000',
    plannedIssueDate: '2026-01-05',
    dueDate: '2026-02-04',
    contractReference: null,
    notes: null,
    idempotencyKey: ID,
    ...overrides
  };
}

function document(overrides = {}) {
  return {
    sourceCode: 'TOCONLINE',
    issuerReference: 'C4G-PT',
    documentType: 'INVOICE',
    documentNumber: 'FT 2026/42',
    externalDocumentId: 'doc-42',
    issueDate: '2026-01-05',
    dueDate: '2026-02-04',
    currency: 'EUR',
    subtotal: '9756.097561',
    taxTotal: '2243.902439',
    total: '12000.000000',
    correctsDocumentId: null,
    expectedCycleRevision: 2,
    idempotencyKey: ID,
    ...overrides
  };
}

test('monetary values are exact canonical strings and never JavaScript numbers', () => {
  assert.equal(decimal('12000.000000'), '12000');
  assert.equal(decimal('0.010000'), '0.01');
  assert.equal(decimal('0', { allowZero: true }), '0');
  for (const value of [12000, '01', '-1', '1.0000001', '100000000000000']) {
    rejects('INVALID_INPUT', () => decimal(value));
  }
  rejects('INVALID_INPUT', () => decimal('0'));
});

test('business dates are real civil dates and are not converted through local time', () => {
  assert.equal(civilDate('2024-02-29'), '2024-02-29');
  for (const value of ['2023-02-29', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00Z']) {
    rejects('INVALID_INPUT', () => civilDate(value));
  }
});

test('billing account accepts create revision zero and closes the payload', () => {
  const parsed = command('accountWrite', account());
  assert.equal(parsed.expectedRevision, 0);
  assert.equal(parsed.taxIdentifier, '501234567');
  assert.equal(Object.isFrozen(parsed), true);
  rejects('INVALID_INPUT', () => command('accountWrite', { ...account(), organizationId: OTHER_ID }));
  rejects('INVALID_INPUT', () => command('accountWrite', account({ taxIdentifier: '012345678' })));
  rejects('INVALID_INPUT', () => command('accountWrite', account({ billingEmail: 'invalid' })));
  rejects('INVALID_INPUT', () => command('accountWrite', account({ legalName: ' Entidade' })));
});

test('cycle contracts support arbitrary valid periods and canonicalize the amount', () => {
  const parsed = command('cycleCreate', cycle());
  assert.equal(parsed.amount, '12000');
  assert.equal(parsed.periodStart, '2026-01-01');
  assert.equal(parsed.periodEnd, '2026-12-31');
  rejects('INVALID_INPUT', () => command('cycleCreate', cycle({ periodStart: '2026-12-31', periodEnd: '2026-01-01' })));
  rejects('INVALID_INPUT', () => command('cycleCreate', cycle({ currency: 'eur' })));
  rejects('INVALID_INPUT', () => command('cycleCreate', cycle({ amount: 12000 })));

  const { organizationId, ...edit } = cycle({ expectedRevision: 4 });
  const parsedEdit = command('cycleEdit', edit);
  assert.equal(parsedEdit.expectedRevision, 4);
});

test('cycle transition only admits the explicit phase A commands', () => {
  const ready = command('cycleTransition', {
    toState: 'READY_TO_ISSUE', reason: null, expectedRevision: 1, idempotencyKey: ID
  });
  assert.equal(ready.toState, 'READY_TO_ISSUE');
  const cancelled = command('cycleTransition', {
    toState: 'CANCELLED', reason: 'Contrato cessado', expectedRevision: 2, idempotencyKey: ID
  });
  assert.equal(cancelled.reason, 'Contrato cessado');
  rejects('INVALID_INPUT', () => command('cycleTransition', {
    toState: 'ISSUED', reason: null, expectedRevision: 1, idempotencyKey: ID
  }));
  rejects('INVALID_INPUT', () => command('cycleTransition', {
    toState: 'CANCELLED', reason: null, expectedRevision: 1, idempotencyKey: ID
  }));
});

test('external fiscal documents distinguish primary and corrective documents', () => {
  const invoice = command('documentRecord', document());
  assert.equal(invoice.total, '12000');
  assert.equal(invoice.correctsDocumentId, null);
  const credit = command('documentRecord', document({
    documentType: 'CREDIT_NOTE', documentNumber: 'NC 2026/1', correctsDocumentId: OTHER_ID
  }));
  assert.equal(credit.correctsDocumentId, OTHER_ID);
  rejects('INVALID_INPUT', () => command('documentRecord', document({ documentType: 'CREDIT_NOTE' })));
  rejects('INVALID_INPUT', () => command('documentRecord', document({ correctsDocumentId: OTHER_ID })));
  rejects('INVALID_INPUT', () => command('documentRecord', document({ total: '0' })));
  rejects('INVALID_INPUT', () => command('documentRecord', document({ taxTotal: '2243.90' })));
});

test('payment and reversal contracts preserve positive exact amounts', () => {
  const payment = command('paymentRecord', {
    amount: '4000.00', currency: 'EUR', paidOn: '2026-01-20', methodCode: 'BANK_TRANSFER',
    externalReference: 'TRX-42', note: null, idempotencyKey: ID
  });
  assert.equal(payment.amount, '4000');
  const reversal = command('paymentReverse', {
    amount: '4000', reversedOn: '2026-01-22', reason: 'Transferência devolvida', idempotencyKey: ID
  });
  assert.equal(reversal.amount, '4000');
  rejects('INVALID_INPUT', () => command('paymentRecord', {
    amount: '1', currency: 'EUR', paidOn: '2026-01-20', methodCode: 'CASH',
    externalReference: null, note: null, idempotencyKey: ID
  }));
  rejects('INVALID_INPUT', () => command('paymentReverse', {
    amount: '0', reversedOn: '2026-01-22', reason: 'Correção', idempotencyKey: ID
  }));
});

test('unknown commands and malformed ids fail with the public closed error', () => {
  rejects('INVALID_INPUT', () => command('unknown', {}));
  rejects('INVALID_INPUT', () => command('accountWrite', account({ idempotencyKey: 'not-a-uuid' })));
});

test('summary and cycle-list queries close filters and normalize pagination', () => {
  assert.deepEqual(query('summary', { from: '2026-01-01', to: '2026-12-31', currency: 'EUR' }), {
    from: '2026-01-01', to: '2026-12-31', currency: 'EUR'
  });
  const list = query('cycles', {
    q: 'Município', organizationId: ID, cycleStatus: 'ISSUED', paymentStatus: 'PARTIALLY_PAID',
    overdue: 'true', currency: 'EUR', page: '2'
  });
  assert.equal(list.page, 2);
  assert.equal(list.overdue, true);
  assert.equal(list.from, null);
  rejects('INVALID_INPUT', () => query('cycles', { page: '0' }));
  rejects('INVALID_INPUT', () => query('cycles', { overdue: '1' }));
  rejects('INVALID_INPUT', () => query('cycles', { sql: 'select' }));
  rejects('INVALID_INPUT', () => query('summary', { from: '2026-12-31', to: '2026-01-01' }));
});
