'use strict';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const DECIMAL = /^(0|[1-9]\d{0,13})(\.\d{1,6})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;
const TAX_IDENTIFIER = /^[A-Z0-9][A-Z0-9 .+\-/]{0,31}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CYCLE_STATES = Object.freeze(['DRAFT', 'READY_TO_ISSUE', 'ISSUED', 'CREDITED', 'CANCELLED']);
const CYCLE_COMMAND_STATES = Object.freeze(['READY_TO_ISSUE', 'CANCELLED']);
const DOCUMENT_SOURCES = Object.freeze(['TOCONLINE', 'FE_AP', 'OTHER']);
const DOCUMENT_TYPES = Object.freeze(['INVOICE', 'SIMPLIFIED_INVOICE', 'INVOICE_RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE']);
const DOCUMENT_STATES = Object.freeze(['ISSUED', 'CREDITED', 'CANCELLED']);
const PAYMENT_METHODS = Object.freeze(['BANK_TRANSFER', 'DIRECT_DEBIT', 'CARD_PROVIDER', 'OTHER']);
const PAYMENT_STATES = Object.freeze(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REVERSED']);

function fail(code = 'INVALID_INPUT') {
  throw Object.assign(new Error('Platform billing request refused.'), { code });
}

function exact(value, keys) {
  if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail();
  return value;
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail();
  return value.toLowerCase();
}

function text(value, { min = 0, max, nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length < min || value.length > max
      || value !== value.trim() || value !== value.normalize('NFC') || CONTROL.test(value)) fail();
  return value;
}

function nullableText(value, max) {
  return text(value, { max, nullable: true });
}

function revision(value, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) fail();
  return value;
}

function civilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail();
  return value;
}

function nullableCivilDate(value) {
  return value === null ? null : civilDate(value);
}

function decimal(value, { allowZero = false } = {}) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) fail();
  const [integer, fraction = ''] = value.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  const normalized = normalizedFraction ? `${integer}.${normalizedFraction}` : integer;
  if (!allowZero && normalized === '0') fail();
  return normalized;
}

function decimalUnits(value) {
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}

function currency(value) {
  if (typeof value !== 'string' || !CURRENCY.test(value)) fail();
  return value;
}

