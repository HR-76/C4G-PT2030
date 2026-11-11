'use strict';

const { randomUUID } = require('node:crypto');

const STATUS = Object.freeze({
  INVALID_INPUT: 400,
  C4G_ADMIN_REQUIRED: 403,
  RESOURCE_NOT_AVAILABLE: 404,
  STALE_REVISION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STATE_CONFLICT: 409,
  CYCLE_TRANSITION_NOT_ALLOWED: 409,
  DOCUMENT_TRANSITION_NOT_ALLOWED: 409,
  BILLING_DOCUMENT_DUPLICATE: 409,
  BILLING_CYCLE_NOT_EDITABLE: 409,
  BILLING_CYCLE_NOT_READY: 409,
  BILLING_CYCLE_NOT_ISSUED: 409,
  BILLING_CURRENCY_MISMATCH: 409,
  BILLING_DOCUMENT_TOTAL_MISMATCH: 409,
  BILLING_CORRECTION_TARGET_INVALID: 409,
  BILLING_CORRECTION_TARGET_NOT_ISSUED: 409,
  BILLING_CREDIT_EXCEEDS_BALANCE: 409,
  BILLING_CREDIT_EXCEEDS_DOCUMENT: 409,
  BILLING_DOCUMENT_HAS_PAYMENTS: 409,
  BILLING_DOCUMENT_NOT_FULLY_CREDITED: 409,
  BILLING_DOCUMENT_NOT_PAYABLE: 409,
  BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE: 409,
  BILLING_PAYMENT_EXCEEDS_BALANCE: 409,
  BILLING_REVERSAL_INVALID: 409
});

const NOT_FOUND = new Set([
  'BILLING_ACCOUNT_VERSION_NOT_FOUND', 'BILLING_CYCLE_NOT_FOUND',
  'BILLING_DOCUMENT_NOT_FOUND', 'BILLING_PAYMENT_NOT_FOUND'
]);

const DATABASE_CONFLICTS = Object.freeze([
  'BILLING_CYCLE_NOT_READY', 'BILLING_CYCLE_NOT_ISSUED', 'BILLING_DOCUMENT_TOTAL_MISMATCH',
  'BILLING_CORRECTION_TARGET_INVALID', 'BILLING_CREDIT_EXCEEDS_BALANCE',
  'BILLING_DOCUMENT_NOT_PAYABLE', 'BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE',
  'BILLING_PAYMENT_EXCEEDS_BALANCE', 'BILLING_REVERSAL_INVALID'
]);

function publicError(error) {
  const sourceCode = String(error?.code || '');
  if (NOT_FOUND.has(sourceCode)) return Object.freeze({ code: 'RESOURCE_NOT_AVAILABLE', status: 404 });
  if (Object.hasOwn(STATUS, sourceCode)) return Object.freeze({ code: sourceCode, status: STATUS[sourceCode] });
  const message = String(error?.message || '');
  const databaseCode = DATABASE_CONFLICTS.find(code => message.includes(code));
  if (databaseCode) return Object.freeze({ code: databaseCode, status: 409 });
  if (sourceCode === '23505') {
    const duplicateDocument = /billing_fiscal_document_(?:source|primary)|source_code.*issuer_reference/i
      .test(`${error?.constraint || ''} ${message}`);
    return Object.freeze({ code: duplicateDocument ? 'BILLING_DOCUMENT_DUPLICATE' : 'STATE_CONFLICT', status: 409 });
  }
  if (['23503', '40001', '40P01', '55P03'].includes(sourceCode)) {
    return Object.freeze({ code: 'STATE_CONFLICT', status: 409 });
  }
  return Object.freeze({ code: 'SERVICE_UNAVAILABLE', status: 503 });
}

function hasBody(request) {
  if (request.body === undefined) return false;
  return !request.body || Array.isArray(request.body)
    || Object.getPrototypeOf(request.body) !== Object.prototype
    || Object.keys(request.body).length > 0;
}

function queryInput(request) {
  return Object.fromEntries(Object.entries(request.query || {}));
}

function createPlatformBillingRouter({ express, service, authenticate, pdfs=null }) {
  const methods = [
    'summary', 'cycles', 'cycleDetail', 'accountDetail', 'accountWrite', 'cycleCreate',
    'cycleEdit', 'cycleTransition', 'documentRecord', 'documentTransition',
    'paymentRecord', 'paymentReverse'
  ];
  if (!express?.Router || typeof authenticate !== 'function'
      || methods.some(method => typeof service?.[method] !== 'function')) {
    throw new TypeError('Platform billing HTTP composition is incomplete.');
  }
  const router = express.Router();
  router.use((request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return next();
  }, authenticate, (request, response, next) => {
    if (request.method === 'HEAD') {
      return response.status(405).json({ error: { code: 'OPERATION_NOT_AVAILABLE' }, correlationId: randomUUID() });
    }
    return next();
  });

  const handle = (status, mode, work) => async (request, response) => {
    const correlationId = randomUUID();
    try {
      if ((mode === 'read' && hasBody(request))
          || (mode === 'command' && Object.keys(request.query || {}).length > 0)) {
        throw Object.assign(new Error('Platform billing request refused.'), { code: 'INVALID_INPUT' });
      }
      return response.status(status).json(await work(request));
    } catch (error) {
      const failure = publicError(error);
      return response.status(failure.status).json({ error: { code: failure.code }, correlationId });
    }
  };

  require('../customerBilling/pdfHttp').mountPdfRoutes(router,{express,service:pdfs});
  router.get('/summary', handle(200, 'read', request => service.summary(queryInput(request), request)));
  router.get('/cycles', handle(200, 'read', request => service.cycles(queryInput(request), request)));
  router.get('/cycles/:cycleId', handle(200, 'read', request => service.cycleDetail(
    request.params.cycleId, queryInput(request), request
  )));
  router.get('/organizations/:organizationId/account', handle(200, 'read', request => service.accountDetail(
    request.params.organizationId, queryInput(request), request
  )));
  router.put('/organizations/:organizationId/account', handle(200, 'command', request => service.accountWrite(
    request.params.organizationId, request.body, request
  )));
  router.post('/cycles', handle(201, 'command', request => service.cycleCreate(request.body, request)));
  router.put('/cycles/:cycleId', handle(200, 'command', request => service.cycleEdit(
    request.params.cycleId, request.body, request
  )));
  router.post('/cycles/:cycleId/transitions', handle(200, 'command', request => service.cycleTransition(
    request.params.cycleId, request.body, request
  )));
  router.post('/cycles/:cycleId/documents', handle(201, 'command', request => service.documentRecord(
    request.params.cycleId, request.body, request
  )));
  router.post('/documents/:documentId/transitions', handle(200, 'command', request => service.documentTransition(
    request.params.documentId, request.body, request
  )));
  router.post('/documents/:documentId/payments', handle(201, 'command', request => service.paymentRecord(
    request.params.documentId, request.body, request
  )));
  router.post('/payments/:paymentId/reversals', handle(201, 'command', request => service.paymentReverse(
    request.params.paymentId, request.body, request
  )));
  router.use((request, response) => response.status(405).json({
    error: { code: 'OPERATION_NOT_AVAILABLE' }, correlationId: randomUUID()
  }));
  return router;
}

module.exports = { STATUS, createPlatformBillingRouter, publicError, queryInput };
