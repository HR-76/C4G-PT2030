'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { canonicalize } = require('../organizationalProfile/canonicalization');
const { createUuidV7 } = require('../audit/uuidV7');
const { fail } = require('./contracts');
const { money, moneyUnits, sameMoney, adjustedTotal, paymentProjection } = require('./moneyProjection');
const { createBillingAudit } = require('./audit');
const sql = require('./sql');

const OPERATIONS = Object.freeze({
  ACCOUNT_WRITE: 'ACCOUNT_WRITE',
  CYCLE_CREATE: 'CYCLE_CREATE',
  CYCLE_EDIT: 'CYCLE_EDIT',
  CYCLE_TRANSITION: 'CYCLE_TRANSITION',
  DOCUMENT_RECORD: 'DOCUMENT_RECORD',
  DOCUMENT_TRANSITION: 'DOCUMENT_TRANSITION',
  PAYMENT_RECORD: 'PAYMENT_RECORD',
  PAYMENT_REVERSE: 'PAYMENT_REVERSE'
});

const PRIMARY_DOCUMENT_TYPES = Object.freeze(['INVOICE', 'SIMPLIFIED_INVOICE', 'INVOICE_RECEIPT']);
const PAGE_SIZE = 25;

function first(result) { return result.rows[0]; }
function integer(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail('BILLING_DATA_INVALID');
  return parsed;
}
function count(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail('BILLING_DATA_INVALID');
  return parsed;
}
function instant(value) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) fail('BILLING_DATA_INVALID');
  return parsed.toISOString();
}
function digest(operationCode, organizationId, actorId, resourceId, command) {
  return createHash('sha256').update(canonicalize({ operationCode, organizationId, actorId, resourceId, command })).digest('hex');
}
function projection(value) {
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; } catch { fail('BILLING_DATA_INVALID'); }
  if (!parsed || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) fail('BILLING_DATA_INVALID');
  return Object.freeze({ ...parsed });
}
function accountVersionValues(id, accountId, organizationId, version, command, actorId) {
  return [id, accountId, organizationId, version, command.legalName, command.taxCountry, command.taxIdentifier,
    command.addressLine1, command.addressLine2, command.postalCode, command.locality, command.region,
    command.billingEmail, command.contactName, command.externalSource, command.externalCustomerRef,
    command.paymentTermsDays, command.notes, actorId];
}
function cycleValues(id, command, actorId) {
  return [id, command.organizationId, command.accountVersionId, command.periodStart, command.periodEnd,
    command.serviceDescription, command.currency, command.amount, command.plannedIssueDate, command.dueDate,
    command.contractReference, command.notes, actorId];
}
function cycleEditValues(id, organizationId, command, actorId) {
  return [id, organizationId, command.accountVersionId, command.periodStart, command.periodEnd,
    command.serviceDescription, command.currency, command.amount, command.plannedIssueDate, command.dueDate,
    command.contractReference, command.notes, actorId, command.expectedRevision];
}
function documentValues(id, cycleId, organizationId, command, actorId) {
  return [id, cycleId, organizationId, command.sourceCode, command.issuerReference, command.documentType,
    command.documentNumber, command.externalDocumentId, command.issueDate, command.dueDate, command.currency,
    command.subtotal, command.taxTotal, command.total, command.correctsDocumentId, actorId];
}
function cycleProjection(row) {
  return Object.freeze({
    cycleId: row.cycle_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationLegalName: row.organization_legal_name,
    accountVersionId: row.account_version_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    serviceDescription: row.service_description,
    currency: row.currency,
    cycleAmount: money(row.cycle_amount),
    plannedIssueDate: row.planned_issue_date,
    dueDate: row.due_date,
    contractReference: row.contract_reference,
    cycleState: row.cycle_state,
    cycleRevision: integer(row.cycle_revision),
    document: row.document_id ? Object.freeze({
      id: row.document_id,
      type: row.document_type,
      number: row.document_number,
      issueDate: row.issue_date,
      dueDate: row.document_due_date,
      state: row.document_state,
      revision: integer(row.document_revision)
    }) : null,
    adjustedTotal: money(row.adjusted_total),
    creditAmount: money(row.credit_amount),
    debitAmount: money(row.debit_amount),
    paidAmount: money(row.paid_amount),
    balanceAmount: money(row.balance_amount),
    paymentState: row.payment_state,
    overdue: row.overdue === true
  });
}

