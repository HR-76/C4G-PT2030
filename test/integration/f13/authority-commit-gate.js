'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fork}=require('node:child_process');
const path=require('node:path');
const {centralAuthorityFixture}=require('./central-authority-fixture');
const {runtimeFixture}=require('./runtime-fixture');
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
const {createMembershipRepository}=require('../../../backend/src/security/membershipRepository');
const {createTaxonomyRuntimeComposition}=require('../../../backend/src/organizationalProfile/taxonomyComposition');
const {createTaxonomyTelemetry}=require('../../../backend/src/organizationalProfile/taxonomyTelemetry');
const {preflightCentral}=require('../../../backend/src/security/centralMigrationPreflight');
const {centralSchemaSnapshot,schemaFingerprint}=require('../../../backend/src/security/centralSchemaManifest');
async function until(check,timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('AUTHORITY_TEST_BARRIER_TIMEOUT');}
function barrier(){let arrive,resume;return{arrived:new Promise(resolve=>{arrive=resolve;}),resume:null,async pause(){arrive();await new Promise(resolve=>{resume=resolve;});},release(){resume?.();}};}
function command(){return{releaseId:randomUUID(),thematicSchemeId:randomUUID(),prioritySchemeId:randomUUID(),releaseVersion:`guard-${randomUUID()}`,
  semanticDigest:'a'.repeat(64),defaultLocale:'pt-PT',idempotencyKey:randomUUID(),provenance:{sourceType:'ORGANIZATION_MANUAL',observedAt:new Date().toISOString()}};}
async function counts(pool,cmd){return(await pool.query(`SELECT
  (SELECT count(*)::int FROM organization_profile.catalog_release WHERE release_id=$1) AS mutations,
  (SELECT count(*)::int FROM audit.event WHERE event_data#>>'{resource,id}'=$1::text) AS events,
  (SELECT count(*)::int FROM organization_profile.taxonomy_idempotency_record WHERE idempotency_key=$2) AS results`,[cmd.releaseId,cmd.idempotencyKey])).rows[0];}
