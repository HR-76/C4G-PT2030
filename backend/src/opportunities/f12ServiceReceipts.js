'use strict';

const { randomUUID } = require('node:crypto');
const { SERVICE_ACTORS } = require('./jobs');
const { isTrustedResult, result: jobResult } = require('../async/jobResult');

const FIELDS = ['transaction_id', 'organization_id', 'tenant_id', 'database_generation_id',
  'job_type', 'grant_version', 'execution_id', 'content_digest'];
const columns = FIELDS.join(', ');
const parameters = FIELDS.map((_, index) => '$' + (index + 1)).join(', ');
const insertGuard = `INSERT INTO f12_service_authority.commit_guard (${columns}) VALUES (${parameters})`;
const nonceLock = 'SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 43001305)) AS locked';
const lineageLock = 'SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 43001306)) AS locked';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function tenantIdentity(client) {
  const { rows } = await client.query(
    "SELECT tenant_id, database_generation_id FROM c4g_system.tenant_identity WHERE product_code='C4G' AND database_role='TENANT'");
  if (rows.length !== 1) throw new Error('F12_RECEIPT_TENANT_MISMATCH');
  return rows[0];
}

async function withReceiptRole(client, work) {
  const { rows } = await client.query('SELECT current_user AS role');
  if (rows[0]?.role !== 'c4g_opportunity_tenant_runtime') return work();
  await client.query('RESET ROLE');
  await client.query('SET LOCAL ROLE c4g_f12_receipt_issuer');
  const result = await work();
  await client.query('RESET ROLE');
  await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  return result;
}

