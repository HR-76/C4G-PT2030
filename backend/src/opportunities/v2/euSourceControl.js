'use strict';
const { cloneData, deepFreeze } = require('./data');
const { createActivationAuthorityV2 } = require('./activationAuthority');
const { createActivationAuditV2 } = require('./activationAudit');
const { hash } = require('./activationArchive');
const {writerCapability,WRITER_MODE}=require('./euWriterAuthority');
const FAMILY = Object.freeze(['EU_FUNDING_TENDERS', 'CORDIS', 'ERASMUS']);
const CODES = new Set(['OPPORTUNITY_V2_EU_SUSPENDED', 'OPPORTUNITY_V2_SOURCE_FENCE_STALE', 'OPPORTUNITY_V2_EU_NOT_QUIESCENT', 'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED', 'OPPORTUNITY_V2_SOURCE_CONTROL_INVALID','OPPORTUNITY_V2_EU_WRITER_CONFIGURATION_INVALID','OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED','OPPORTUNITY_V2_EU_WRITER_REQUIRED','OPPORTUNITY_V2_EU_WRITER_UNAVAILABLE']);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function sourceControlError(error) { if (CODES.has(error?.code)) return error; if (error?.code === 'P0001' && CODES.has(error.message)) return Object.assign(new Error(error.message), { code: error.message }); return error; }
function command(raw) {
  const value = cloneData(raw, { maxBytes: 4096 });
  if (!value || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'requestId') || !Object.hasOwn(value, 'expectedFence')
    || typeof value.requestId !== 'string' || !/^[A-Za-z0-9:_.-]{8,128}$/.test(value.requestId) || !Number.isSafeInteger(value.expectedFence) || value.expectedFence < 1) fail('OPPORTUNITY_V2_SOURCE_CONTROL_INVALID');
  return value;
}
async function assertEuQuiescent(client, source, fence) {
  if (!FAMILY.includes(source)) return;
  if (!Number.isSafeInteger(fence) || fence < 1) fail('OPPORTUNITY_V2_SOURCE_FENCE_STALE');
  try { await client.query('SELECT opportunity_catalog.assert_eu_quiescent_v2($1::integer)', [fence]); }
  catch (error) { const checked = sourceControlError(error); if (checked.code?.startsWith('OPPORTUNITY_V2_')) throw checked; fail('OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE'); }
}
async function sourceState(client,capability=null,workerReady=false) {
  const value = (await client.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0]?.state;
  if (!value || value.family !== 'EU_FUNDING_TENDERS' || !['ACTIVE', 'SUSPEND_REQUESTED', 'QUIESCED'].includes(value.state) || !Number.isSafeInteger(value.fence) || value.fence < 1) fail('OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE');
  const counts = ['queuedRuns', 'pendingRuns', 'otherPendingRuns', 'activeRunLeases', 'activeOutboxLeases', 'activeInboxLeases', 'expiredPendingRuns', 'unrecoverablePendingRuns', 'acceptedV2'];
  if (counts.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) fail('OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE');
  const activeLeases = value.activeRunLeases + value.activeOutboxLeases + value.activeInboxLeases;
  const configured=value.writerMode===WRITER_MODE;
  if(Object.hasOwn(value,'writerMode')&&(!['LEGACY_V1',WRITER_MODE].includes(value.writerMode)||!Number.isSafeInteger(value.incompatiblePendingRuns)||value.incompatiblePendingRuns<0))fail('OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE');
  const compatible=configured&&capability?.mode===WRITER_MODE&&value.writerPolicy===capability.policyVersion&&value.writerMappingDigest===capability.mappingDigest&&workerReady;
  return deepFreeze({ ...value, activeLeases, canQuiesce: value.state === 'SUSPEND_REQUESTED' && activeLeases === 0,
    canResume: value.state !== 'ACTIVE' && activeLeases === 0 && (configured?compatible:value.acceptedV2===0) && (value.incompatiblePendingRuns||0)===0 && value.expiredPendingRuns === 0 && value.unrecoverablePendingRuns === 0 && !(value.pendingRuns > 0 && value.otherPendingRuns > 0) });
}
function createEuSourceControlV2({ pool, policyVersion, recentMfaRequirement,euWriterCapability=null,workerHealth=null } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('Central pool is required.');
  const authority = createActivationAuthorityV2({ policyVersion, recentMfaRequirement });
  const audit = createActivationAuditV2();
  const capability=euWriterCapability===null?null:writerCapability({mode:WRITER_MODE,...cloneData(euWriterCapability,{maxBytes:1024})});
  if(workerHealth!==null&&typeof workerHealth!=='function')throw new TypeError('Worker health port is invalid.');
  async function ready(){if(!capability||!workerHealth)return false;try{const h=await workerHealth();return h?.ready===true&&h.euWriterSupported===true&&h.euWriterPolicyVersion===capability.policyVersion&&h.euWriterMappingDigest===capability.mappingDigest;}catch{return false;}}
  async function transaction(context, work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
      const actorId = await authority.assertAdministrator(client, context);
      const result = await work(client, actorId);
      await authority.assertAdministrator(client, context); await client.query('COMMIT'); return result;
    } catch (raw) {
      await client.query('ROLLBACK').catch(() => {});
      const error = sourceControlError(raw);
      if (error.code?.startsWith('OPPORTUNITY_V2_')) throw error;
      fail('OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE');
    } finally { client.release(); }
  }
  async function status(context) {const healthy=await ready();return transaction(context,client=>sourceState(client,capability,healthy));}
  async function change(action, raw, context) {
    const input = command(raw);
    const healthy=await ready();
    if(action==='CONFIGURE'&&(!capability||!healthy))fail('OPPORTUNITY_V2_EU_WRITER_UNAVAILABLE');
    return transaction(context, async (client, actorId) => {
      // Serialize the active-slot transfer after earlier writers have finished;
      // acquire this before the control row to avoid inverting their row locks.
      await client.query('LOCK TABLE opportunity_catalog.funding_run IN EXCLUSIVE MODE');
      const locked = (await client.query("SELECT state,fence FROM opportunity_catalog.eu_source_control_v2 WHERE family='EU_FUNDING_TENDERS' FOR UPDATE")).rows[0];
      if (!locked) fail('OPPORTUNITY_V2_SOURCE_CONTROL_UNAVAILABLE');
      const intent = hash({ action, ...input, actorId,...(action==='CONFIGURE'?{writerCapability:capability}:{}) });
      const receipt = (await client.query('SELECT * FROM opportunity_catalog.eu_source_control_receipt_v2 WHERE request_id=$1', [input.requestId])).rows[0];
      if (receipt) {
        if (receipt.intent_digest !== intent) fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');
        if (receipt.source_fence !== locked.fence) fail('OPPORTUNITY_V2_SOURCE_FENCE_STALE');
        return deepFreeze({ ...(await sourceState(client,capability,healthy)), replayed: true });
      }
      if (locked.fence !== input.expectedFence) fail('OPPORTUNITY_V2_SOURCE_FENCE_STALE');
      const before = await sourceState(client,capability,healthy);
      if (action === 'SUSPEND' && before.state !== 'ACTIVE') fail('OPPORTUNITY_V2_SOURCE_CONTROL_INVALID');
      if (action === 'QUIESCE' && !before.canQuiesce) fail('OPPORTUNITY_V2_EU_NOT_QUIESCENT');
      if (action === 'RESUME' && !before.canResume) fail(before.activeLeases ? 'OPPORTUNITY_V2_EU_NOT_QUIESCENT' : 'OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED');
      if(action==='CONFIGURE'&&(before.state!=='QUIESCED'||before.pendingRuns!==0||before.activeLeases!==0||!Object.hasOwn(before,'writerMode')))fail('OPPORTUNITY_V2_EU_WRITER_CONFIGURATION_INVALID');
      if((action==='CONFIGURE'||action==='RESUME'&&before.writerMode===WRITER_MODE)&&!await ready())fail('OPPORTUNITY_V2_EU_WRITER_UNAVAILABLE');
      const state = { SUSPEND: 'SUSPEND_REQUESTED', QUIESCE: 'QUIESCED', RESUME: 'ACTIVE',CONFIGURE:'QUIESCED' }[action];
      if(action==='CONFIGURE')await client.query("UPDATE opportunity_catalog.eu_source_control_v2 SET eu_writer_mode=$1,eu_writer_policy=$2,eu_writer_mapping_digest=$3,fence=fence+1,changed_by=$4,changed_at=clock_timestamp() WHERE family='EU_FUNDING_TENDERS' AND fence=$5",[capability.mode,capability.policyVersion,capability.mappingDigest,actorId,input.expectedFence]);
      else await client.query("UPDATE opportunity_catalog.eu_source_control_v2 SET state=$1,fence=fence+1,changed_by=$2,changed_at=clock_timestamp() WHERE family='EU_FUNDING_TENDERS' AND fence=$3", [state, actorId, input.expectedFence]);
      if (action === 'RESUME') {
        // Re-publish the exact latest durable delivery acknowledged as deferred.
        // No deadline, envelope, execution identity or attempt is rewritten.
        await client.query('SELECT opportunity_catalog.resume_eu_outbox_v2($1::integer)', [input.expectedFence + 1]);
      }
      const after = await sourceState(client,capability,healthy);
      if (action === 'RESUME' && (after.expiredPendingRuns > 0 || after.unrecoverablePendingRuns > 0)) fail('OPPORTUNITY_V2_EU_LEGACY_RESUME_BLOCKED');
      await audit.recordSourceControl(client, { context, action, requestId: input.requestId, sourceFence: after.fence,...(action==='CONFIGURE'?{writerCapability:capability}:{}) });
      await client.query('INSERT INTO opportunity_catalog.eu_source_control_receipt_v2(request_id,intent_digest,action,actor_id,source_fence,result) VALUES($1,$2,$3,$4,$5,$6)', [input.requestId, intent, action, actorId, after.fence, after]);
      return deepFreeze({ ...after, replayed: false });
    });
  }
  return Object.freeze({ status, suspend: (value, context) => change('SUSPEND', value, context), acknowledgeQuiesced: (value, context) => change('QUIESCE', value, context), resume: (value, context) => change('RESUME', value, context),configureWriter:(value,context)=>change('CONFIGURE',value,context) });
}
module.exports = { FAMILY, command, sourceControlError, assertEuQuiescent, sourceState, createEuSourceControlV2 };