async function verifyAuthorityCommitProtocol({pool,otherPool,organizationId,generationId,otherOrganizationId,otherGenerationId}){
  const central=await centralAuthorityFixture(process.env.F13_S2_ADMIN_URL),fixtures=[],decisions=[];
  const acl=await require('./authority-acl-gate').authorityAclFixture(central);
  let finalHook=null,loadHook=null,loseCommit=false;
  const preparedPool={async connect(){const client=await pool.connect();return{release:error=>client.release(error),async query(sql,values){
    const result=await client.query(sql,values);
    if(loadHook&&sql.includes('FROM organization_profile.catalog_release')&&sql.includes('FOR UPDATE')){const hook=loadHook;loadHook=null;await hook();}
    if(finalHook&&sql==='RESET ROLE'){const hook=finalHook;finalHook=null;await hook();}
    if(sql==='COMMIT'&&loseCommit){loseCommit=false;throw new Error('SYNTHETIC_COMMIT_UNKNOWN');}
    return result;
  }};}};
  const composition=createTaxonomyRuntimeComposition({sessionStore:central.store,sessionRegistry:central.registry,authorityCoordinator:central.coordinator,
    authorizationCatalogs:central.catalogs,assurancePolicyVersion:'c4g-assurance-v1',recentMfaRequirement:central.requirement,
    authorityLeaseMs:2000,
    telemetry:createTaxonomyTelemetry({metrics:{record(){}}})});
  async function bind(target,org,gen){
    const evidence=await preflightTenant(target,{tenantId:org,databaseGenerationId:gen},manifest,{timeoutMs:10000});
    const fixture=await runtimeFixture({pool:target,evidence,sessions:{memberships:new Map()}});fixtures.push(fixture);
    fixture.dependencies.membershipRepository=createMembershipRepository(central.pool,central.coordinator);
    return composition.bindTenant({pool:target,organizationId:org,tenantId:org,tenantCapabilityEvidence:evidence,
      tenantRuntimeDependencies:fixture.dependencies,authorizationAuditPort:{async accept(event){decisions.push(event);return'ACCEPTED';}}});
  }
  try{
    const fingerprint=schemaFingerprint(await centralSchemaSnapshot(central.pool));
    if(process.env.F13_CAPTURE_AUTHORITY_FINGERPRINT==='1')process.stdout.write(`authorityFingerprint=${fingerprint}\n`);
    else await preflightCentral(central.pool);
    await acl.checkPrivileges();
    const aclDriftCases=await acl.checkDrift();
    const warmSchemaDriftCases=await acl.checkWarmSchemaDrift();
    process.stdout.write(JSON.stringify({phase:'authority-acl',limitedSessionUser:true,driftCases:aclDriftCases})+'\n');
    const bound=await bind(preparedPool,organizationId,generationId),other=await bind(otherPool,otherOrganizationId,otherGenerationId);
    async function actor(org=organizationId,target=bound){const user=await central.user(org,randomUUID(),randomUUID());user.handle=await target.captureAuthenticatedRequest(user.request);return user;}
    async function change(kind,user){
      if(kind==='SESSION')return central.registry.revokeSession(user.sid);
      if(kind==='MEMBERSHIP')return createMembershipRepository(central.pool,central.coordinator).changeStatus({membershipId:user.membershipId,status:'SUSPENDED'});
      return central.data.change({organizationId,membershipId:user.membershipId,expectedVersion:1,
        grants:kind==='GRANTS'?[]:user.grants,newPolicyVersion:kind==='POLICY'?'changed-policy':'c4g-assurance-v1',
        assuranceRequirements:kind==='ASSURANCE'?{...central.requirement,maxAgeSeconds:30}:central.requirement});
    }
    // ACL drift while a real tenant transaction is protected must close new
    // admission, never let the general runtime resolve the guard, and retain
    // exclusion until authorized repair and physical commit reconciliation.
    {
      const user=await actor(),cmd=command(),gate=barrier();
      finalHook=()=>gate.pause();loseCommit=true;
      const operation=bound.service.createRelease(cmd,user.handle);operation.catch(()=>{});
      try{
        await Promise.race([gate.arrived,operation.then(()=>{throw new Error('ACTIVE_GUARD_BARRIER_NOT_REACHED');})]);
        const guard=(await central.pool.query("SELECT * FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='PREPARED'",[cmd.idempotencyKey])).rows[0];
        assert.ok(guard);await acl.attackActiveGuard(guard);
        assert.deepEqual(await counts(pool,cmd),{mutations:0,events:0,results:0});
        gate.release();await operation;
        assert.deepEqual(await counts(pool,cmd),{mutations:1,events:1,results:1});
        const reconciled=(await central.pool.query('SELECT state,reconciliation_result FROM public.authority_commit_guard WHERE guard_id=$1',[guard.guard_id])).rows[0];
        assert.deepEqual(reconciled,{state:'RECOVERED',reconciliation_result:'COMMITTED'});
      }catch(error){
        const failures=central.observations.filter(row=>row.errorCode).slice(-3).map(row=>({code:row.errorCode,sql:row.sql}));
        throw new Error(`ACTIVE_GUARD_${error.code||error.message}: ${JSON.stringify(failures)}`);
      }finally{gate.release();await Promise.allSettled([operation]);}
    }
    for(const kind of ['SESSION','MEMBERSHIP','GRANTS','VERSION','POLICY','ASSURANCE'])for(const winner of ['GUARD','AUTHORITY']){
      const user=await actor(),cmd=command(),gate=barrier();let writing,operation;
      try{
        if(winner==='GUARD'){
          finalHook=()=>gate.pause();operation=bound.service.createRelease(cmd,user.handle);await gate.arrived;
          const before=central.observations.filter(row=>row.sql.includes('SELECT guard_id,deadline')).length;
          let settled=false;writing=change(kind,user).then(value=>{settled=true;return value;});writing.catch(()=>{});
          await until(()=>central.observations.filter(row=>row.sql.includes('SELECT guard_id,deadline')).length>before);
          assert.equal(settled,false,'authority writer must wait for the durable guard');
          const deniedCommand=command();
          await assert.rejects(()=>bound.service.createRelease(deniedCommand,user.handle));
          await assert.rejects(()=>bound.captureAuthenticatedRequest(user.request));
          assert.deepEqual(await counts(pool,deniedCommand),{mutations:0,events:0,results:0});
          assert.deepEqual(await counts(otherPool,cmd),{mutations:0,events:0,results:0});
          gate.release();await operation;await writing;
          assert.deepEqual(await counts(pool,cmd),{mutations:1,events:1,results:1});
          await assert.rejects(()=>bound.service.createRelease(cmd,user.handle));
        }else{
          loadHook=()=>gate.pause();operation=bound.service.createRelease(cmd,user.handle);operation.catch(()=>{});await gate.arrived;
          await change(kind,user);gate.release();await assert.rejects(()=>operation);
          assert.deepEqual(await counts(pool,cmd),{mutations:0,events:0,results:0});
          assert.deepEqual(await counts(otherPool,cmd),{mutations:0,events:0,results:0});
        }
      }finally{gate.release();await Promise.allSettled([operation,writing].filter(Boolean));}
    }
    // Unit grants from the actual Central source: create never implies read,
    // and read never implies create, even for an ORG_ADMIN base role.
    for(const operationCode of ['F13_TAXONOMY_READ','F13_TAXONOMY_RELEASE_CREATE']){
      const user=await actor(),cmd=command();
      const permission=central.catalogs.operationCatalog.resolve(operationCode).permission;
      await central.data.change({organizationId,membershipId:user.membershipId,expectedVersion:1,
        grants:user.grants.filter(grant=>grant.permission===permission),assuranceRequirements:central.requirement});
      const handle=await bound.captureAuthenticatedRequest(user.request);
      if(operationCode==='F13_TAXONOMY_READ'){
        await assert.rejects(()=>bound.service.createRelease(cmd,handle));
        assert.deepEqual(await counts(pool,cmd),{mutations:0,events:0,results:0});
      }else{
        await bound.service.createRelease(cmd,handle);
        await assert.rejects(()=>bound.service.readRelease({releaseId:cmd.releaseId},handle));
        assert.deepEqual(await counts(pool,cmd),{mutations:1,events:1,results:1});
      }
    }
    const independent=await actor(),otherUser=await actor(otherOrganizationId,other),otherCommand=command();
    const b=barrier();finalHook=()=>b.pause();const paused=bound.service.createRelease(command(),independent.handle);await b.arrived;
    try{await other.service.createRelease(otherCommand,otherUser.handle);assert.deepEqual(await counts(otherPool,otherCommand),{mutations:1,events:1,results:1});}
    finally{b.release();await paused;}
    // Wrong organization and operation/tenant handle never reuse a stored result.
    await assert.rejects(()=>other.service.createRelease(otherCommand,independent.handle));
    await assert.rejects(()=>bound.service.createRelease(otherCommand,otherUser.handle));
    const uncertain=command();loseCommit=true;await bound.service.createRelease(uncertain,independent.handle);
    assert.deepEqual(await counts(pool,uncertain),{mutations:1,events:1,results:1});
    const recovered=(await central.pool.query("SELECT * FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='RECOVERED'",[uncertain.idempotencyKey])).rows[0];
    assert.equal(recovered.reconciliation_result,'COMMITTED');
    assert.equal((await central.coordinator.recover(recovered.guard_id)).reconciliation_result,'COMMITTED');
    const timed=command();finalHook=()=>new Promise(resolve=>setTimeout(resolve,2300));
    await assert.rejects(()=>bound.service.createRelease(timed,independent.handle));
    assert.deepEqual(await counts(pool,timed),{mutations:0,events:0,results:0});
    assert.equal((await central.pool.query('SELECT state FROM public.authority_commit_guard WHERE idempotency_key=$1',[timed.idempotencyKey])).rows[0].state,'ABORTED');
    // Storage protocol capability tests use actual PostgreSQL sessions. The
    // functional API never exposes these tokens or transaction clients.
    const raw=await pool.connect(),foreign=await otherPool.connect(),nonce=randomUUID(),probe=command();
    let token;const guardDeadline=Date.now()+1000;
    try{
      await raw.query('BEGIN');await raw.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43001305))',[nonce]);
      const backend=(await raw.query('SELECT pid,backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()')).rows[0];
      const authority=require('../../../backend/src/security/authenticatedAuthority').createTaxonomySessionAuthority({sessionStore:central.store,
        sessionRegistry:central.registry,...central.data,policyVersion:'c4g-assurance-v1'});
      const handle=await authority.captureAuthenticatedRequest(independent.request);
      const evaluator=require('../../../backend/src/authorization/resourceAuthorization').createTaxonomyAuthorization({catalogs:central.catalogs,...central.data,
        authorizationAuditPort:{async accept(){return'ACCEPTED';}},assurancePolicyVersion:'c4g-assurance-v1',recentMfaRequirement:central.requirement,clock:{now:()=>new Date()}});
      token=await central.coordinator.prepare({tenantId:organizationId,organizationId,subjectId:independent.id,membershipId:independent.membershipId,
        sessionDigest:require('../../../backend/src/security/authorityCoordinator').hash(independent.sid),transactionId:nonce,correlationId:randomUUID(),
        deadline:guardDeadline,idempotencyKey:probe.idempotencyKey,intentionDigest:'f'.repeat(64),
        sourceBinding:{snapshotDigest:require('../../../backend/src/security/tenantAuthorityRecovery').snapshotDigest(fixtures[0].snapshot),
          backendPid:backend.pid,backendStart:backend.backend_start,sourceOperation:'RELEASE_CREATE'}},async()=>{
        const trusted=await authority.resolve(handle),decision=await evaluator.authorize('F13_TAXONOMY_RELEASE_CREATE',trusted,
          {id:probe.releaseId,organizationId,resourceType:'TAXONOMY_RELEASE_DRAFT',scopeType:'ORGANIZATION',status:'ACTIVE',distinctFromActorIds:[]});
        assert.equal(decision.allowed,true);
        return{versions:{...decision.evaluation,sessionRevocationVersion:1},assurance:{level:'SESSION',policyVersion:'c4g-assurance-v1'},
          operations:[{operation:'F13_TAXONOMY_RELEASE_CREATE',permission:'profile_taxonomy.release.create',resourceType:'TAXONOMY_RELEASE_DRAFT',resourceId:probe.releaseId}]};
      },raw);
      central.coordinator.assert(token,raw,nonce);
      for(const [candidate,client,transaction] of [[{},raw,nonce],[{...token},raw,nonce],[token,foreign,nonce],[token,raw,randomUUID()]])
        assert.throws(()=>central.coordinator.assert(candidate,client,transaction),/AUTHORITY_GUARD_STALE/);
      await until(()=>Date.now()>guardDeadline);
      assert.throws(()=>central.coordinator.assert(token,raw,nonce),/AUTHORITY_GUARD_STALE/);
      await raw.query('ROLLBACK');await central.coordinator.complete(token,'ROLLED_BACK');
      assert.throws(()=>central.coordinator.assert(token,raw,nonce),/AUTHORITY_GUARD_STALE/);
      assert.deepEqual(await counts(pool,probe),{mutations:0,events:0,results:0});
      assert.deepEqual(await counts(otherPool,probe),{mutations:0,events:0,results:0});
    }finally{await raw.query('ROLLBACK').catch(()=>{});raw.release();foreign.release();}
    await assert.rejects(()=>central.pool.query('UPDATE public.authority_f5_state SET authorization_version=authorization_version+1 WHERE membership_id=$1',[independent.membershipId]),/AUTHORITY_COORDINATOR_REQUIRED/);
    await assert.rejects(()=>central.pool.query("UPDATE public.application_session SET status='REVOKED',revoked_at=clock_timestamp() WHERE sid=$1",[independent.sid]),/AUTHORITY_COORDINATOR_REQUIRED/);
    await assert.rejects(()=>central.pool.query("UPDATE public.organization_membership SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE id=$1",[independent.membershipId]),/AUTHORITY_COORDINATOR_REQUIRED/);
    await assert.rejects(()=>central.coordinator.pool.query('INSERT INTO public.authority_write_permit VALUES(txid_current(),pg_backend_pid(),$1,1)',[['POLICY']]),/AUTHORITY_COORDINATOR_REQUIRED/);
    const role=(await central.authorityPool.query('SELECT session_user,current_user,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(role,{session_user:'c4g_authority_runtime',current_user:'c4g_authority_runtime',rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false});
    await central.coordinator.write(['POLICY'],async prepared=>{
      await prepared.query('SAVEPOINT authority_abcdef');
      await assert.rejects(()=>prepared.query('ALTER TABLE public.authority_commit_guard DISABLE TRIGGER ALL'),error=>error.code==='42501');
      await prepared.query('ROLLBACK TO SAVEPOINT authority_abcdef');
    });
    const untrusted=await central.pool.connect();
    try{await untrusted.query('SET ROLE c4g_central_runtime');
      await assert.rejects(()=>untrusted.query("INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) VALUES(txid_current(),pg_backend_pid(),$1,1,$2,'APPLY')",[['POLICY'],randomUUID()]),error=>error.code==='42501');
      await assert.rejects(()=>untrusted.query('UPDATE public.authority_f5_state SET authorization_version=authorization_version+1'),error=>error.code==='42501');
    }finally{await untrusted.query('RESET ROLE');untrusted.release();}
    // Actual child processes, terminated with guards durably PREPARED.
    for(const phase of ['BEFORE_COMMIT','AFTER_COMMIT','WRITER_BEFORE_APPLY']){
      const user=await actor(),cmd=command();
      const child=fork(path.join(__dirname,'authority-process.js'),[],{silent:true,env:{...process.env,
        F13_AUTHORITY_CHILD:JSON.stringify({central:central.connectionString,authority:central.authorityConnectionString,permitSecret:central.permitSecret,tenant:process.env.F13_S2_GATE_URL,organizationId,generationId,phase,user:{id:user.id,membershipId:user.membershipId,sid:user.sid,request:user.request},command:cmd})}});
      let errors='';child.stderr.on('data',chunk=>{errors+=chunk;});
      try{
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`AUTHORITY_CHILD_TIMEOUT ${errors}`)),10000);
          child.once('message',message=>{clearTimeout(timer);message==='PREPARED'?resolve():reject(new Error('AUTHORITY_CHILD_MESSAGE'));});
          child.once('exit',code=>{clearTimeout(timer);reject(new Error(`AUTHORITY_CHILD_EXIT ${code} ${errors}`));});});
        const writer=phase==='WRITER_BEFORE_APPLY';
        const row=writer?(await central.pool.query("SELECT * FROM public.authority_write_request WHERE state='WAITING' AND scope_keys @> $1::text[]",[[central.coordinator.sessionKey(user.sid)]])).rows[0]
          :(await central.pool.query("SELECT * FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='PREPARED'",[cmd.idempotencyKey])).rows[0];assert.ok(row);
        const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
        await until(()=>Date.now()>new Date(row.deadline).getTime());
        if(writer){
          await assert.rejects(()=>bound.captureAuthenticatedRequest(user.request));
          await central.coordinator.recoverExpired();await central.coordinator.recoverExpired();
          assert.equal((await central.pool.query('SELECT state FROM public.authority_write_request WHERE request_id=$1',[row.request_id])).rows[0].state,'CANCELLED');
          await assert.rejects(()=>bound.service.createRelease(cmd,user.handle));
          assert.deepEqual(await counts(pool,cmd),{mutations:0,events:0,results:0});
          const fresh=await bound.captureAuthenticatedRequest(user.request);
          await bound.service.createRelease(cmd,fresh);await central.registry.revokeSession(user.sid);
          continue;
        }
        const result=await central.coordinator.recover(row.guard_id);assert.equal(result.state,'RECOVERED');
        assert.equal(result.reconciliation_result,phase==='AFTER_COMMIT'?'COMMITTED':'ROLLED_BACK');
        assert.deepEqual(await counts(pool,cmd),phase==='AFTER_COMMIT'?{mutations:1,events:1,results:1}:{mutations:0,events:0,results:0});
        assert.equal((await central.coordinator.recover(row.guard_id)).reconciliation_result,result.reconciliation_result);
        await central.registry.revokeSession(user.sid);
      }finally{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');}
    }
    assert.equal((await central.pool.query("SELECT count(*)::int n FROM public.authority_commit_guard WHERE state IN('PREPARED','TENANT_COMMIT_UNKNOWN')")).rows[0].n,0);
    // Persisted evidence matches the exact positive F5 decision, not caller data.
    const rows=(await central.pool.query('SELECT protected_operations,authority_versions,normalized_assurance FROM public.authority_commit_guard WHERE organization_id=$1',[organizationId])).rows;
    for(const row of rows){assert.equal(row.authority_versions.policyVersion,'c4g-assurance-v1');assert.equal(row.normalized_assurance.level,'SESSION');assert.equal(row.protected_operations[0].operation,'F13_TAXONOMY_RELEASE_CREATE');}
    const guards=(await central.pool.query("SELECT * FROM public.authority_commit_guard WHERE organization_id=$1 AND state IN('TENANT_COMMITTED','RECOVERED')",[organizationId])).rows;
    let audited=0;
    for(const guard of guards){const event=(await pool.query("SELECT event_data FROM audit.event WHERE event_data->>'correlationId'=$1",[guard.correlation_id])).rows[0]?.event_data;
      if(!event)continue;
      audited++;assert.equal(event.actor.id,guard.subject_id);assert.equal(event.actor.membershipId,guard.membership_id);
      assert.equal(event.operationCode,guard.protected_operations[0].operation);assert.equal(event.resource.id,guard.protected_operations[0].resourceId);
      for(const key of ['membershipVersion','authorizationVersion','policyVersion','permissionCatalogVersion','operationCatalogVersion'])
        assert.equal(event.payload[key],guard.authority_versions[key]);assert.equal(event.payload.assuranceLevel,guard.normalized_assurance.level);
    }assert.ok(audited>=9);
    await require('../../../backend/scripts/runCentralMigrations').rollbackCentralMigration(central.pool,'010');
    const protectedFingerprint=schemaFingerprint(await centralSchemaSnapshot(central.pool));
    await assert.rejects(()=>require('../../../backend/scripts/runCentralMigrations').rollbackCentralMigration(central.pool,'009'),/AUTHORITY_DOWN_HAS_DATA/);
    assert.equal(schemaFingerprint(await centralSchemaSnapshot(central.pool)),protectedFingerprint);
    assert.equal((await preflightCentral(central.pool)).currentVersion,'009_authority_commit_guard');
    await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrations(central.pool);
    assert.equal((await preflightCentral(central.pool)).currentVersion,'010_editorial_intention_lookup');
    return{realCentralF3F5Guard:true,sixAuthorityRacesBothOrders:true,crashBeforeAndAfterCommitRecovered:true,unknownCommitDurablyReconciled:true,
      repeatedRecoveryIdempotent:true,centralUnitGrantsAsymmetric:true,abandonedWriterRecovered:true,pendingWriterFencesNewGuards:true,directAuthorityWritesDenied:true,twoTenantAuthorityIsolation:true,expiredGuardRollsBack:true,
      guardForgeryAndReuseDenied:true,guardMatchesPersistedF7:true,nonPrivilegedCentralCoordinator:true,
      canonicalCentral009DownUpAndLedgerRollback:true,centralAuthorityFingerprint:fingerprint,
      dedicatedSessionUser:true,exactAclDriftCases:aclDriftCases,warmSchemaDriftCases,activeGuardAclDriftReconciled:true,directFinalizationPermitForgeryDenied:true,centralDownProtectedDataDenied:true};
  }finally{await acl.close();for(const fixture of fixtures)await fixture.manager.closeAll();await central.close();}
}
module.exports={verifyAuthorityCommitProtocol};
