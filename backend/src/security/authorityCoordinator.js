'use strict';
const { randomUUID, createHash,createHmac } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const {transactionControlStatements}=require('./sqlTransactionControl');

const coordinators = new WeakSet();
const hash = value => createHash('sha256').update(value).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function scope({ organizationId, subjectId, membershipId, sessionDigest, approvalSubjectId, approvalMembershipId }) {
  return [...new Set(['POLICY', `ORG:${organizationId}`, `SUBJECT:${subjectId}`, `MEMBER:${membershipId}`, `SESSION:${sessionDigest}`,
    ...(approvalSubjectId ? [`SUBJECT:${approvalSubjectId}`, `MEMBER:${approvalMembershipId}`] : [])])].sort();
}
function isAuthorityCoordinator(value) { return coordinators.has(value); }

// Root-owned, never mounted as a functional/admin API. Metadata locks are short;
// durable pending rows, not a live process or an expiring lock, block writers.
function createAuthorityCoordinator({ pool,permitSecret, clock = { now: () => new Date() }, waitMs = 25, timeoutMs = 10000, isolatedCatalogAdmission = null, isolatedSessionReadConcurrency = false, observeTiming = null }) {
  if (!pool?.connect || !pool?.query) throw new TypeError('Central authority pool required.');
  if(typeof permitSecret!=='string'||Buffer.byteLength(permitSecret)<32)throw new TypeError('Private durable authority permit secret required.');
  if(isolatedCatalogAdmission&&!require('../opportunities/catalogRead/isolatedAdmission').isIsolatedAdmission(isolatedCatalogAdmission))throw new TypeError('Invalid isolated admission capability');
  if(isolatedSessionReadConcurrency&&!isolatedCatalogAdmission)throw new TypeError('Isolated admission required for concurrent session reads');
  const timing=require('./sessionTiming').createTiming(observeTiming);
  const sessionLookup='SELECT sess FROM \"public\".\"application_session_store\" WHERE sid = $1 AND expire >= to_timestamp($2)';
  const finalPermit=(id,transactionId,tenantId)=>createHmac('sha256',permitSecret).update(`authority-final-v1:${id}:${transactionId}:${tenantId}`).digest('hex');
  const tokens = new WeakMap(), local = new AsyncLocalStorage(), recoveryPorts = new Map();
  let runtimeRecoveryPort = null;
  const now = () => new Date(clock.now()).getTime();
  async function transaction(callback, deadline = now() + timeoutMs, readOnly = false) {
    if (now() >= deadline) fail('AUTHORITY_DEADLINE');
    const category=readOnly?'sessionRead':'authority';
    const poolStart=performance.now();
    let connectTimer;
    const connecting=Promise.resolve().then(()=>pool.connect());
    let abandoned=false;
    connecting.then(client=>{if(abandoned)client.release(new Error('AUTHORITY_DEADLINE'));},()=>{});
    let client;
    try { client=await Promise.race([connecting,new Promise((resolve,reject)=>{
      connectTimer=setTimeout(()=>{abandoned=true;const error=new Error('AUTHORITY_DEADLINE');error.code=error.message;reject(error);},Math.max(1,deadline-now()));
    })]); } finally {clearTimeout(connectTimer);timing.record(category+'.pool',performance.now()-poolStart);}
    let open = false, active = true, failed = null, timer,fatalReject;
    const fatal=new Promise((resolve,reject)=>{fatalReject=reject;});fatal.catch(()=>{});
    const onError=error=>{active=false;fatalReject(error);};
    client.on?.('error',onError);
    try {
      const admittedSchema = await timing.measure(category+'.admission',()=>isolatedCatalogAdmission?isolatedCatalogAdmission.admit(client):require('./authoritySecurityManifest').assertAuthorityAdmission(client));
      await client.query(readOnly?'BEGIN READ ONLY':'BEGIN'); open = true;
      await client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)", [`${Math.max(1, deadline-now())}ms`]);
      await client.query("SELECT set_config('idle_in_transaction_session_timeout',$1,true)", [`${Math.max(1,deadline-now())}ms`]);
      const identity=await client.query("SELECT EXISTS(SELECT 1 FROM public.c4g_database_identity WHERE product_code='C4G' AND database_role='CENTRAL') AS valid");
      if(identity.rows[0]?.valid!==true)fail('AUTHORITY_CENTRAL_REQUIRED');
      await timing.measure(category+'.lock',()=>client.query(readOnly?'SELECT pg_advisory_xact_lock_shared(43001306,1)':'SELECT pg_advisory_xact_lock(43001306,1)'));
      await timing.measure(category+'.verify',()=>isolatedCatalogAdmission?isolatedCatalogAdmission.verifyLocked(client,admittedSchema):require('./authoritySecurityManifest').assertAuthoritySecurity(client, admittedSchema?.currentVersion));
      const scoped=Object.freeze({query(sql,values=[],callback){
        if(!active||now()>=deadline)fail('AUTHORITY_DEADLINE');
        if(typeof values==='function'){callback=values;values=[];}
        let result;
        if(typeof sql==='string'&&/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) authority_[a-f0-9]+$/.test(sql))result=client.query(sql);
        else result=require('./authorityProtocolQueries').execute(client,sql,values);
        if(callback){result.then(value=>callback(null,value),callback);return;}
        return result;
      },finish(sql,values,permit){return require('./authorityProtocolQueries').execute(client,sql,values,permit);}});
      const work=local.run(scoped,()=>callback(scoped));
      const result=await Promise.race([work,fatal,new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{active=false;const error=new Error('AUTHORITY_DEADLINE');error.code=error.message;reject(error);},Math.max(1,deadline-now()));
      })]);
      if (now() >= deadline) fail('AUTHORITY_DEADLINE');
      await client.query('COMMIT'); open = false;
      return result;
    } catch (error) {
      failed=error;
      if (open) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { active=false;clearTimeout(timer);client.removeListener?.('error',onError);client.release(failed||undefined); }
  }
  // Reads during protected validation use the metadata transaction connection.
  // Nested repository transactions become savepoints, not independent commits.
  const coordinatedPool = Object.freeze({
    query: (...args) => {
      if(local.getStore())return local.getStore().query(...args);
      const callback=typeof args.at(-1)==='function'?args.pop():null;
      const sql=typeof args[0]==='string'?args[0]:args[0]?.text;
      const oneWrite=typeof sql==='string'&&!/;|\b(ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i.test(sql)
        && (sql.match(/\b(INSERT|UPDATE|DELETE)\b/gi)||[]).length===1;
      const heartbeat=oneWrite&&/^\s*UPDATE\s+public\.application_session\s+AS\s+aps\s+SET\s+last_seen_at\s*=\s*\$\d+\s+FROM\b/i.test(sql);
      const oidc=oneWrite&&/^\s*(INSERT\s+INTO|UPDATE)\s+public\.oidc_transaction\b/i.test(sql);
      let result;
      if(typeof sql!=='string'||transactionControlStatements(sql).length||(!heartbeat&&!oidc&&/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i.test(sql)))
        result=Promise.reject(Object.assign(new Error('AUTHORITY_COORDINATOR_REQUIRED'),{code:'AUTHORITY_COORDINATOR_REQUIRED'}));
      else result=transaction(client=>client.query(...args),undefined,isolatedSessionReadConcurrency===true&&sql.replace(/\s+/g,' ').trim()===sessionLookup);
      if(callback){result.then(value=>callback(null,value),callback);return;}
      return result;
    },
    async connect() {
      const client = local.getStore();
      if (!client) fail('AUTHORITY_COORDINATOR_REQUIRED');
      const name = `authority_${randomUUID().replaceAll('-', '')}`;
      return Object.freeze({ release() {}, query(sql, values) {
        if (sql === 'BEGIN') return client.query(`SAVEPOINT ${name}`);
        if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${name}`);
        if (sql === 'ROLLBACK') return client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return client.query(sql, values);
      } });
    }
  });
  async function finish(id, state, result) {
    return transaction(async client => {
      const row = (await client.query('SELECT * FROM public.authority_commit_guard WHERE guard_id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) fail('AUTHORITY_GUARD_UNKNOWN');
      if (!['PREPARED','TENANT_COMMIT_UNKNOWN'].includes(row.state)) return row;
      return (await client.finish(`UPDATE public.authority_commit_guard SET state=$2,reconciliation_result=$3,
        updated_at=clock_timestamp(),resolved_at=clock_timestamp() WHERE guard_id=$1 RETURNING *`, [id,state,result],
        finalPermit(id,row.transaction_id,row.tenant_id))).rows[0];
    });
  }
  async function recover(id, allowActive = false, deadline=now()+timeoutMs) {
    const row = (await coordinatedPool.query('SELECT * FROM public.authority_commit_guard WHERE guard_id=$1', [id])).rows[0];
    if (!row) fail('AUTHORITY_GUARD_UNKNOWN');
    if (!['PREPARED','TENANT_COMMIT_UNKNOWN'].includes(row.state)) return row;
    if (!allowActive && now() < new Date(row.deadline).getTime()) fail('AUTHORITY_LEASE_ACTIVE');
    const port = recoveryPorts.get(row.tenant_id) || runtimeRecoveryPort;
    if (!port) fail('AUTHORITY_RECOVERY_UNAVAILABLE');
    // The source port must prove termination via the original transaction nonce
    // lock before returning its idempotency observation. No deadline-only abort.
    if(now()>=deadline)fail('AUTHORITY_DEADLINE');
    let recoveryTimer;
    const recovering=port(Object.freeze(row),{deadline});
    const evidence=await Promise.race([recovering,new Promise((resolve,reject)=>{
      recoveryTimer=setTimeout(()=>reject(Object.assign(new Error('AUTHORITY_RECOVERY_TIMEOUT'),{code:'AUTHORITY_RECOVERY_TIMEOUT'})),Math.max(1,deadline-now()));
    })]).finally(()=>clearTimeout(recoveryTimer));
    if (!evidence || evidence.transactionId !== row.transaction_id || evidence.terminal !== true
        || !['COMMITTED','ROLLED_BACK','READ_TERMINAL'].includes(evidence.outcome)) fail('AUTHORITY_RECOVERY_UNPROVEN');
    return finish(id, 'RECOVERED', evidence.outcome);
  }
  async function write(keys, mutation, deadline = now() + timeoutMs) {
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string'
      || !/^(POLICY|(ORG|SUBJECT|MEMBER):[0-9a-f-]{36}|SESSION:[a-f0-9]{64})$/.test(key))) fail('AUTHORITY_SCOPE_INVALID');
    const requestId=randomUUID();
    await transaction(async client=>{
      await client.query(`INSERT INTO public.authority_write_request(request_id,scope_keys,epoch,state,deadline)
        VALUES($1,$2,nextval('public.authority_epoch_seq'),'WAITING',$3)`,[requestId,[...new Set(keys)].sort(),new Date(deadline)]);
      await client.query(`INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase)
        SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'REGISTER'
        FROM public.authority_write_request WHERE request_id=$1`,[requestId]);
      await client.query(`INSERT INTO public.authority_scope_epoch(scope_key,epoch)
        SELECT key,r.epoch FROM public.authority_write_request r CROSS JOIN unnest(r.scope_keys) AS key WHERE request_id=$1
        ON CONFLICT(scope_key) DO UPDATE SET epoch=EXCLUDED.epoch`,[requestId]);
      await client.query('DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()');
    },deadline);
    try { while (now() < deadline) {
      const attempt = await transaction(async client => {
        const request=(await client.query(`SELECT state,deadline FROM public.authority_write_request WHERE request_id=$1 FOR UPDATE`,[requestId])).rows[0];
        if(request?.state!=='WAITING'||now()>=new Date(request.deadline).getTime())fail('AUTHORITY_DEADLINE');
        await client.query(`UPDATE public.authority_write_request SET state='CANCELLED',finished_at=clock_timestamp()
          WHERE state='WAITING' AND deadline<=clock_timestamp()`);
        const earlier=(await client.query(`SELECT request_id FROM public.authority_write_request
          WHERE state='WAITING' AND scope_keys && $1::text[] AND epoch<(SELECT epoch FROM public.authority_write_request WHERE request_id=$2)`,[keys,requestId])).rows;
        if(earlier.length)return{pending:[]};
        const pending = (await client.query(`SELECT guard_id,deadline FROM public.authority_commit_guard
          WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN') AND scope_keys && $1::text[] ORDER BY authority_epoch`, [keys])).rows;
        if (pending.length) return { pending };
        await client.query(`INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase)
          SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'APPLY'
          FROM public.authority_write_request WHERE request_id=$1`,[requestId]);
        const result = await mutation(coordinatedPool);
        await client.query(`UPDATE public.authority_write_request SET state='APPLIED',finished_at=clock_timestamp() WHERE request_id=$1`,[requestId]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        await client.query('DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()');
        return { result };
      }, deadline);
      if (!attempt.pending) return attempt.result;
      for (const row of attempt.pending) if (new Date(row.deadline).getTime() <= now()) await recover(row.guard_id,false,deadline);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, Math.max(1,deadline-now()))));
    }
    fail('AUTHORITY_DEADLINE');
    } finally {
      // If APPLY committed but its acknowledgement was lost, APPLIED is never
      // overwritten. WAITING proves no authority effect committed: the deferred
      // trigger requires APPLIED atomically with every relevant source write.
      await transaction(client=>client.query(`UPDATE public.authority_write_request SET state='CANCELLED',finished_at=clock_timestamp()
        WHERE request_id=$1 AND state='WAITING'`,[requestId])).catch(()=>{});
    }
  }
  const coordinator = Object.freeze({
    pool: coordinatedPool,
    write,
    withAuthority:callback=>local.getStore()?callback():transaction(()=>callback()),
    async snapshotEpochs(keys) {
      const pending=(await coordinatedPool.query(`SELECT request_id FROM public.authority_write_request WHERE state='WAITING' AND scope_keys && $1::text[]`,[keys])).rows;
      if(pending.length)fail('AUTHORITY_WRITE_PENDING');
      const rows=(await coordinatedPool.query('SELECT scope_key,epoch::text FROM public.authority_scope_epoch WHERE scope_key=ANY($1::text[]) ORDER BY scope_key',[keys])).rows;
      return Object.freeze(Object.fromEntries([...keys].sort().map(key=>[key,rows.find(row=>row.scope_key===key)?.epoch||'0'])));
    },
    async validateEpochs(expected) {
      if(!expected || !Object.keys(expected).length)fail('AUTHORITY_EPOCH_INVALID');
      const current=await coordinator.snapshotEpochs(Object.keys(expected));
      if(Object.keys(expected).some(key=>current[key]!==expected[key]))fail('AUTHORITY_STALE');
      return current;
    },
    sessionKey: sid => `SESSION:${hash(sid)}`,
    bindAuthority({sessionAuthority,authorization,operationCatalog,permissionCatalog,recentMfaRequirement,leaseMs=10000}) {
      if(!require('./authenticatedAuthority').isTaxonomySessionAuthority(sessionAuthority)
        || !require('../authorization/resourceAuthorization').isResourceAuthorization(authorization)
        || !operationCatalog?.resolve || !permissionCatalog?.resolve || !Number.isSafeInteger(leaseMs) || leaseMs<100 || leaseMs>10000)fail('AUTHORITY_PORT_INVALID');
      return Object.freeze({async protect(client,{handle,operationCode,resource,intention,additionalAuthorizations=[],approvalEvidence=null,referenceDeadline=null}) {
        const physical=require('./tenantLeaseExecutor').preparedAuthorityBinding(client);
        // End this short validation transaction before prepare opens its own
        // fresh transaction and makes the guard durable. Never include tenant
        // work or authorization/audit effects in this outer callback.
        const {identity,original}=await coordinator.withAuthority(async()=>{
          const identity=await sessionAuthority.guardIdentity(handle);
          const original=await sessionAuthority.resolve(handle);
          return {identity,original};
        });
        if(original.actor.organizationId!==physical.organizationId || resource.organizationId!==physical.organizationId)fail('AUTHORITY_SCOPE_INVALID');
        const operation=operationCatalog.resolve(operationCode);
        if(!operation || operation.resourceType!==resource.resourceType || physical.operationCode!==operationCode)fail('AUTHORITY_OPERATION_INVALID');
        if(!Array.isArray(additionalAuthorizations)||additionalAuthorizations.length>100||additionalAuthorizations.some(item=>
          !(require('./interestAuthorityDependencies').allowsInterestDependency(operationCode,intention,item)
            || require('./notificationAuthorityDependencies').allowsNotificationReadDependency(operationCode,intention,resource,item,physical.organizationId)
            || (item.operationCode==='DOCUMENT_READ'&&item.resource?.resourceType==='DOCUMENT')
            || (item.operationCode==='F13_PROFILE_READ'&&item.resource?.resourceType==='PROFILE_PROJECTION'
              && ['F13_COMPETENCY_DRAFT_EDIT','F13_EXPERIENCE_DRAFT_EDIT','F13_EVIDENCE_ATTACH','F13_COMPETENCY_VERIFY','F13_ASSERTION_REVOKE'].includes(operationCode)
              && intention?.operation?.startsWith('PQ1_UI_'))
            || (operationCode==='F13_PROFILE_READ'&&intention?.operation==='PQ1_EFFECTIVE_READ'&&item.operationCode==='F13_PROFILE_READ'&&item.resource?.resourceType==='PROFILE_PROJECTION')
            || (operationCode==='ORGANIZATION_DIRECTORY_READ'&&item.operationCode==='ORGANIZATIONAL_SCOPE_READ'&&item.resource?.resourceType==='ORGANIZATIONAL_SCOPE')
            || (operationCode==='APPLICATION_READ'&&['APPLICATION_REPORT','APPLICATION_DASHBOARD_CONTEXT'].includes(intention?.operation)
              && ({ORGANIZATION_DIRECTORY_READ:'ORGANIZATION',ORGANIZATIONAL_SCOPE_READ:'ORGANIZATIONAL_SCOPE'})[item.operationCode]===item.resource?.resourceType)
            || (operationCode==='ORGANIZATION_DIRECTORY_EDIT'
              && ({ORGANIZATIONAL_SCOPE_READ:'ORGANIZATIONAL_SCOPE',ORGANIZATIONAL_SCOPE_CREATE:'ORGANIZATION',ORGANIZATIONAL_SCOPE_RENAME:'ORGANIZATIONAL_SCOPE',ORGANIZATIONAL_SCOPE_REPARENT:'ORGANIZATIONAL_SCOPE'})[item.operationCode]===item.resource?.resourceType)
            || (['APPLICATION_CREATE','APPLICATION_READ','APPLICATION_EDIT','APPLICATION_TRANSITION','APPLICATION_WORK_READ','APPLICATION_WORK_EDIT','APPLICATION_CHAT_READ','APPLICATION_CHAT_SEND','APPLICATION_DOCUMENT_READ','APPLICATION_DOCUMENT_EDIT','APPLICATION_REVIEW_DECIDE'].includes(operationCode)
              && ({OPPORTUNITY_READ:'OPPORTUNITY',F14_PREQUALIFICATION_READ:'PREQUALIFICATION_EVALUATION'})[item.operationCode]===item.resource?.resourceType)
            || (operationCode==='APPLICATION_DOCUMENT_EDIT'
              && ({DOCUMENT_UPLOAD_INITIATE:'DOCUMENT',DOCUMENT_UPLOAD_CONFIRM:'DOCUMENT_VERSION',DOCUMENT_VERSION_CREATE:'DOCUMENT'})[item.operationCode]===item.resource?.resourceType)
            || (['F13_PROFILE_COHORT_ACTIVATE','F14_PREQUALIFICATION_EVALUATE','F14_PREQUALIFICATION_READ','F14_PREQUALIFICATION_DECIDE'].includes(operationCode)
              && ({F14_PREQUALIFICATION_READ:'PREQUALIFICATION_EVALUATION',F13_PROFILE_READ:'PROFILE_PROJECTION',OPPORTUNITY_READ:'OPPORTUNITY',OPPORTUNITY_CRITERIA_READ:'OPPORTUNITY_CRITERIA_SET'})[item.operationCode]===item.resource?.resourceType)) || item.resource.organizationId!==physical.organizationId))fail('AUTHORITY_OPERATION_INVALID');
        const reviewerEvidence=operationCode==='APPLICATION_DOCUMENT_EDIT'&&resource.resourceType==='APPLICATION'
          &&intention?.operation==='APPLICATION_REVIEW_REQUEST'&&UUID.test(intention?.key)
          &&/^[a-f0-9]{64}$/.test(intention?.digest||'')&&approvalEvidence?.applicationId===resource.id
          &&approvalEvidence?.intentionDigest===intention.digest;
        if (approvalEvidence && (!(reviewerEvidence||['F13_PROFILE_PUBLISH','F13_PROFILE_COHORT_ACTIVATE'].includes(operationCode))
          || !UUID.test(approvalEvidence.subjectId) || !UUID.test(approvalEvidence.membershipId)
          || !approvalEvidence.scopeEpochs
          || JSON.stringify(Object.keys(approvalEvidence.scopeEpochs).sort())!==JSON.stringify(
            ['POLICY',`ORG:${physical.organizationId}`,`SUBJECT:${approvalEvidence.subjectId}`,`MEMBER:${approvalEvidence.membershipId}`].sort()))) fail('AUTHORITY_APPROVAL_INVALID');
        // Only explicit null means an approval without a membership expiry.
        // Validate before prepare so invalid/expired evidence keeps its refusal.
        if (approvalEvidence && approvalEvidence.validUntil!==null
          && (!Number.isSafeInteger(approvalEvidence.validUntil)||approvalEvidence.validUntil<=now())) fail('F13_APPROVAL_STALE');
        const approvalDeadline=approvalEvidence && approvalEvidence.validUntil!==null ? approvalEvidence.validUntil : Infinity;
        if (referenceDeadline !== null && (!Number.isSafeInteger(referenceDeadline) || referenceDeadline <= now())) fail('F13_APPROVAL_STALE');
        const sensitive=permissionCatalog.resolve(operation.permission)?.sensitive;
        const mfaDeadline=sensitive?(original.assuranceEvidence?.authTime+recentMfaRequirement.maxAgeSeconds)*1000:Infinity;
        if(sensitive&&(!Number.isFinite(mfaDeadline)||mfaDeadline<=now()))fail('AUTHORITY_DENIED');
        let decision,trusted,editorialAuthorityEvidence;
        const token=await coordinator.prepare({...physical,subjectId:original.actor.id,membershipId:original.actor.membershipId,
          ...(approvalEvidence ? {approvalSubjectId:approvalEvidence.subjectId,approvalMembershipId:approvalEvidence.membershipId}:{}),
          sessionDigest:identity.sessionDigest,idempotencyKey:intention?.key,intentionDigest:intention?.digest,
          sourceBinding:{...physical.sourceBinding,sourceOperation:intention?.operation||null},
          deadline:Math.min(physical.deadline,now()+leaseMs,identity.expiresAt,approvalDeadline,referenceDeadline === null ? Infinity : referenceDeadline,mfaDeadline)
        },async()=>{
          const current=await sessionAuthority.resolve(handle);
          const currentIdentity=await sessionAuthority.guardIdentity(handle);
          if(currentIdentity.sessionDigest!==identity.sessionDigest || currentIdentity.revocationVersion!==identity.revocationVersion)fail('AUTHORITY_STALE');
          trusted=Object.freeze({...current,correlationId:physical.correlationId,organizationId:physical.organizationId});
          decision=await authorization.authorize(operationCode,trusted,resource);
          if(!decision.allowed || !decision.evaluation)fail('AUTHORITY_DENIED');
          if (approvalEvidence) {
            try { await coordinator.validateEpochs(approvalEvidence.scopeEpochs); }
            catch { fail('F13_APPROVAL_STALE'); }
            if (approvalEvidence.policyVersion!==decision.evaluation.policyVersion
              || approvalEvidence.permissionCatalogVersion!==decision.evaluation.permissionCatalogVersion
              || approvalEvidence.operationCatalogVersion!==decision.evaluation.operationCatalogVersion
              || (approvalEvidence.validUntil!==null && (!Number.isSafeInteger(approvalEvidence.validUntil)||approvalEvidence.validUntil<=now()))) fail('F13_APPROVAL_STALE');
          }
          const protectedOperations=[{operation:operationCode,permission:operation.permission,resourceType:resource.resourceType,resourceId:resource.id}];
          for(const item of additionalAuthorizations){
            const extra=await authorization.authorize(item.operationCode,trusted,item.resource);
            if(!extra.allowed||!extra.evaluation||['membershipVersion','authorizationVersion','policyVersion','permissionCatalogVersion','operationCatalogVersion'].some(key=>extra.evaluation[key]!==decision.evaluation[key]))fail('AUTHORITY_DENIED');
            const catalogEntry=operationCatalog.resolve(item.operationCode);
            protectedOperations.push({operation:item.operationCode,permission:catalogEntry.permission,resourceType:item.resource.resourceType,resourceId:item.resource.id});
          }
          const scopeEpochs=await coordinator.snapshotEpochs(scope({organizationId:physical.organizationId,subjectId:original.actor.id,
            membershipId:original.actor.membershipId,sessionDigest:identity.sessionDigest}));
          if(operationCode==='F13_PROFILE_APPROVE') {
            // Persist authority independent of the approver's session lifetime.
            // Subject/member/policy epochs are protected by the same guard.
            const member=(await coordinatedPool.query(`SELECT m.id,m.organization_id,m.global_user_id,m.membership_version,m.status,m.valid_until
      FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id
      JOIN public.global_user u ON u.id=m.global_user_id WHERE m.id=$1 AND m.organization_id=$2
      AND o.status='ACTIVE' AND u.status='ACTIVE' AND m.valid_from<=clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())`,[original.actor.membershipId,physical.organizationId])).rows[0];
            if(!member || member.status!=='ACTIVE' || member.global_user_id!==original.actor.id)fail('AUTHORITY_STALE');
            editorialAuthorityEvidence=Object.freeze({...decision.evaluation,subjectId:original.actor.id,membershipId:original.actor.membershipId,
              validUntil:member.valid_until?new Date(member.valid_until).getTime():null,
              scopeEpochs:Object.fromEntries(Object.entries(scopeEpochs).filter(([key])=>!key.startsWith('SESSION:')))});
          }
          return{versions:{...decision.evaluation,sessionRevocationVersion:identity.revocationVersion,scopeEpochs},
            assurance:{level:decision.evaluation.assuranceLevel,policyVersion:decision.evaluation.policyVersion},
            operations:protectedOperations};
        },client);
        return Object.freeze({token,decision:Object.freeze({...decision,trustedContext:trusted}),editorialAuthorityEvidence});
      }});
    },
    async prepare(binding, validate, physicalClient) {
      if (!physicalClient || typeof validate !== 'function') fail('AUTHORITY_BINDING_INVALID');
      for (const key of ['tenantId','organizationId','subjectId','membershipId','transactionId','correlationId'])
        if (!UUID.test(binding[key])) fail('AUTHORITY_BINDING_INVALID');
      if ((binding.approvalSubjectId || binding.approvalMembershipId)
        && (!UUID.test(binding.approvalSubjectId)||!UUID.test(binding.approvalMembershipId)||!(
          ['F13_PROFILE_PUBLISH','F13_PROFILE_COHORT_ACTIVATE'].includes(binding.operationCode)
          || (binding.operationCode==='APPLICATION_DOCUMENT_EDIT'&&binding.sourceBinding?.sourceOperation==='APPLICATION_REVIEW_REQUEST'
            &&UUID.test(binding.idempotencyKey||'')&&/^[a-f0-9]{64}$/.test(binding.intentionDigest||''))))) fail('AUTHORITY_BINDING_INVALID');
      if (!/^[a-f0-9]{64}$/.test(binding.sessionDigest) || !Number.isFinite(binding.deadline) || binding.deadline<=now()) fail('AUTHORITY_BINDING_INVALID');
      const id = randomUUID();
      const row = await transaction(async client => {
        const pending=(await client.query(`SELECT request_id FROM public.authority_write_request WHERE state='WAITING' AND scope_keys && $1::text[]`,[scope(binding)])).rows;
        if(pending.length)fail('AUTHORITY_WRITE_PENDING');
        const validated = await validate();
        if (!validated?.versions || !validated?.assurance || !Array.isArray(validated.operations) || !validated.operations.length) fail('AUTHORITY_INVALID');
        if(Object.keys(validated.versions).some(key=>!['assuranceLevel','policyVersion','membershipVersion','authorizationVersion',
          'permissionCatalogVersion','operationCatalogVersion','sessionRevocationVersion','scopeEpochs'].includes(key))
          || Object.keys(validated.assurance).some(key=>!['level','policyVersion'].includes(key))
          || !['SESSION','RECENT_MFA'].includes(validated.assurance.level)
          || validated.operations.some(operation=>Object.keys(operation).some(key=>!['operation','permission','resourceType','resourceId'].includes(key))
            || !UUID.test(operation.resourceId) || !/^[A-Z0-9_]{1,128}$/.test(operation.operation)
            || !/^[a-z0-9_.]{1,128}$/.test(operation.permission) || !/^[A-Z0-9_]{1,128}$/.test(operation.resourceType))) fail('AUTHORITY_INVALID');
        if(['membershipVersion','authorizationVersion','sessionRevocationVersion'].some(key=>
          !Number.isSafeInteger(validated.versions[key])||validated.versions[key]<1)
          || validated.versions.assuranceLevel!==validated.assurance.level || validated.versions.policyVersion!==validated.assurance.policyVersion
          || !/^[a-zA-Z0-9_.-]{1,128}$/.test(validated.assurance.policyVersion))fail('AUTHORITY_INVALID');
        if(Object.keys(binding.sourceBinding).some(key=>!['snapshotDigest','backendPid','backendStart','sourceOperation'].includes(key))
          || !/^[a-f0-9]{64}$/.test(binding.sourceBinding.snapshotDigest)
          || !Number.isSafeInteger(binding.sourceBinding.backendPid)
          || !Number.isFinite(Date.parse(binding.sourceBinding.backendStart))
          || (binding.idempotencyKey && (!UUID.test(binding.idempotencyKey)||!/^[a-f0-9]{64}$/.test(binding.intentionDigest)))) fail('AUTHORITY_BINDING_INVALID');
        return (await client.query(`INSERT INTO public.authority_commit_guard(guard_id,organization_id,tenant_id,subject_id,
          membership_id,session_digest,scope_keys,protected_operations,authority_versions,normalized_assurance,authority_epoch,
          transaction_id,correlation_id,idempotency_key,intention_digest,source_binding,state,deadline,finalization_digest)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,nextval('public.authority_epoch_seq'),$11,$12,$13,$14,$15,'PREPARED',$16,$17) RETURNING *`,
          [id,binding.organizationId,binding.tenantId,binding.subjectId,binding.membershipId,binding.sessionDigest,scope(binding),
            JSON.stringify(validated.operations),JSON.stringify(validated.versions),JSON.stringify(validated.assurance),binding.transactionId,
            binding.correlationId,binding.idempotencyKey||null,binding.intentionDigest||null,JSON.stringify(binding.sourceBinding),new Date(binding.deadline),
            hash(finalPermit(id,binding.transactionId,binding.tenantId))])).rows[0];
      }, binding.deadline);
      const token = Object.freeze({});
      tokens.set(token, { id, epoch: row.authority_epoch, client: physicalClient, binding, active: true });
      return token;
    },
    assert(token, client, transactionId) {
      const value = tokens.get(token);
      if (!value?.active || value.client!==client || value.binding.transactionId!==transactionId || now()>=value.binding.deadline) fail('AUTHORITY_GUARD_STALE');
    },
    async complete(token, outcome) {
      const value = tokens.get(token);
      if (!value?.active) fail('AUTHORITY_GUARD_STALE');
      value.active = false;
      if (outcome === 'UNKNOWN') return transaction(client => client.finish(`UPDATE public.authority_commit_guard
        SET state='TENANT_COMMIT_UNKNOWN',updated_at=clock_timestamp() WHERE guard_id=$1 AND state='PREPARED'`, [value.id],
        finalPermit(value.id,value.binding.transactionId,value.binding.tenantId)));
      if (!['COMMITTED','ROLLED_BACK','READ_TERMINAL'].includes(outcome)) fail('AUTHORITY_OUTCOME_INVALID');
      return finish(value.id, outcome==='ROLLED_BACK'?'ABORTED':'TENANT_COMMITTED', outcome);
    },
    registerRecovery(tenantId, port) {
      if (!UUID.test(tenantId) || !require('./tenantAuthorityRecovery').isTenantAuthorityRecovery(port)
          || (recoveryPorts.has(tenantId)&&recoveryPorts.get(tenantId)!==port)) fail('AUTHORITY_RECOVERY_BINDING_INVALID');
      recoveryPorts.set(tenantId, port);
    },
    registerRuntimeRecovery(port) {
      if (!require('./tenantAuthorityRecovery').isTenantAuthorityRecovery(port)
          || (runtimeRecoveryPort && runtimeRecoveryPort !== port)) fail('AUTHORITY_RECOVERY_BINDING_INVALID');
      // The branded port resolves and verifies the guard's original tenant on
      // demand, including after restart before any functional tenant request.
      runtimeRecoveryPort = port;
    },
    recover,
    async reconcile(token) {
      const value=tokens.get(token);
      if (!value) fail('AUTHORITY_GUARD_UNKNOWN');
      value.active=false;
      return recover(value.id,true);
    },
    async recoverExpired(limit = 100) {
      if (!Number.isSafeInteger(limit) || limit<1 || limit>100) fail('AUTHORITY_LIMIT_INVALID');
      await transaction(client=>client.query(`UPDATE public.authority_write_request SET state='CANCELLED',finished_at=clock_timestamp()
        WHERE state='WAITING' AND deadline<=clock_timestamp()`));
      const rows = (await coordinatedPool.query(`SELECT guard_id FROM public.authority_commit_guard
        WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN') AND deadline<=clock_timestamp() ORDER BY authority_epoch LIMIT $1`, [limit])).rows;
      const results=[];
      for (const row of rows) { try { results.push(await recover(row.guard_id)); } catch (error) { results.push({ code: error.code || 'AUTHORITY_RECOVERY_UNAVAILABLE' }); } }
      return results;
    }
  });
  coordinators.add(coordinator);
  return coordinator;
}
module.exports = { createAuthorityCoordinator, isAuthorityCoordinator, scope, hash };
