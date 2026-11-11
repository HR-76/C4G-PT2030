const { canonicalizeJcs1, normalize, plain } = require('./canonicalJson');
const { CATALOG_VERSION, EVENT_VERSION, resolveEvent, resolveResidence } = require('./eventCatalog');
const { CANONICALIZATION_VERSION, HASH_ALGORITHM, inputDigest } = require('./integrity');
const { createUuidV7, isUuidV7 } = require('./uuidV7');

const INPUT_KEYS = Object.freeze(['eventCode', 'actor', 'subject', 'resource', 'decision', 'outcome', 'observedAt', 'correlationId', 'causationId', 'idempotencyKey', 'streamType', 'payload']);
const ACTOR_KEYS = Object.freeze(['type', 'id', 'membershipId', 'serviceActorCode', 'supportGrantId']);
const FORBIDDEN = /(?:password|passwd|secret|token|credential|authorization|cookie|dsn|connection|string|sql|query|stack|message|document|email|phone|address|name|claim)/i;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const STREAMS = new Set(['SECURITY', 'ACCESS', 'SUPPORT', 'ASYNC', 'DATA', 'OPERATIONS']);

function exact(value, keys) { return plain(value) && Reflect.ownKeys(value).every(key => typeof key === 'string') && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function opaque(value) { return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s@]/.test(value); }
function iso(value) { return typeof value === 'string' && new Date(value).toISOString() === value; }
function reference(value) { return value === null || (exact(value, ['type', 'id']) && CODE.test(value.type) && opaque(value.id)); }
function validatePayload(payload, definition) {
  if (!plain(payload) || Reflect.ownKeys(payload).some(key => typeof key !== 'string' || !definition.payloadFields.includes(key)
      || (FORBIDDEN.test(key) && key !== 'authorizationVersion'))) throw new TypeError('Audit payload is not allowlisted.');
  for (const [key, value] of Object.entries(payload)) {
    if (value === null && definition.code.startsWith('OPPORTUNITY_CRITERIA_') && ['setId','criteriaRevisionId','previousRevisionNumber','newRevisionNumber','criteriaDigest'].includes(key)) continue;
    if (!['string', 'boolean', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isSafeInteger(value)) || (typeof value === 'string' && (value.length > 256 || value.normalize('NFC') !== value))) throw new TypeError('Audit payload value is invalid.');
    if (key === 'detailCode' && (typeof value !== 'string' || !CODE.test(value))) throw new TypeError('Audit detail code is invalid.');
    if (['policyVersion', 'catalogVersion'].includes(key) && (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value))) throw new TypeError('Audit version is invalid.');
    if (key === 'scopeType' && (typeof value !== 'string' || !CODE.test(value))) throw new TypeError('Audit scope is invalid.');
    if (key === 'scopeDigest' && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new TypeError('Audit scope digest is invalid.');
    if (key === 'semanticDigest' && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new TypeError('Audit semantic digest is invalid.');
    if (['membershipVersion', 'authorizationVersion'].includes(key) && (!Number.isSafeInteger(value) || value < 1)) throw new TypeError('Audit authorization version is invalid.');
    if (['permissionCatalogVersion', 'operationCatalogVersion'].includes(key) && (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value))) throw new TypeError('Audit catalog version is invalid.');
    if (['reasonRef','reasonReleaseRef','purposeRef','purposeReleaseRef'].includes(key) && (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))) throw new TypeError('Audit catalog reference is invalid.');
    if (['reasonCatalogVersion','purposeCatalogVersion'].includes(key) && (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value))) throw new TypeError('Audit catalog version is invalid.');
  }
  if (Buffer.byteLength(canonicalizeJcs1(payload), 'utf8') > definition.maxPayloadBytes) throw new TypeError('Audit payload exceeds 8 KiB.');
}

function createAuditEvent({ trustedContext, input, clock = () => new Date(), uuid = createUuidV7 }) {
  if (!trustedContext || !exact(input, INPUT_KEYS)) throw new TypeError('Audit event input is invalid.');
  const definition = resolveEvent(input.eventCode, EVENT_VERSION);
  if (!definition) throw new TypeError('Audit event code or version is unknown.');
  if (!exact(input.actor, ACTOR_KEYS) || !definition.actorTypes.includes(input.actor.type) || !opaque(input.actor.id)) throw new TypeError('Audit actor is invalid.');
  const platform = trustedContext.scope === 'PLATFORM' && trustedContext.organizationId === null && trustedContext.tenantId === null && trustedContext.operationAuthority === 'CENTRAL' && ['OPPORTUNITY_CENTRAL_MANAGE','PLATFORM_ONBOARDING','PLATFORM_BILLING'].includes(trustedContext.operationCode);
  if (platform && input.actor.membershipId !== null) throw new TypeError('Platform actor cannot carry tenant membership.');
  if ((!platform && input.actor.type === 'HUMAN') !== Boolean(input.actor.membershipId) || (input.actor.type === 'SERVICE') !== Boolean(input.actor.serviceActorCode) || (input.actor.type === 'SUPPORT') !== Boolean(input.actor.supportGrantId)) throw new TypeError('Audit actor discriminator is invalid.');
  if ((!platform && !opaque(trustedContext.organizationId)) || !opaque(trustedContext.operationCode) || !opaque(trustedContext.source) || !opaque(trustedContext.channel)
    || !CODE.test(input.streamType) || !STREAMS.has(input.streamType) || !iso(input.observedAt) || !reference(input.subject) || !reference(input.resource)
    || !CODE.test(input.decision) || !CODE.test(input.outcome)) throw new TypeError('Audit trusted context, reference or time is invalid.');
  const skew = Math.abs(clock().getTime() - new Date(input.observedAt).getTime());
  if (trustedContext.synchronous === true && skew > 2000) throw new TypeError('Synchronous audit timestamp exceeds skew.');
  if (!isUuidV7(input.correlationId) || (input.causationId !== null && !isUuidV7(input.causationId)) || !opaque(input.idempotencyKey)) throw new TypeError('Audit correlation or idempotency is invalid.');
  validatePayload(input.payload, definition);
  const location = resolveResidence(definition, trustedContext);
  const catalogVersion = trustedContext.catalogVersion || CATALOG_VERSION;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(catalogVersion)) throw new TypeError('Audit catalog version is invalid.');
  const event = normalize({
    eventId: uuid(), eventVersion: EVENT_VERSION, catalogVersion, eventCode: definition.code,
    auditClass: definition.auditClass, ledgerLocation: location, organizationId: trustedContext.organizationId,
    tenantId: location === 'TENANT' ? trustedContext.tenantId : null, actor: input.actor,
    subject: input.subject, resource: input.resource, decision: input.decision, outcome: input.outcome,
    operationCode: trustedContext.operationCode, observedAt: input.observedAt, streamType: input.streamType,
    correlationId: input.correlationId, causationId: input.causationId, idempotencyKey: input.idempotencyKey,
    source: trustedContext.source, channel: trustedContext.channel, payload: input.payload,
    canonicalizationVersion: CANONICALIZATION_VERSION, hashAlgorithm: HASH_ALGORITHM
  });
  if (Buffer.byteLength(canonicalizeJcs1(event), 'utf8') > definition.maxEventBytes) throw new TypeError('Audit event exceeds 16 KiB.');
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
  return Object.freeze({ event: freeze(event), digest: inputDigest(event) });
}

module.exports = { ACTOR_KEYS, INPUT_KEYS, createAuditEvent, validatePayload };