// The composition root supplies the Central identity and a reader that opens
// a transaction on the original, verified physical tenant.
function createF12ServiceReceipts({ central, recoveryCentral = central, withVerifiedTenant }) {
  if (typeof central?.query !== 'function' || typeof recoveryCentral?.query !== 'function' || typeof withVerifiedTenant !== 'function') {
    throw new TypeError('F12 receipt dependencies are required.');
  }

  async function prepare(values, hasLineage) {
    if (!hasLineage) {
      await central.query(insertGuard, values);
      return true;
    }
    const [, organization, tenant, generation, type, , root, digest] = values;
    const reader = await recoveryCentral.connect();
    let discard = false;
    try {
      await reader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      // Serialize preparation across workers and tenant generations. A pending
      // guard remains visible after this lock is released, while the effect
      // transaction still owns its nonce.
      const lock = await reader.query(lineageLock, [JSON.stringify([organization, type, root])]);
      if (lock.rows[0]?.locked !== true) throw new Error('F12_RECEIPT_LINEAGE_BUSY');
      const previous = await reader.query(`SELECT ${columns}, state FROM f12_service_authority.commit_guard
        WHERE organization_id=$1 AND job_type=$2 AND execution_id=$3 AND state<>'ROLLED_BACK'`, [organization, type, root]);
      if (previous.rows.length > 1) throw new Error('F12_RECEIPT_LINEAGE_CONFLICT');
      const guard = previous.rows[0];
      let committed = false;
      if (guard) {
        if (guard.tenant_id !== tenant || guard.database_generation_id !== generation || guard.content_digest !== digest) {
          throw new Error('F12_RECEIPT_LINEAGE_CONFLICT');
        }
        const outcome = await recover(guard.transaction_id, reader);
        if (outcome === 'PENDING') throw new Error('F12_RECEIPT_LINEAGE_BUSY');
        committed = outcome === 'COMMITTED';
      }
      if (!committed) {
        await central.query(insertGuard, values);
      }
      await reader.query('COMMIT');
      return !committed;
    } catch (error) {
      try { await reader.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally {
      reader.release(discard);
    }
  }

  async function execute(client, { actor, execution }, effect) {
    const job = Object.hasOwn(SERVICE_ACTORS, actor?.jobType) && SERVICE_ACTORS[actor.jobType];
    if (!job || actor.type !== 'SERVICE' || actor.id !== job.code || actor.operationCode !== job.operation
        || actor.executionId !== execution.executionId || !/^[a-f0-9]{64}$/.test(execution.contentDigest)
        || !Number.isSafeInteger(actor.authorizationVersion) || actor.authorizationVersion < 1) {
      throw new Error('F12_RECEIPT_EXECUTION_MISMATCH');
    }
    const { tenant_id, database_generation_id } = await withReceiptRole(client, () => tenantIdentity(client));
    const nonce = randomUUID();
    const { rows } = await client.query(nonceLock, [nonce]);
    if (rows[0]?.locked !== true) throw new Error('F12_RECEIPT_NONCE_BUSY');
    const root = execution.rootExecutionId;
    if (root !== undefined && (!UUID.test(root) || typeof recoveryCentral.connect !== 'function')) {
      throw new Error('F12_RECEIPT_LINEAGE_INVALID');
    }
    // F9 gives each retry a new execution ID. Both stores use the stable root
    // to identify a single effect across those attempts.
    const values = [nonce, actor.organizationId, tenant_id, database_generation_id, actor.jobType,
      actor.authorizationVersion, root ?? actor.executionId, execution.contentDigest];
    const terminal = execution.terminalExecutionId;
    let terminalValues;
    const success = () => Object.freeze({ jobResult: jobResult('SUCCESS') });
    if (terminal != null) {
      if (!root || !UUID.test(terminal) || terminal === root) throw new Error('F12_RECEIPT_LINEAGE_INVALID');
      const terminalNonce = randomUUID();
      const lock = await client.query(nonceLock, [terminalNonce]);
      if (lock.rows[0]?.locked !== true) throw new Error('F12_RECEIPT_NONCE_BUSY');
      terminalValues = [terminalNonce, ...values.slice(1, 6), terminal, execution.contentDigest];
      if (!await prepare(terminalValues, true)) return success();
    }
    const applyEffect = await prepare(values, root !== undefined);
    const result = applyEffect ? await effect() : success();
    if (!isTrustedResult(result?.jobResult, 'SUCCESS')) throw new Error('F12_RECEIPT_EFFECT_NOT_SUCCESSFUL');
    await withReceiptRole(client, async () => {
      const insert = `INSERT INTO f12_service_receipts.effect_receipt (${columns}) VALUES (${parameters})`;
      if (applyEffect) await client.query(insert, values);
      if (terminalValues) await client.query(insert, terminalValues);
    });
    return result;
  }

  async function recover(transactionId, connection = recoveryCentral) {
    const { rows } = await connection.query(
      `SELECT ${columns}, state FROM f12_service_authority.commit_guard WHERE transaction_id=$1`, [transactionId]);
    const guard = rows[0];
    if (!guard) throw new Error('F12_SERVICE_GUARD_UNKNOWN');
    if (guard.state === 'COMMITTED' || guard.state === 'ROLLED_BACK') return guard.state;
    const outcome = await withVerifiedTenant(Object.freeze({ ...guard }), async client => {
      const observed = await client.query(
        'SELECT pending, receipt FROM f12_service_receipts.observe_effect($1,$2,$3,$4)',
        [transactionId, guard.organization_id, guard.tenant_id, guard.database_generation_id]);
      const observation = observed.rows[0];
      if (observed.rows.length !== 1 || typeof observation.pending !== 'boolean') {
        throw new Error('F12_RECEIPT_OBSERVATION_INVALID');
      }
      if (observation.pending) return 'PENDING';
      const { receipt } = observation;
      if (receipt === null) return 'ROLLED_BACK';
      if (FIELDS.some(field => receipt[field] !== guard[field])) throw new Error('F12_RECEIPT_BINDING_MISMATCH');
      return 'COMMITTED';
    });
    if (outcome === 'PENDING') return outcome;
    const finalized = await connection.query(
      `UPDATE f12_service_authority.commit_guard SET state=$2
        WHERE transaction_id=$1 AND state IN ('PREPARED','UNKNOWN') RETURNING state`, [transactionId, outcome]);
    if (finalized.rows[0]?.state === outcome) return outcome;
    const current = await connection.query('SELECT state FROM f12_service_authority.commit_guard WHERE transaction_id=$1', [transactionId]);
    if (current.rows[0]?.state !== outcome) throw new Error('F12_SERVICE_GUARD_RECOVERY_CONFLICT');
    return outcome;
  }

  async function loadVersion(organizationId, jobType) {
    const { rows } = await central.query(
      'SELECT version FROM f12_service_authority.service_grant WHERE organization_id=$1 AND job_type=$2 AND active',
      [organizationId, jobType]);
    const version = Number(rows[0]?.version);
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('F12_GRANT_STALE');
    return version;
  }

  return Object.freeze({ execute, recover, loadVersion });
}

module.exports = { createF12ServiceReceipts };
