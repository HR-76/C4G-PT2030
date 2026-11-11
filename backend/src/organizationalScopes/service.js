'use strict';
const contracts = require('./contracts');
const {
  OrganizationalScopeError, aggregateOrganizationalScopeFailures, mapDatabaseError
} = require('./errors');

const MAX_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);
const retryableTransactionFailures = new WeakSet();
const ORGANIZATION_TARGET = Object.freeze({ resourceType: 'ORGANIZATION', decisionKey: 'ORGANIZATION' });
const SOURCE_TARGET = Object.freeze({ resourceType: 'ORGANIZATIONAL_SCOPE', decisionKey: 'SOURCE' });
const PARENT_TARGET = Object.freeze({ resourceType: 'ORGANIZATIONAL_SCOPE', decisionKey: 'PARENT' });
const DESTINATION_TARGET = Object.freeze({ resourceType: 'ORGANIZATIONAL_SCOPE', decisionKey: 'DESTINATION' });

function createPreparedOrganizationalScopeService({ organizationId, repository, authorization, telemetry = null }) {
  if (typeof organizationId !== 'string' || !repository || !authorization || typeof authorization.authorize !== 'function'
      || (telemetry !== null && typeof telemetry.observe !== 'function')) {
    throw new TypeError('Prepared organizational scope service configuration is invalid.');
  }
  async function authorize(client, operationCode, input, resourceId, target) {
    const actor = Object.freeze({ ...input.actor, organizationId });
    const decision = await authorization.authorize(Object.freeze({ operationCode, actor, resourceId,
      assuranceEvidence: input.assuranceEvidence, correlationId: input.correlationId }), client, target);
    if (!decision || decision.allowed !== true) throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_NOT_AVAILABLE');
  }
  async function execute(client, operationCode, command, validator, target, effect) {
    if (!client || typeof client.query !== 'function') throw new TypeError('Prepared tenant client is required.');
    const input = validator(command);
    const resourceId = input.scopeId || organizationId;
    await authorize(client, operationCode, input, resourceId, target);
    return effect(client, input);
  }
  function observed(name, work) { return telemetry ? telemetry.observe(name, work) : work(); }
  return Object.freeze({
    create:(client,command)=>observed('scope.create',async()=>{
      if (!client || typeof client.query !== 'function') throw new TypeError('Prepared tenant client is required.');
      const input=contracts.create(command),child=input.parentScopeId!==null;
      await authorize(client,'ORGANIZATIONAL_SCOPE_CREATE',input,child?input.parentScopeId:organizationId,child?PARENT_TARGET:ORGANIZATION_TARGET);
      return repository.createScope(client,input);
    }),
    read:(client,command)=>observed('scope.read',()=>execute(client,'ORGANIZATIONAL_SCOPE_READ',command,contracts.read,SOURCE_TARGET,(prepared,input)=>repository.getOperational(prepared,input.scopeId))),
    renameLabel:(client,command)=>observed('scope.rename',()=>execute(client,'ORGANIZATIONAL_SCOPE_RENAME',command,contracts.rename,SOURCE_TARGET,(prepared,input)=>repository.renameLabel(prepared,input))),
    reparent:(client,command)=>observed('scope.reparent',async()=>{
      if (!client || typeof client.query !== 'function') throw new TypeError('Prepared tenant client is required.');
      const input=contracts.reparent(command);
      await authorize(client,'ORGANIZATIONAL_SCOPE_REPARENT',input,input.scopeId,SOURCE_TARGET);
      await authorize(client,'ORGANIZATIONAL_SCOPE_REPARENT',input,input.parentScopeId===null?organizationId:input.parentScopeId,
        input.parentScopeId===null?ORGANIZATION_TARGET:DESTINATION_TARGET);
      return repository.reparentScope(client,input);
    }),
    archive:(client,command)=>observed('scope.archive',()=>execute(client,'ORGANIZATIONAL_SCOPE_ARCHIVE',command,contracts.archive,SOURCE_TARGET,(prepared,input)=>repository.archiveScope(prepared,input)))
  });
}

function createOrganizationalScopeService({ pool, organizationId, runtimeRole = 'c4g_organizational_scope_runtime', repository, authorization, telemetry = null }) {
  if (!pool || typeof pool.connect !== 'function' || typeof organizationId !== 'string' || !repository
      || !authorization || typeof authorization.authorize !== 'function'
      || (telemetry !== null && typeof telemetry.observe !== 'function')
      || !/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole)) throw new TypeError('Organizational scope service configuration is invalid.');
  const prepared=createPreparedOrganizationalScopeService({organizationId,repository,authorization,telemetry});
  async function transactionAttempt(method, command) {
    let client=null;let transactionStarted=false;let transactionOpen=false;let commitAttempted=false;
    let commitConfirmed=false;let rollbackConfirmed=false;let releaseAttempted=false;let released=false;
    try{client=await pool.connect();await client.query('BEGIN');transactionStarted=true;transactionOpen=true;await client.query(`SET LOCAL ROLE ${runtimeRole}`);await client.query("SELECT set_config('app.organization_id',$1,true)",[organizationId]);
      const result=await method(client,command);commitAttempted=true;await client.query('COMMIT');commitConfirmed=true;transactionOpen=false;
      try{releaseAttempted=true;client.release();released=true;}catch{throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_PERSISTENCE_UNAVAILABLE');}
      return result;
    }catch(error){
      const commitOutcomeUncertain=commitAttempted&&!commitConfirmed;
      const primary=commitOutcomeUncertain
        ? new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_PERSISTENCE_UNAVAILABLE')
        : mapDatabaseError(error);
      const cleanupFailures=[];let discardReason=null;
      if(client&&transactionOpen&&!commitAttempted){
        try{await client.query('ROLLBACK');rollbackConfirmed=true;transactionOpen=false;}
        catch{discardReason=new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_PERSISTENCE_UNAVAILABLE');cleanupFailures.push(discardReason);}
      }else if(client&&!releaseAttempted){discardReason=primary;}
      if(client&&!releaseAttempted){
        try{releaseAttempted=true;client.release(discardReason||undefined);released=true;}
        catch{cleanupFailures.push(new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_PERSISTENCE_UNAVAILABLE'));}
      }
      if(cleanupFailures.length>0)throw aggregateOrganizationalScopeFailures(primary,cleanupFailures);
      const safeToRetry=!commitAttempted&&transactionStarted&&rollbackConfirmed&&released
        && error&&RETRYABLE_SQLSTATES.has(error.code);
      if(safeToRetry)retryableTransactionFailures.add(primary);
      throw primary;
    }
  }
  async function transaction(method, command) {
    for(let attempt=1;attempt<=MAX_TRANSACTION_ATTEMPTS;attempt+=1){
      try{return await transactionAttempt(method,command);}
      catch(error){if(!retryableTransactionFailures.has(error)||attempt===MAX_TRANSACTION_ATTEMPTS)throw error;}
    }
    throw new OrganizationalScopeError('ORGANIZATIONAL_SCOPE_PERSISTENCE_UNAVAILABLE');
  }
  return Object.freeze({
    create:command=>transaction(prepared.create,command),
    read:command=>transaction(prepared.read,command),
    renameLabel:command=>transaction(prepared.renameLabel,command),
    reparent:command=>transaction(prepared.reparent,command),
    archive:command=>transaction(prepared.archive,command)
  });
}
module.exports={createOrganizationalScopeService,createPreparedOrganizationalScopeService};