function createPlatformBillingRepository({
  id = randomUUID, correlationId = createUuidV7, audit = createBillingAudit()
} = {}) {
  if (typeof id !== 'function' || typeof correlationId !== 'function' || typeof audit !== 'function') {
    throw new TypeError('Platform billing repository composition is invalid.');
  }

  async function replay(client, organizationId, operationCode, requestKey, intentDigest) {
    const row = first(await client.query(sql.receiptByKey, [organizationId, operationCode, requestKey]));
    if (!row) return null;
    if (row.intent_digest !== intentDigest) fail('IDEMPOTENCY_CONFLICT');
    return projection(row.result_projection);
  }
  async function receipt(client, organizationId, operationCode, requestKey, actorId, intentDigest, result) {
    const row = first(await client.query(sql.insertReceipt,
      [organizationId, operationCode, requestKey, actorId, intentDigest, JSON.stringify(result)]));
    if (!row) fail('BILLING_WRITE_FAILED');
  }
  async function record(client, { organizationId, actorId, eventCode, resourceType, resourceId,
    previousRevision, newRevision, detailCode, requestKey, operationCode, correlation }) {
    if (!first(await client.query(sql.insertActivity, [organizationId, operationCode, actorId, eventCode,
      resourceType, resourceId, previousRevision, newRevision, detailCode, correlation, requestKey]))) {
      fail('BILLING_WRITE_FAILED');
    }
    await audit(client, {
      actorId, eventCode, resourceType, resourceId, previousRevision, newRevision, detailCode,
      correlationId: correlation, idempotencyKey: `billing:${operationCode}:${requestKey}`
    });
  }
  async function accountWrite(client, { organizationId, actorId, command }) {
    const operationCode = OPERATIONS.ACCOUNT_WRITE;
    const intentDigest = digest(operationCode, organizationId, actorId, organizationId, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    const current = first(await client.query(sql.accountByOrganizationForUpdate, [organizationId]));
    const previousRevision = current ? integer(current.revision) : 0;
    if (command.expectedRevision !== previousRevision) fail('STALE_REVISION');
    const accountId = current?.id || id();
    const nextRevision = previousRevision + 1;
    if (!current) await client.query(sql.insertAccount, [accountId, organizationId]);
    const accountVersionId = id();
    if (!first(await client.query(sql.insertAccountVersion,
      accountVersionValues(accountVersionId, accountId, organizationId, nextRevision, command, actorId)))) fail('BILLING_WRITE_FAILED');
    if (current && !first(await client.query(sql.updateAccountHead,
      [accountId, organizationId, nextRevision, previousRevision]))) fail('STALE_REVISION');
    const result = Object.freeze({ organizationId, accountId, accountVersionId, revision: nextRevision });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_ACCOUNT_CHANGED',
      resourceType: 'BILLING_ACCOUNT', resourceId: accountId, previousRevision, newRevision: nextRevision,
      detailCode: current ? 'ACCOUNT_VERSION_CREATED' : 'ACCOUNT_CREATED', requestKey: command.idempotencyKey,
      operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function cycleCreate(client, { actorId, command }) {
    const organizationId = command.organizationId, operationCode = OPERATIONS.CYCLE_CREATE;
    const intentDigest = digest(operationCode, organizationId, actorId, null, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    if (!first(await client.query(sql.accountVersionById, [command.accountVersionId, organizationId]))) {
      fail('BILLING_ACCOUNT_VERSION_NOT_FOUND');
    }
    const cycleId = id();
    const row = first(await client.query(sql.insertCycle, cycleValues(cycleId, command, actorId)));
    if (!row) fail('BILLING_WRITE_FAILED');
    if (!first(await client.query(sql.insertCycleRevision, [cycleId, actorId, null]))) fail('BILLING_WRITE_FAILED');
    const result = Object.freeze({ organizationId, cycleId, revision: 1, state: 'DRAFT' });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_CYCLE_CHANGED',
      resourceType: 'BILLING_CYCLE', resourceId: cycleId, previousRevision: 0, newRevision: 1,
      detailCode: 'CYCLE_CREATED', requestKey: command.idempotencyKey, operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function cycleEdit(client, { organizationId, cycleId, actorId, command }) {
    const operationCode = OPERATIONS.CYCLE_EDIT;
    const intentDigest = digest(operationCode, organizationId, actorId, cycleId, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    const current = first(await client.query(sql.cycleForUpdate, [cycleId, organizationId]));
    if (!current) fail('BILLING_CYCLE_NOT_FOUND');
    const previousRevision = integer(current.revision);
    if (command.expectedRevision !== previousRevision) fail('STALE_REVISION');
    if (current.state !== 'DRAFT') fail('BILLING_CYCLE_NOT_EDITABLE');
    if (!first(await client.query(sql.accountVersionById, [command.accountVersionId, organizationId]))) {
      fail('BILLING_ACCOUNT_VERSION_NOT_FOUND');
    }
    const changed = first(await client.query(sql.updateCycle, cycleEditValues(cycleId, organizationId, command, actorId)));
    if (!changed) fail('STALE_REVISION');
    const nextRevision = integer(changed.revision);
    if (!first(await client.query(sql.insertCycleRevision, [cycleId, actorId, null]))) fail('BILLING_WRITE_FAILED');
    const result = Object.freeze({ organizationId, cycleId, revision: nextRevision, state: changed.state });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_CYCLE_CHANGED',
      resourceType: 'BILLING_CYCLE', resourceId: cycleId, previousRevision, newRevision: nextRevision,
      detailCode: 'CYCLE_EDITED', requestKey: command.idempotencyKey, operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function cycleTransition(client, { organizationId, cycleId, actorId, command }) {
    const operationCode = OPERATIONS.CYCLE_TRANSITION;
    const intentDigest = digest(operationCode, organizationId, actorId, cycleId, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    const current = first(await client.query(sql.cycleForUpdate, [cycleId, organizationId]));
    if (!current) fail('BILLING_CYCLE_NOT_FOUND');
    const previousRevision = integer(current.revision);
    if (command.expectedRevision !== previousRevision) fail('STALE_REVISION');
    const allowed = current.state === 'DRAFT'
      ? ['READY_TO_ISSUE', 'CANCELLED'] : current.state === 'READY_TO_ISSUE' ? ['CANCELLED'] : [];
    if (!allowed.includes(command.toState)) fail('CYCLE_TRANSITION_NOT_ALLOWED');
    const changed = first(await client.query(sql.transitionCycle,
      [cycleId, organizationId, command.toState, actorId, previousRevision]));
    if (!changed) fail('STALE_REVISION');
    const nextRevision = integer(changed.revision);
    if (!first(await client.query(sql.insertCycleRevision, [cycleId, actorId, command.reason]))) fail('BILLING_WRITE_FAILED');
    const result = Object.freeze({ organizationId, cycleId, revision: nextRevision, state: command.toState });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_CYCLE_CHANGED',
      resourceType: 'BILLING_CYCLE', resourceId: cycleId, previousRevision, newRevision: nextRevision,
      detailCode: command.toState === 'CANCELLED' ? 'CYCLE_CANCELLED' : 'CYCLE_READY_TO_ISSUE',
      requestKey: command.idempotencyKey, operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function documentRecord(client, { organizationId, cycleId, actorId, command }) {
    const operationCode = OPERATIONS.DOCUMENT_RECORD;
    const intentDigest = digest(operationCode, organizationId, actorId, cycleId, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    const cycle = first(await client.query(sql.cycleForUpdate, [cycleId, organizationId]));
    if (!cycle) fail('BILLING_CYCLE_NOT_FOUND');
    const previousCycleRevision = integer(cycle.revision);
    if (command.expectedCycleRevision !== previousCycleRevision) fail('STALE_REVISION');
    if (cycle.currency !== command.currency) fail('BILLING_CURRENCY_MISMATCH');
    const primary = PRIMARY_DOCUMENT_TYPES.includes(command.documentType);
    let corrected = null;
    if (primary) {
      if (cycle.state !== 'READY_TO_ISSUE') fail('BILLING_CYCLE_NOT_READY');
      if (!sameMoney(cycle.amount, command.total)) fail('BILLING_DOCUMENT_TOTAL_MISMATCH');
    } else {
      if (cycle.state !== 'ISSUED') fail('BILLING_CYCLE_NOT_ISSUED');
      corrected = first(await client.query(sql.documentForUpdate, [command.correctsDocumentId, organizationId]));
      if (!corrected || corrected.billing_cycle_id !== cycleId
          || !PRIMARY_DOCUMENT_TYPES.includes(corrected.document_type)) fail('BILLING_CORRECTION_TARGET_INVALID');
      if (corrected.state !== 'ISSUED') fail('BILLING_CORRECTION_TARGET_NOT_ISSUED');
      if (command.documentType === 'CREDIT_NOTE') {
        const available = paymentProjection(first(await client.query(sql.documentBalance,
          [corrected.id, organizationId]))).balanceAmount;
        if (moneyUnits(command.total) > moneyUnits(available)) fail('BILLING_CREDIT_EXCEEDS_BALANCE');
      }
    }
    const documentId = id();
    const inserted = first(await client.query(sql.insertDocument,
      documentValues(documentId, cycleId, organizationId, command, actorId)));
    if (!inserted) fail('BILLING_WRITE_FAILED');
    if (!first(await client.query(sql.insertDocumentRevision, [documentId, null, actorId]))) fail('BILLING_WRITE_FAILED');
    let cycleState = cycle.state, cycleRevision = previousCycleRevision;
    if (primary) {
      const changedCycle = first(await client.query(sql.transitionCycle,
        [cycleId, organizationId, 'ISSUED', actorId, previousCycleRevision]));
      if (!changedCycle) fail('STALE_REVISION');
      cycleState = changedCycle.state; cycleRevision = integer(changedCycle.revision);
      if (!first(await client.query(sql.insertCycleRevision, [cycleId, actorId, null]))) fail('BILLING_WRITE_FAILED');
    } else if (command.documentType === 'CREDIT_NOTE') {
      const adjustments = first(await client.query(sql.documentAdjustments, [corrected.id, organizationId]));
      const credit = moneyUnits(adjustments?.credit_amount ?? '0');
      const correctedTotal = moneyUnits(corrected.total) + moneyUnits(adjustments?.debit_amount ?? '0');
      if (credit > correctedTotal) fail('BILLING_CREDIT_EXCEEDS_DOCUMENT');
      if (credit === correctedTotal) {
        const changedDocument = first(await client.query(sql.transitionDocument,
          [corrected.id, organizationId, 'CREDITED', actorId, integer(corrected.revision)]));
        if (!changedDocument) fail('STALE_REVISION');
        if (!first(await client.query(sql.insertDocumentRevision,
          [corrected.id, 'Integralmente creditado por documento externo', actorId]))) fail('BILLING_WRITE_FAILED');
        const changedCycle = first(await client.query(sql.transitionCycle,
          [cycleId, organizationId, 'CREDITED', actorId, previousCycleRevision]));
        if (!changedCycle) fail('STALE_REVISION');
        cycleState = changedCycle.state; cycleRevision = integer(changedCycle.revision);
        if (!first(await client.query(sql.insertCycleRevision,
          [cycleId, actorId, 'Integralmente creditado por documento externo']))) fail('BILLING_WRITE_FAILED');
      }
    }
    const result = Object.freeze({ organizationId, cycleId, cycleRevision, cycleState, documentId,
      documentType: command.documentType, documentState: 'ISSUED', documentRevision: 1 });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_DOCUMENT_RECORDED',
      resourceType: 'BILLING_DOCUMENT', resourceId: documentId, previousRevision: 0, newRevision: 1,
      detailCode: primary ? 'PRIMARY_DOCUMENT_RECORDED' : 'CORRECTIVE_DOCUMENT_RECORDED',
      requestKey: command.idempotencyKey, operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function documentTransition(client, { organizationId, documentId, actorId, command }) {
    const operationCode = OPERATIONS.DOCUMENT_TRANSITION;
    const intentDigest = digest(operationCode, organizationId, actorId, documentId, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    const located = first(await client.query(sql.documentById, [documentId, organizationId]));
    if (!located) fail('BILLING_DOCUMENT_NOT_FOUND');
    const cycle = first(await client.query(sql.cycleForUpdate, [located.billing_cycle_id, organizationId]));
    if (!cycle) fail('BILLING_CYCLE_NOT_FOUND');
    const current = first(await client.query(sql.documentForUpdate, [documentId, organizationId]));
    if (!current) fail('BILLING_DOCUMENT_NOT_FOUND');
    const previousRevision = integer(current.revision);
    if (command.expectedRevision !== previousRevision) fail('STALE_REVISION');
    if (current.state !== 'ISSUED') fail('DOCUMENT_TRANSITION_NOT_ALLOWED');
    const primary = PRIMARY_DOCUMENT_TYPES.includes(current.document_type);
    if (!primary && command.toState !== 'CANCELLED') fail('DOCUMENT_TRANSITION_NOT_ALLOWED');
    if (primary) {
      const balance = paymentProjection(first(await client.query(sql.documentBalance, [documentId, organizationId])));
      if (balance.paidAmount !== '0') fail('BILLING_DOCUMENT_HAS_PAYMENTS');
      if (command.toState === 'CREDITED') {
        const adjustments = first(await client.query(sql.documentAdjustments, [documentId, organizationId]));
        if (adjustedTotal(current, adjustments) !== 0n) fail('BILLING_DOCUMENT_NOT_FULLY_CREDITED');
      }
    } else if (current.document_type === 'DEBIT_NOTE') {
      const corrected = first(await client.query(sql.documentForUpdate,
        [current.corrects_document_id, organizationId]));
      if (!corrected || corrected.billing_cycle_id !== cycle.id
          || !PRIMARY_DOCUMENT_TYPES.includes(corrected.document_type)) fail('BILLING_CORRECTION_TARGET_INVALID');
      const balance = paymentProjection(first(await client.query(sql.documentBalance,
        [corrected.id, organizationId])));
      if (moneyUnits(balance.paidAmount) > moneyUnits(balance.total) - moneyUnits(current.total)) {
        fail('BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE');
      }
    }
    const changed = first(await client.query(sql.transitionDocument,
      [documentId, organizationId, command.toState, actorId, previousRevision]));
    if (!changed) fail('STALE_REVISION');
    const nextRevision = integer(changed.revision);
    if (!first(await client.query(sql.insertDocumentRevision, [documentId, command.reason, actorId]))) fail('BILLING_WRITE_FAILED');
    let cycleState = cycle.state, cycleRevision = integer(cycle.revision);
    if (primary) {
      const changedCycle = first(await client.query(sql.transitionCycle,
        [cycle.id, organizationId, command.toState, actorId, cycleRevision]));
      if (!changedCycle) fail('STALE_REVISION');
      cycleState = changedCycle.state; cycleRevision = integer(changedCycle.revision);
      if (!first(await client.query(sql.insertCycleRevision, [cycle.id, actorId, command.reason]))) fail('BILLING_WRITE_FAILED');
    } else if (current.document_type === 'CREDIT_NOTE') {
      const corrected = first(await client.query(sql.documentForUpdate, [current.corrects_document_id, organizationId]));
      if (!corrected || corrected.billing_cycle_id !== cycle.id
          || !PRIMARY_DOCUMENT_TYPES.includes(corrected.document_type)) fail('BILLING_CORRECTION_TARGET_INVALID');
      const adjustments = first(await client.query(sql.documentAdjustments, [corrected.id, organizationId]));
      if (corrected.state === 'CREDITED' && adjustedTotal(corrected, adjustments) > 0n) {
        const reopened = first(await client.query(sql.transitionDocument,
          [corrected.id, organizationId, 'ISSUED', actorId, integer(corrected.revision)]));
        if (!reopened) fail('STALE_REVISION');
        if (!first(await client.query(sql.insertDocumentRevision,
          [corrected.id, command.reason, actorId]))) fail('BILLING_WRITE_FAILED');
        const changedCycle = first(await client.query(sql.transitionCycle,
          [cycle.id, organizationId, 'ISSUED', actorId, cycleRevision]));
        if (!changedCycle) fail('STALE_REVISION');
        cycleState = changedCycle.state; cycleRevision = integer(changedCycle.revision);
        if (!first(await client.query(sql.insertCycleRevision,
          [cycle.id, actorId, command.reason]))) fail('BILLING_WRITE_FAILED');
      }
    }
    const result = Object.freeze({ organizationId, cycleId: cycle.id, cycleRevision, cycleState,
      documentId, documentRevision: nextRevision, documentState: command.toState });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_DOCUMENT_CHANGED',
      resourceType: 'BILLING_DOCUMENT', resourceId: documentId, previousRevision, newRevision: nextRevision,
      detailCode: command.toState === 'CANCELLED' ? 'DOCUMENT_CANCELLED' : 'DOCUMENT_CREDITED',
      requestKey: command.idempotencyKey, operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function paymentRecord(client, { organizationId, documentId, actorId, command }) {
    const operationCode = OPERATIONS.PAYMENT_RECORD;
    const intentDigest = digest(operationCode, organizationId, actorId, documentId, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    const located = first(await client.query(sql.documentById, [documentId, organizationId]));
    if (!located) fail('BILLING_DOCUMENT_NOT_FOUND');
    if (!first(await client.query(sql.cycleForUpdate, [located.billing_cycle_id, organizationId]))) fail('BILLING_CYCLE_NOT_FOUND');
    const document = first(await client.query(sql.documentForUpdate, [documentId, organizationId]));
    if (!document || document.state !== 'ISSUED' || !PRIMARY_DOCUMENT_TYPES.includes(document.document_type)) {
      fail('BILLING_DOCUMENT_NOT_PAYABLE');
    }
    if (document.currency !== command.currency) fail('BILLING_CURRENCY_MISMATCH');
    const paymentId = id();
    if (!first(await client.query(sql.insertPayment, [paymentId, organizationId, documentId, 'PAYMENT', null,
      command.amount, command.currency, command.paidOn, command.methodCode, command.externalReference,
      command.note, actorId]))) fail('BILLING_WRITE_FAILED');
    const balance = paymentProjection(first(await client.query(sql.documentBalance, [documentId, organizationId])));
    const result = Object.freeze({ organizationId, documentId, paymentId, recordType: 'PAYMENT',
      amount: command.amount, currency: command.currency, ...balance });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_PAYMENT_RECORDED',
      resourceType: 'BILLING_PAYMENT', resourceId: paymentId, previousRevision: null, newRevision: null,
      detailCode: 'PAYMENT_RECORDED', requestKey: command.idempotencyKey, operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function paymentReverse(client, { organizationId, paymentId, actorId, command }) {
    const operationCode = OPERATIONS.PAYMENT_REVERSE;
    const intentDigest = digest(operationCode, organizationId, actorId, paymentId, command);
    const prior = await replay(client, organizationId, operationCode, command.idempotencyKey, intentDigest);
    if (prior) return prior;
    const located = first(await client.query(sql.paymentById, [paymentId, organizationId]));
    if (!located || located.record_type !== 'PAYMENT') fail('BILLING_PAYMENT_NOT_FOUND');
    if (!first(await client.query(sql.cycleForUpdate, [located.billing_cycle_id, organizationId]))) fail('BILLING_CYCLE_NOT_FOUND');
    const document = first(await client.query(sql.documentForUpdate, [located.billing_document_id, organizationId]));
    if (!document) fail('BILLING_DOCUMENT_NOT_FOUND');
    const payment = first(await client.query(sql.paymentForUpdate, [paymentId, organizationId]));
    if (!payment || payment.record_type !== 'PAYMENT') fail('BILLING_PAYMENT_NOT_FOUND');
    const reversalId = id();
    if (!first(await client.query(sql.insertPayment, [reversalId, organizationId, payment.billing_document_id,
      'REVERSAL', paymentId, command.amount, payment.currency, command.reversedOn, payment.method_code,
      null, command.reason, actorId]))) fail('BILLING_WRITE_FAILED');
    const balance = paymentProjection(first(await client.query(sql.documentBalance,
      [payment.billing_document_id, organizationId])));
    const result = Object.freeze({ organizationId, documentId: payment.billing_document_id, paymentId: reversalId,
      reversesPaymentId: paymentId, recordType: 'REVERSAL', amount: command.amount, currency: payment.currency, ...balance });
    const correlation = correlationId();
    await record(client, { organizationId, actorId, eventCode: 'PLATFORM_BILLING_PAYMENT_REVERSED',
      resourceType: 'BILLING_PAYMENT', resourceId: reversalId, previousRevision: null, newRevision: null,
      detailCode: 'PAYMENT_REVERSED', requestKey: command.idempotencyKey, operationCode, correlation });
    await receipt(client, organizationId, operationCode, command.idempotencyKey, actorId, intentDigest, result);
    return result;
  }
  async function summary(client, { filters, today }) {
    const rows = (await client.query(sql.summary, [filters.from, filters.to, filters.currency, today])).rows;
    return Object.freeze({ currencies: Object.freeze(rows.map(row => Object.freeze({
      currency: row.currency,
      billedAmount: money(row.billed_amount),
      receivedAmount: money(row.received_amount),
      outstandingAmount: money(row.outstanding_amount),
      overdueAmount: money(row.overdue_amount),
      documentCount: count(row.document_count),
      organizationsWithBalance: count(row.organizations_with_balance)
    }))) });
  }
  async function cycles(client, { filters, today }) {
    const values = [filters.q, filters.organizationId, filters.from, filters.to, filters.cycleStatus,
      filters.paymentStatus, filters.overdue, filters.currency, today];
    const total = count(first(await client.query(sql.cyclesCount, values))?.total ?? '0');
    const rows = (await client.query(sql.cyclesList,
      [...values, PAGE_SIZE, (filters.page - 1) * PAGE_SIZE])).rows;
    return Object.freeze({ items: Object.freeze(rows.map(cycleProjection)), total,
      page: filters.page, pageSize: PAGE_SIZE });
  }
  async function cycleDetail(client, { cycleId, today }) {
    const row = first(await client.query(sql.cycleDetail, [cycleId, today]));
    if (!row) fail('BILLING_CYCLE_NOT_FOUND');
    // A pg Client serializes one transaction on one connection. Keep these
    // reads explicitly sequential; concurrent client.query calls are
    // deprecated by pg and would not provide database-level parallelism.
    const documentsResult = await client.query(sql.cycleDocuments, [cycleId]);
    const paymentsResult = await client.query(sql.cyclePayments, [cycleId]);
    const timelineResult = await client.query(sql.cycleTimeline, [cycleId, row.organization_id]);
    const base = cycleProjection(row);
    const paidUnits = moneyUnits(base.paidAmount);
    const adjustedUnits = moneyUnits(base.adjustedTotal);
    const primaryDocument = documentsResult.rows.find(document => PRIMARY_DOCUMENT_TYPES.includes(document.document_type));
    const reversalUnits = new Map();
    for (const payment of paymentsResult.rows) {
      if (payment.record_type === 'REVERSAL') {
        reversalUnits.set(payment.reverses_payment_id,
          (reversalUnits.get(payment.reverses_payment_id) || 0n) + moneyUnits(payment.amount));
      }
    }
    const documents = documentsResult.rows.map(document => {
      const primary = PRIMARY_DOCUMENT_TYPES.includes(document.document_type);
      const issued = document.state === 'ISSUED';
      const canCancel = issued && (primary ? paidUnits === 0n
        : document.document_type === 'CREDIT_NOTE'
          || (document.document_type === 'DEBIT_NOTE'
            && paidUnits <= adjustedUnits - moneyUnits(document.total)));
      return Object.freeze({
        id: document.id, cycleId: document.billing_cycle_id, sourceCode: document.source_code,
        issuerReference: document.issuer_reference, type: document.document_type,
        number: document.document_number, externalDocumentId: document.external_document_id,
        issueDate: document.issue_date, dueDate: document.due_date, currency: document.currency,
        subtotal: money(document.subtotal), taxTotal: money(document.tax_total), total: money(document.total),
        correctsDocumentId: document.corrects_document_id, state: document.state,
        revision: integer(document.revision), createdAt: instant(document.created_at), updatedAt: instant(document.updated_at),
        allowedActions: Object.freeze({ cancel: canCancel,
          credit: issued && primary && paidUnits === 0n && adjustedUnits === 0n })
      });
    });
    const payments = paymentsResult.rows.map(payment => {
      const remaining = payment.record_type === 'PAYMENT'
        ? moneyUnits(payment.amount) - (reversalUnits.get(payment.id) || 0n) : 0n;
      return Object.freeze({
        id: payment.id, documentId: payment.billing_document_id, recordType: payment.record_type,
        reversesPaymentId: payment.reverses_payment_id, amount: money(payment.amount), currency: payment.currency,
        effectiveOn: payment.effective_on, methodCode: payment.method_code,
        externalReference: payment.external_reference, note: payment.note, createdBy: payment.created_by,
        createdAt: instant(payment.created_at), allowedActions: Object.freeze({ reverse: remaining > 0n })
      });
    });
    return Object.freeze({
      ...base,
      cycleNotes: row.cycle_notes,
      cycleCreatedAt: instant(row.cycle_created_at),
      cycleUpdatedAt: instant(row.cycle_updated_at),
      accountSnapshot: Object.freeze({
        legalName: row.legal_name, taxCountry: row.tax_country, taxIdentifier: row.tax_identifier,
        addressLine1: row.address_line_1, addressLine2: row.address_line_2, postalCode: row.postal_code,
        locality: row.locality, region: row.region, billingEmail: row.billing_email,
        contactName: row.contact_name, externalSource: row.external_source,
        externalCustomerRef: row.external_customer_ref, paymentTermsDays: count(row.payment_terms_days),
        notes: row.account_notes
      }),
      allowedActions: Object.freeze({
        editCycle: base.cycleState === 'DRAFT', readyCycle: base.cycleState === 'DRAFT',
        cancelCycle: ['DRAFT', 'READY_TO_ISSUE'].includes(base.cycleState),
        recordPrimaryDocument: base.cycleState === 'READY_TO_ISSUE',
        recordCorrectiveDocument: base.cycleState === 'ISSUED',
        recordPayment: Boolean(primaryDocument && primaryDocument.state === 'ISSUED'
          && moneyUnits(base.balanceAmount) > 0n)
      }),
      documents: Object.freeze(documents),
      payments: Object.freeze(payments),
      timeline: Object.freeze(timelineResult.rows.map(activity => Object.freeze({
        id: activity.id, operationCode: activity.operation_code, occurredAt: instant(activity.occurred_at),
        actorId: activity.actor_id, eventCode: activity.event_code, resourceType: activity.resource_type,
        resourceId: activity.resource_id,
        previousRevision: activity.previous_revision === null ? null : count(activity.previous_revision),
        newRevision: activity.new_revision === null ? null : integer(activity.new_revision),
        detailCode: activity.detail_code, correlationId: activity.correlation_id
      })))
    });
  }
  async function accountDetail(client, { organizationId }) {
    const row = first(await client.query(sql.accountDetail, [organizationId]));
    if (!row) fail('RESOURCE_NOT_AVAILABLE');
    return Object.freeze({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationLegalName: row.organization_legal_name,
      organizationStatus: row.organization_status,
      account: row.account_id === null ? null : Object.freeze({
        id: row.account_id, revision: integer(row.account_revision), currentVersion: integer(row.current_version),
        createdAt: instant(row.account_created_at), updatedAt: instant(row.account_updated_at),
        version: Object.freeze({
          id: row.account_version_id, version: integer(row.version), legalName: row.legal_name,
          taxCountry: row.tax_country, taxIdentifier: row.tax_identifier, addressLine1: row.address_line_1,
          addressLine2: row.address_line_2, postalCode: row.postal_code, locality: row.locality,
          region: row.region, billingEmail: row.billing_email, contactName: row.contact_name,
          externalSource: row.external_source, externalCustomerRef: row.external_customer_ref,
          paymentTermsDays: count(row.payment_terms_days), notes: row.notes,
          createdBy: row.created_by, createdAt: instant(row.version_created_at)
        })
      })
    });
  }
  async function resourceOrganization(client, statement, id) {
    const row = first(await client.query(statement, [id]));
    if (!row) fail('RESOURCE_NOT_AVAILABLE');
    return row.organization_id;
  }
  function cycleOrganization(client, { cycleId }) {
    return resourceOrganization(client, sql.cycleOrganization, cycleId);
  }
  function documentOrganization(client, { documentId }) {
    return resourceOrganization(client, sql.documentOrganization, documentId);
  }
  function paymentOrganization(client, { paymentId }) {
    return resourceOrganization(client, sql.paymentOrganization, paymentId);
  }
  return Object.freeze({ accountWrite, cycleCreate, cycleEdit, cycleTransition,
    documentRecord, documentTransition, paymentRecord, paymentReverse,
    summary, cycles, cycleDetail, accountDetail,
    cycleOrganization, documentOrganization, paymentOrganization });
}

module.exports = { OPERATIONS, PAGE_SIZE, createPlatformBillingRepository };