function enumValue(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function email(value) {
  const result = text(value, { min: 3, max: 254 });
  if (!EMAIL.test(result)) fail();
  return result;
}

function nullableUuid(value) {
  return value === null ? null : uuid(value);
}

function account(raw) {
  exact(raw, [
    'idempotencyKey', 'expectedRevision', 'legalName', 'taxCountry', 'taxIdentifier',
    'addressLine1', 'addressLine2', 'postalCode', 'locality', 'region', 'billingEmail',
    'contactName', 'externalSource', 'externalCustomerRef', 'paymentTermsDays', 'notes'
  ]);
  const taxCountry = text(raw.taxCountry, { min: 2, max: 2 });
  const taxIdentifier = text(raw.taxIdentifier, { min: 1, max: 32 });
  if (!COUNTRY.test(taxCountry) || !TAX_IDENTIFIER.test(taxIdentifier)
      || (taxCountry === 'PT' && !/^[1-9][0-9]{8}$/.test(taxIdentifier))) fail();
  if (!Number.isSafeInteger(raw.paymentTermsDays) || raw.paymentTermsDays < 0 || raw.paymentTermsDays > 365) fail();
  return Object.freeze({
    idempotencyKey: uuid(raw.idempotencyKey),
    expectedRevision: revision(raw.expectedRevision, { allowZero: true }),
    legalName: text(raw.legalName, { min: 1, max: 200 }),
    taxCountry,
    taxIdentifier,
    addressLine1: text(raw.addressLine1, { min: 1, max: 200 }),
    addressLine2: nullableText(raw.addressLine2, 200),
    postalCode: text(raw.postalCode, { min: 1, max: 32 }),
    locality: text(raw.locality, { min: 1, max: 120 }),
    region: nullableText(raw.region, 120),
    billingEmail: email(raw.billingEmail),
    contactName: nullableText(raw.contactName, 160),
    externalSource: raw.externalSource === null ? null : enumValue(raw.externalSource, DOCUMENT_SOURCES),
    externalCustomerRef: nullableText(raw.externalCustomerRef, 160),
    paymentTermsDays: raw.paymentTermsDays,
    notes: nullableText(raw.notes, 4000)
  });
}

const cycleFields = [
  'accountVersionId', 'periodStart', 'periodEnd', 'serviceDescription', 'currency',
  'amount', 'plannedIssueDate', 'dueDate', 'contractReference', 'notes'
];

function cycle(raw, { create }) {
  exact(raw, [
    ...(create ? ['organizationId'] : ['expectedRevision']), ...cycleFields, 'idempotencyKey'
  ]);
  const periodStart = civilDate(raw.periodStart);
  const periodEnd = civilDate(raw.periodEnd);
  if (periodStart > periodEnd) fail();
  return Object.freeze({
    ...(create ? { organizationId: uuid(raw.organizationId) } : { expectedRevision: revision(raw.expectedRevision) }),
    accountVersionId: uuid(raw.accountVersionId),
    periodStart,
    periodEnd,
    serviceDescription: text(raw.serviceDescription, { min: 1, max: 500 }),
    currency: currency(raw.currency),
    amount: decimal(raw.amount),
    plannedIssueDate: nullableCivilDate(raw.plannedIssueDate),
    dueDate: civilDate(raw.dueDate),
    contractReference: nullableText(raw.contractReference, 160),
    notes: nullableText(raw.notes, 4000),
    idempotencyKey: uuid(raw.idempotencyKey)
  });
}

function cycleTransition(raw) {
  exact(raw, ['toState', 'reason', 'expectedRevision', 'idempotencyKey']);
  const toState = enumValue(raw.toState, CYCLE_COMMAND_STATES);
  if (toState === 'CANCELLED' && raw.reason === null) fail();
  return Object.freeze({
    toState,
    reason: raw.reason === null ? null : text(raw.reason, { min: 1, max: 500 }),
    expectedRevision: revision(raw.expectedRevision),
    idempotencyKey: uuid(raw.idempotencyKey)
  });
}

function document(raw) {
  exact(raw, [
    'sourceCode', 'issuerReference', 'documentType', 'documentNumber', 'externalDocumentId',
    'issueDate', 'dueDate', 'currency', 'subtotal', 'taxTotal', 'total', 'correctsDocumentId',
    'expectedCycleRevision', 'idempotencyKey'
  ]);
  const documentType = enumValue(raw.documentType, DOCUMENT_TYPES);
  const correctsDocumentId = nullableUuid(raw.correctsDocumentId);
  const correction = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(documentType);
  if (correction !== Boolean(correctsDocumentId)) fail();
  const subtotal = decimal(raw.subtotal, { allowZero: true });
  const taxTotal = decimal(raw.taxTotal, { allowZero: true });
  const total = decimal(raw.total);
  if (decimalUnits(subtotal) + decimalUnits(taxTotal) !== decimalUnits(total)) fail();
  return Object.freeze({
    sourceCode: enumValue(raw.sourceCode, DOCUMENT_SOURCES),
    issuerReference: text(raw.issuerReference, { min: 1, max: 160 }),
    documentType,
    documentNumber: text(raw.documentNumber, { min: 1, max: 160 }),
    externalDocumentId: nullableText(raw.externalDocumentId, 200),
    issueDate: civilDate(raw.issueDate),
    dueDate: civilDate(raw.dueDate),
    currency: currency(raw.currency),
    subtotal,
    taxTotal,
    total,
    correctsDocumentId,
    expectedCycleRevision: revision(raw.expectedCycleRevision),
    idempotencyKey: uuid(raw.idempotencyKey)
  });
}

function documentTransition(raw) {
  exact(raw, ['toState', 'reason', 'expectedRevision', 'idempotencyKey']);
  return Object.freeze({
    toState: enumValue(raw.toState, ['CREDITED', 'CANCELLED']),
    reason: text(raw.reason, { min: 1, max: 500 }),
    expectedRevision: revision(raw.expectedRevision),
    idempotencyKey: uuid(raw.idempotencyKey)
  });
}

function payment(raw) {
  exact(raw, ['amount', 'currency', 'paidOn', 'methodCode', 'externalReference', 'note', 'idempotencyKey']);
  return Object.freeze({
    amount: decimal(raw.amount),
    currency: currency(raw.currency),
    paidOn: civilDate(raw.paidOn),
    methodCode: enumValue(raw.methodCode, PAYMENT_METHODS),
    externalReference: nullableText(raw.externalReference, 200),
    note: nullableText(raw.note, 1000),
    idempotencyKey: uuid(raw.idempotencyKey)
  });
}

function reversal(raw) {
  exact(raw, ['amount', 'reversedOn', 'reason', 'idempotencyKey']);
  return Object.freeze({
    amount: decimal(raw.amount),
    reversedOn: civilDate(raw.reversedOn),
    reason: text(raw.reason, { min: 1, max: 500 }),
    idempotencyKey: uuid(raw.idempotencyKey)
  });
}

function command(method, raw) {
  if (method === 'accountWrite') return account(raw);
  if (method === 'cycleCreate') return cycle(raw, { create: true });
  if (method === 'cycleEdit') return cycle(raw, { create: false });
  if (method === 'cycleTransition') return cycleTransition(raw);
  if (method === 'documentRecord') return document(raw);
  if (method === 'documentTransition') return documentTransition(raw);
  if (method === 'paymentRecord') return payment(raw);
  if (method === 'paymentReverse') return reversal(raw);
  fail();
}

function query(method, raw = {}) {
  if (!raw || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) fail();
  if (method === 'summary') {
    if (Object.keys(raw).some(key => !['from', 'to', 'currency'].includes(key))) fail();
    const from = raw.from === undefined ? null : civilDate(raw.from);
    const to = raw.to === undefined ? null : civilDate(raw.to);
    if (from && to && from > to) fail();
    return Object.freeze({ from, to, currency: raw.currency === undefined ? null : currency(raw.currency) });
  }
  if (method === 'cycles') {
    if (Object.keys(raw).some(key => ![
      'q', 'organizationId', 'from', 'to', 'cycleStatus', 'paymentStatus', 'overdue', 'currency', 'page'
    ].includes(key))) fail();
    const from = raw.from === undefined ? null : civilDate(raw.from);
    const to = raw.to === undefined ? null : civilDate(raw.to);
    if (from && to && from > to) fail();
    const page = raw.page === undefined ? 1 : Number(raw.page);
    if (!/^[1-9]\d{0,5}$/.test(String(raw.page === undefined ? 1 : raw.page)) || !Number.isSafeInteger(page)) fail();
    return Object.freeze({
      q: raw.q === undefined ? '' : text(raw.q, { max: 120 }),
      organizationId: raw.organizationId === undefined ? null : uuid(raw.organizationId),
      from,
      to,
      cycleStatus: raw.cycleStatus === undefined ? null : enumValue(raw.cycleStatus, CYCLE_STATES),
      paymentStatus: raw.paymentStatus === undefined ? null : enumValue(raw.paymentStatus, PAYMENT_STATES),
      overdue: raw.overdue === undefined ? null : enumValue(raw.overdue, ['true', 'false']) === 'true',
      currency: raw.currency === undefined ? null : currency(raw.currency),
      page
    });
  }
  if (['cycleDetail', 'accountDetail'].includes(method)) {
    exact(raw, []);
    return Object.freeze({});
  }
  fail();
}

module.exports = {
  CYCLE_STATES, DOCUMENT_SOURCES, DOCUMENT_STATES, DOCUMENT_TYPES, PAYMENT_METHODS, PAYMENT_STATES,
  UUID, civilDate, command, currency, decimal, exact, fail, query, revision, uuid
};
