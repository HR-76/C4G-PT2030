const EVENTS=Object.freeze({
  ASYNC_EFFECT_AUTHORIZED:'CRITICAL_PRE_EFFECT', ASYNC_REPLAY_AUTHORIZED:'CRITICAL_PRE_EFFECT',
  ASYNC_REPLAY_REQUESTED:'CRITICAL_PRE_EFFECT', ASYNC_REPLAY_APPROVED:'CRITICAL_PRE_EFFECT',
  ASYNC_REPLAY_EXECUTION_CREATED:'CRITICAL_PRE_EFFECT',
  ASYNC_AUTHORIZATION_DENIED:'DENY', ASYNC_JOB_OBSERVED:'OBSERVATIONAL', ASYNC_RECONCILIATION_REQUIRED:'OBSERVATIONAL'
});
const EMITTABLE_EVENTS=Object.freeze(new Set(Object.keys(EVENTS).filter(code=>code!=='ASYNC_REPLAY_AUTHORIZED')));
async function emitAsyncAudit(port,event,data){ const category=EVENTS[event]; if(!category) throw new TypeError('Async audit event is not allowlisted.'); try { await port.accept({event,category,data}); return true; } catch { if(category==='CRITICAL_PRE_EFFECT') throw new Error('ASYNC_AUDIT_REQUIRED'); if(category==='DENY') return false; return false; } }
function assertAsyncEventEmittable(event){if(!EMITTABLE_EVENTS.has(event))throw new TypeError('Async audit event is not emittable.');return true;}
module.exports={EVENTS,EMITTABLE_EVENTS,assertAsyncEventEmittable,emitAsyncAudit};
