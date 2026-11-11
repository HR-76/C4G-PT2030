'use strict';

const { isAuthorityCoordinator } = require('../security/authorityCoordinator');
const onboardingSql = require('../platformOnboarding/sql');
const { civilDate, command, fail, query: queryContract, uuid } = require('./contracts');
const { createUuidV7 } = require('../audit/uuidV7');
const { createBillingAudit } = require('./audit');
const { createPlatformBillingRepository } = require('./repository');
const sql = require('./sql');

const REJECTION_EVENTS = Object.freeze({
  accountWrite: ['PLATFORM_BILLING_ACCOUNT_CHANGED', 'BILLING_ACCOUNT'],
  cycleCreate: ['PLATFORM_BILLING_CYCLE_CHANGED', 'BILLING_ACCOUNT'],
  cycleEdit: ['PLATFORM_BILLING_CYCLE_CHANGED', 'BILLING_CYCLE'],
  cycleTransition: ['PLATFORM_BILLING_CYCLE_CHANGED', 'BILLING_CYCLE'],
  documentRecord: ['PLATFORM_BILLING_DOCUMENT_RECORDED', 'BILLING_CYCLE'],
  documentTransition: ['PLATFORM_BILLING_DOCUMENT_CHANGED', 'BILLING_DOCUMENT'],
  paymentRecord: ['PLATFORM_BILLING_PAYMENT_RECORDED', 'BILLING_DOCUMENT'],
  paymentReverse: ['PLATFORM_BILLING_PAYMENT_REVERSED', 'BILLING_PAYMENT']
});
const AUDITED_REJECTIONS = new Set([
  'C4G_ADMIN_REQUIRED', 'STALE_REVISION', 'IDEMPOTENCY_CONFLICT', 'STATE_CONFLICT',
  'CYCLE_TRANSITION_NOT_ALLOWED', 'DOCUMENT_TRANSITION_NOT_ALLOWED',
  'BILLING_CYCLE_NOT_EDITABLE', 'BILLING_CYCLE_NOT_READY', 'BILLING_CYCLE_NOT_ISSUED',
  'BILLING_CURRENCY_MISMATCH', 'BILLING_DOCUMENT_TOTAL_MISMATCH',
  'BILLING_CORRECTION_TARGET_INVALID', 'BILLING_CORRECTION_TARGET_NOT_ISSUED',
  'BILLING_CREDIT_EXCEEDS_BALANCE', 'BILLING_CREDIT_EXCEEDS_DOCUMENT',
  'BILLING_DOCUMENT_HAS_PAYMENTS', 'BILLING_DOCUMENT_NOT_FULLY_CREDITED',
  'BILLING_DOCUMENT_NOT_PAYABLE', 'BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE',
  'BILLING_PAYMENT_EXCEEDS_BALANCE', 'BILLING_REVERSAL_INVALID', 'BILLING_DOCUMENT_DUPLICATE'
]);

function rejectionCode(error) {
  const source = String(error?.code || '');
  if (AUDITED_REJECTIONS.has(source)) return source;
  const message = String(error?.message || '');
  const databaseCode = [...AUDITED_REJECTIONS].find(code => code.startsWith('BILLING_') && message.includes(code));
  if (databaseCode) return databaseCode;
  if (source === '23505' && /billing_fiscal_document_(?:source|primary)|source_code.*issuer_reference/i
    .test(`${error?.constraint || ''} ${message}`)) return 'BILLING_DOCUMENT_DUPLICATE';
  if (['23503', '40001', '40P01', '55P03'].includes(source)) return 'STATE_CONFLICT';
  return '';
}

function lisbonToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function createPlatformBillingService({ coordinator, centralPool, repository = createPlatformBillingRepository(),
  today = lisbonToday, rejectionAudit = createBillingAudit() }) {
  if (!isAuthorityCoordinator(coordinator)
      || !centralPool?.connect || typeof today !== 'function'
      || typeof rejectionAudit !== 'function'
      || !['accountWrite', 'cycleCreate', 'cycleEdit', 'cycleTransition', 'documentRecord',
        'documentTransition', 'paymentRecord', 'paymentReverse', 'summary', 'cycles',
        'cycleDetail', 'accountDetail', 'cycleOrganization', 'documentOrganization',
        'paymentOrganization'].every(name => typeof repository?.[name] === 'function')) {
    throw new TypeError('Platform billing service composition is invalid.');
  }
  function requestActor(request) {
    const sessionId = request?.authContext?.sessionId;
    if (!sessionId || sessionId !== request.sessionID || !request?.user?.id) fail('C4G_ADMIN_REQUIRED');
    try { return uuid(request.user.id); } catch { fail('C4G_ADMIN_REQUIRED'); }
  }
  async function authorize(client, request, expectedActorId, organizationId) {
    const row = (await client.query(onboardingSql.admin, [request.sessionID, expectedActorId])).rows[0];
    if (!row || row.id !== expectedActorId) fail('C4G_ADMIN_REQUIRED');
    if (!(await client.query(sql.organizationAvailable, [organizationId])).rows[0]) fail('RESOURCE_NOT_AVAILABLE');
    return expectedActorId;
  }
  async function authorizeRead(client, request, expectedActorId) {
    const row = (await client.query(sql.readAdmin, [request.sessionID, expectedActorId])).rows[0];
    if (!row || row.id !== expectedActorId) fail('C4G_ADMIN_REQUIRED');
  }
  function write(organizationId, actorId, mutation) {
    return coordinator.write(['POLICY', `ORG:${organizationId}`, `SUBJECT:${actorId}`], mutation);
  }
  async function recordRejection(context, error) {
    const code = rejectionCode(error);
    if (!code) return;
    const definition = REJECTION_EVENTS[context.method];
    if (!definition) return;
    const correlationId = createUuidV7();
    const scopes = ['POLICY', ...(context.organizationId ? [`ORG:${context.organizationId}`] : []),
      `SUBJECT:${context.actorId}`];
    try {
      await coordinator.write(scopes, client => rejectionAudit(client, {
        actorId: context.actorId, eventCode: definition[0], resourceType: definition[1],
        resourceId: context.resourceId, previousRevision: null, newRevision: null,
        detailCode: code, correlationId,
        idempotencyKey: `billing-rejection:${context.method}:${context.idempotencyKey}:${correlationId}`,
        decision: code === 'C4G_ADMIN_REQUIRED' ? 'DENY' : 'ACCEPT',
        outcome: ['STALE_REVISION', 'IDEMPOTENCY_CONFLICT'].includes(code) ? 'CONFLICT' : 'REFUSED'
      }));
    } catch {
      // A failed denial log must never turn a refused command into an allowed one or expose ledger details.
    }
  }
  async function attempt(context, work) {
    try { return await work(); }
    catch (error) { await recordRejection(context, error); throw error; }
  }
  async function execute(organizationId, raw, request, method, resource = {}) {
    const actorId = requestActor(request), org = uuid(organizationId), parsed = command(method, raw);
    return attempt({ method, actorId, organizationId: org, resourceId: resource.cycleId || resource.documentId
      || resource.paymentId || org, idempotencyKey: parsed.idempotencyKey }, () => write(org, actorId, async client => {
      await authorize(client, request, actorId, org);
      return repository[method](client, { organizationId: org, actorId, command: parsed, ...resource });
    }));
  }
  async function centralRead(request, actorId, work) {
    const client = await centralPool.connect();
    let open = false;
    try {
      await client.query('BEGIN READ ONLY'); open = true;
      await client.query("SET LOCAL statement_timeout='5s'");
      await authorizeRead(client, request, actorId);
      const result = await work(client);
      await authorizeRead(client, request, actorId);
      await client.query('COMMIT'); open = false;
      return result;
    } catch (error) {
      if (open) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async function read(raw, request, method, resourceFactory = () => ({})) {
    const actorId = requestActor(request), filters = queryContract(method, raw);
    const currentDate = civilDate(today());
    const resource = resourceFactory();
    return centralRead(request, actorId,
      client => repository[method](client, { actorId, filters, today: currentDate, ...resource }));
  }
  async function executeResolved(raw, request, method, resolver, resourceName, resourceValue) {
    const actorId = requestActor(request), resourceId = uuid(resourceValue), parsed = command(method, raw);
    let organizationId = null;
    return attempt({ method, actorId, get organizationId() { return organizationId; }, resourceId,
      idempotencyKey: parsed.idempotencyKey }, async () => {
      organizationId = await centralRead(request, actorId,
        client => repository[resolver](client, { [resourceName]: resourceId }));
      return write(organizationId, actorId, async client => {
        await authorize(client, request, actorId, organizationId);
        return repository[method](client, {
          organizationId, actorId, command: parsed, [resourceName]: resourceId
        });
      });
    });
  }
  return Object.freeze({
    summary(raw, request) {
      return read(raw, request, 'summary');
    },
    cycles(raw, request) {
      return read(raw, request, 'cycles');
    },
    cycleDetail(cycleId, raw, request) {
      return read(raw, request, 'cycleDetail', () => ({ cycleId: uuid(cycleId) }));
    },
    accountDetail(organizationId, raw, request) {
      return read(raw, request, 'accountDetail', () => ({ organizationId: uuid(organizationId) }));
    },
    accountWrite(organizationId, raw, request) {
      return execute(organizationId, raw, request, 'accountWrite');
    },
    cycleCreate(raw, request) {
      const actorId = requestActor(request), parsed = command('cycleCreate', raw);
      return attempt({ method: 'cycleCreate', actorId, organizationId: parsed.organizationId,
        resourceId: parsed.accountVersionId, idempotencyKey: parsed.idempotencyKey }, () => write(parsed.organizationId, actorId, async client => {
        await authorize(client, request, actorId, parsed.organizationId);
        return repository.cycleCreate(client, { actorId, command: parsed });
      }));
    },
    cycleEdit(cycleId, raw, request) {
      return executeResolved(raw, request, 'cycleEdit', 'cycleOrganization', 'cycleId', cycleId);
    },
    cycleTransition(cycleId, raw, request) {
      return executeResolved(raw, request, 'cycleTransition', 'cycleOrganization', 'cycleId', cycleId);
    },
    documentRecord(cycleId, raw, request) {
      return executeResolved(raw, request, 'documentRecord', 'cycleOrganization', 'cycleId', cycleId);
    },
    documentTransition(documentId, raw, request) {
      return executeResolved(raw, request, 'documentTransition', 'documentOrganization', 'documentId', documentId);
    },
    paymentRecord(documentId, raw, request) {
      return executeResolved(raw, request, 'paymentRecord', 'documentOrganization', 'documentId', documentId);
    },
    paymentReverse(paymentId, raw, request) {
      return executeResolved(raw, request, 'paymentReverse', 'paymentOrganization', 'paymentId', paymentId);
    }
  });
}

module.exports = { createPlatformBillingService, lisbonToday };
