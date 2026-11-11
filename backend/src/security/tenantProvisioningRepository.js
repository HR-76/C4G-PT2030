const { appendEvent, conflict, findEventSourceState, findMatchingEvent, inCentralTransaction, optionalCode, requireCode } = require('./tenantRepositorySupport');
function createTenantProvisioningRepository(pool) {
  async function changeStatus({ organizationId, fromStatuses, toStatus, expectedRevision, reasonCode=null, correlationId, idempotencyKey }) {
    reasonCode=optionalCode(reasonCode,'reasonCode');
    const actionCode=`PROVISIONING_${toStatus}`;
    const eventFor=(tenantId,sourceState)=>({tenantId,organizationId,aggregateType:'PROVISIONING',aggregateId:organizationId,actionCode,fromState:sourceState,toState:toStatus,reasonCode,correlationId,idempotencyKey,intent:{organizationId,fromStatuses,sourceState,toStatus,expectedRevision,reasonCode}});
    return inCentralTransaction(pool,async client=>{const current=await client.query('SELECT * FROM public.organization_provisioning WHERE organization_id=$1 FOR UPDATE',[organizationId]);if(current.rowCount!==1)throw conflict();const persistedSource=await findEventSourceState(client,{idempotencyKey,actionCode,allowedStates:fromStatuses});const event=eventFor(current.rows[0].tenant_id,persistedSource===null?current.rows[0].status:persistedSource);if(persistedSource!==null){await findMatchingEvent(client,event);if(current.rows[0].status!==toStatus||Number(current.rows[0].revision)!==expectedRevision+1||current.rows[0].last_error_code!==reasonCode)throw conflict();return current.rows[0];}if(!fromStatuses.includes(current.rows[0].status)||Number(current.rows[0].revision)!==expectedRevision)throw conflict();const result=await client.query(`UPDATE public.organization_provisioning SET status=$3,last_error_code=$5,
      completed_at=CASE WHEN $3 IN ('READY','CANCELLED') THEN NOW() ELSE completed_at END
      WHERE organization_id=$1 AND status=$2 AND revision=$4 RETURNING *`,[organizationId,current.rows[0].status,toStatus,expectedRevision,reasonCode]);
      if(result.rowCount!==1)throw conflict();const row=result.rows[0];await appendEvent(client,{...event,tenantId:row.tenant_id});return row;});
  }
  return Object.freeze({
    async start({ organizationId, idempotencyKey, manifestVersion, currentStepCode='QUEUED', correlationId }) {
      currentStepCode=requireCode(currentStepCode,'currentStepCode');
      const event={organizationId,aggregateType:'PROVISIONING',aggregateId:organizationId,actionCode:'PROVISIONING_STARTED',toState:'QUEUED',correlationId,idempotencyKey,intent:{organizationId,manifestVersion,currentStepCode}};
      return inCentralTransaction(pool, async client => {
        await client.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [organizationId]);
        if(await findMatchingEvent(client,event)){const retry=await client.query('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);if(retry.rowCount!==1||retry.rows[0].idempotency_key!==idempotencyKey||retry.rows[0].manifest_version!==manifestVersion||retry.rows[0].current_step_code!==currentStepCode||retry.rows[0].status!=='QUEUED'||retry.rows[0].tenant_assignment_state!=='UNASSIGNED'||retry.rows[0].tenant_id!==null||Number(retry.rows[0].revision)!==1)throw conflict();return retry.rows[0];}
        const found=await client.query('SELECT * FROM public.organization_provisioning WHERE organization_id=$1 OR idempotency_key=$2 FOR UPDATE',[organizationId,idempotencyKey]);
        if(found.rowCount)throw conflict();
        const result=await client.query(`INSERT INTO public.organization_provisioning
          (organization_id,tenant_assignment_state,status,current_step_code,idempotency_key,manifest_version)
          VALUES($1,'UNASSIGNED','QUEUED',$2,$3,$4) RETURNING *`,[organizationId,currentStepCode,idempotencyKey,manifestVersion]);
        await appendEvent(client,event);
        return result.rows[0];
      });
    },
    async assignTenantOnce({ organizationId, tenantId, expectedRevision, correlationId, idempotencyKey }) {
      const event={tenantId,organizationId,aggregateType:'PROVISIONING',aggregateId:organizationId,actionCode:'TENANT_ASSIGNED',fromState:'UNASSIGNED',toState:'ASSIGNED',correlationId,idempotencyKey,intent:{organizationId,tenantId,expectedRevision}};
      return inCentralTransaction(pool, async client => {
        const current=await client.query('SELECT * FROM public.organization_provisioning WHERE organization_id=$1 FOR UPDATE',[organizationId]);
        if(current.rowCount!==1)throw conflict(); const row=current.rows[0];
        if(await findMatchingEvent(client,event)){if(row.tenant_id!==tenantId||row.tenant_assignment_state!=='ASSIGNED'||Number(row.revision)!==expectedRevision+1)throw conflict();return row;}
        if(row.tenant_id===tenantId)throw conflict();
        if(row.tenant_id!==null||Number(row.revision)!==expectedRevision)throw conflict();
        const result=await client.query(`UPDATE public.organization_provisioning SET tenant_id=$2,tenant_assignment_state='ASSIGNED'
          WHERE organization_id=$1 AND revision=$3 RETURNING *`,[organizationId,tenantId,expectedRevision]);
        if(result.rowCount!==1)throw conflict();
        await appendEvent(client,event);
        return result.rows[0];
      });
    },
    beginProvisioning: args=>changeStatus({...args,fromStatuses:['QUEUED'],toStatus:'RUNNING'}),
    beginVerification: args=>changeStatus({...args,fromStatuses:['RUNNING'],toStatus:'VERIFYING'}),
    markReady: args=>changeStatus({...args,fromStatuses:['VERIFYING'],toStatus:'READY'}),
    markFailed: args=>changeStatus({...args,fromStatuses:['RUNNING','VERIFYING'],toStatus:'FAILED'}),
    retryFailed: args=>changeStatus({...args,fromStatuses:['FAILED'],toStatus:'QUEUED'}),
    cancel: args=>changeStatus({...args,fromStatuses:['QUEUED','RUNNING'],toStatus:'CANCELLED'})
  });
}
module.exports={createTenantProvisioningRepository};
