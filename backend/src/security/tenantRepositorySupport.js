const { createHash, randomUUID } = require('node:crypto');
const { types: { isProxy } } = require('node:util');
const { rollbackReleaseAndThrow } = require('./postgresTransaction');

class TenantDirectoryError extends Error {
  constructor(code, message = 'Tenant directory operation could not be completed safely.') {
    super(message);
    this.name = 'TenantDirectoryError';
    this.code = code;
  }
}

function conflict() { return new TenantDirectoryError('TRANSITION_CONFLICT'); }
function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required.`);
  return value;
}

function canonicalize(value, ancestors = new Set()) {
  if (value === null) return 'null';
  if (value === undefined) throw new TypeError('Intent contains undefined, which cannot be preserved in JSON.');
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Intent numbers must be finite.');
    return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
  }
  if (value !== null && typeof value === 'object' && isProxy(value)) throw new TypeError('Intent contains a Proxy.');
  if (value instanceof Date) {
    if (Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) throw new TypeError('Intent contains an unsupported Date object.');
    const time = Date.prototype.getTime.call(value);
    if (!Number.isFinite(time)) throw new TypeError('Intent contains an invalid Date.');
    return `date:${JSON.stringify(Date.prototype.toISOString.call(value))}`;
  }
  if (typeof value === 'object') {
    if (ancestors.has(value)) throw new TypeError('Intent contains a cycle.');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const keys = Reflect.ownKeys(value);
        const expectedKeys = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
        if (Object.getPrototypeOf(value) !== Array.prototype || keys.length !== expectedKeys.size
            || keys.some(key => typeof key !== 'string' || !expectedKeys.has(key))) throw new TypeError('Intent contains an unsupported array.');
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Intent arrays must contain enumerable data elements only.');
        }
        return `[${value.map(item => canonicalize(item, ancestors)).join(',')}]`;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype
          || Reflect.ownKeys(value).some(key => typeof key !== 'string')
          || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !descriptor.enumerable || !('value' in descriptor))) {
        throw new TypeError('Intent contains an unsupported object.');
      }
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key], ancestors)}`).join(',')}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  throw new TypeError('Intent contains an unsupported value.');
}
function requireJsonRoundTrip(value, label = 'value') {
  const original = canonicalize(value);
  let roundTripped;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError();
    roundTripped = JSON.parse(serialized);
  } catch {
    throw new TypeError(`${label} must be losslessly representable as JSON.`);
  }
  if (canonicalize(roundTripped) !== original) throw new TypeError(`${label} must be stable through JSON persistence.`);
  return value;
}
function intentDigest(intent) { return createHash('sha256').update(canonicalize(intent)).digest('hex'); }
function optionalCode(value, name) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) throw conflict();
  return value;
}
function requireCode(value, name) {
  const code = optionalCode(value, name);
  if (code === null) throw conflict();
  return code;
}
function requireOpaqueRef(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)) throw conflict();
  return value;
}
function normalizeInstant(value, name) {
  if (!(value instanceof Date) && typeof value !== 'string') throw conflict();
  if (value instanceof Date && (Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0)) throw conflict();
  const instant = value instanceof Date ? new Date(Date.prototype.getTime.call(value)) : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw conflict();
  return instant.toISOString();
}
function eventExpectation(event) { const payload=event.payload||{};return {tenantId:event.tenantId||null,organizationId:event.organizationId||null,aggregateType:requireText(event.aggregateType,'aggregateType'),aggregateId:event.aggregateId,actionCode:requireText(event.actionCode,'actionCode'),fromState:event.fromState||null,toState:event.toState||null,reasonCode:optionalCode(event.reasonCode,'reasonCode'),correlationId:event.correlationId,idempotencyKey:requireText(event.idempotencyKey,'idempotencyKey'),intentDigest:intentDigest({intent:event.intent||{},payload}),payload}; }
async function findMatchingEvent(client,event,{matchPayload=true}={}) {const expected=eventExpectation(event);const result=await client.query(`SELECT tenant_id,organization_id,aggregate_type,aggregate_id,action_code,from_state,to_state,reason_code,correlation_id,intent_digest,payload FROM public.tenant_directory_event WHERE idempotency_key=$1 AND action_code=$2 FOR UPDATE`,[expected.idempotencyKey,expected.actionCode]);if(result.rowCount===0)return null;const row=result.rows[0];if(result.rowCount!==1||row.tenant_id!==expected.tenantId||row.organization_id!==expected.organizationId||row.aggregate_type!==expected.aggregateType||row.aggregate_id!==expected.aggregateId||row.action_code!==expected.actionCode||row.from_state!==expected.fromState||row.to_state!==expected.toState||row.reason_code!==expected.reasonCode||row.correlation_id!==expected.correlationId||(matchPayload&&(row.intent_digest!==expected.intentDigest||canonicalize(row.payload||{})!==canonicalize(expected.payload))))throw conflict();return row;}

async function findEventSourceState(client, { idempotencyKey, actionCode, allowedStates }) {
  const result = await client.query(`SELECT from_state FROM public.tenant_directory_event
    WHERE idempotency_key=$1 AND action_code=$2 FOR UPDATE`, [idempotencyKey, actionCode]);
  if (result.rowCount === 0) return null;
  if (result.rowCount !== 1 || !allowedStates.includes(result.rows[0].from_state)) throw conflict();
  return result.rows[0].from_state;
}

async function inCentralTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Central database pool is unavailable.');
  let client;
  try { client = await pool.connect(); } catch { throw conflict(); }
  let began = false;
  let committed = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await operation(client);
    await client.query('COMMIT');
    committed = true;
    began = false;
    try {
      client.release();
    } catch {
      throw new TenantDirectoryError('COMMITTED_CLEANUP_FAILED', 'Tenant directory change was committed but client cleanup failed; reconcile persisted state.');
    }
    return result;
  } catch (error) {
    if (committed) throw error;
    if (!began) {
      try { client.release(error); } catch { /* a single discard attempt is sufficient */ }
      throw error instanceof TenantDirectoryError ? error : conflict();
    }
    await rollbackReleaseAndThrow(client, error instanceof TenantDirectoryError ? error : conflict(),
      'Tenant directory operation and transaction cleanup failed.');
  }
}

async function appendEvent(client, event) {
  const expected=eventExpectation(event);const digest=expected.intentDigest,reasonCode=expected.reasonCode;
  const inserted=await client.query(`INSERT INTO public.tenant_directory_event
    (event_id,tenant_id,organization_id,aggregate_type,aggregate_id,action_code,from_state,to_state,reason_code,correlation_id,idempotency_key,intent_digest,payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    ON CONFLICT (idempotency_key,action_code) DO NOTHING RETURNING event_id`, [
    randomUUID(), event.tenantId || null, event.organizationId || null, requireText(event.aggregateType, 'aggregateType'),
    event.aggregateId, requireText(event.actionCode, 'actionCode'), event.fromState || null, event.toState || null,
    reasonCode, event.correlationId, requireText(event.idempotencyKey, 'idempotencyKey'),digest,
    JSON.stringify(event.payload || {})
  ]);
  if(inserted.rowCount===1)return Object.freeze({inserted:true,intentDigest:digest});
  await findMatchingEvent(client,event);
  return Object.freeze({inserted:false,intentDigest:digest});
}

module.exports = { TenantDirectoryError, appendEvent, canonicalize, conflict, eventExpectation, findEventSourceState, findMatchingEvent, inCentralTransaction, intentDigest, normalizeInstant, optionalCode, requireCode, requireJsonRoundTrip, requireOpaqueRef, requireText };
