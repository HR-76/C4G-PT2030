'use strict';
const { admitControlledTarget } = require('./controlledTarget');
const { loadStoredCatalog } = require('./storedEvidence');
const { publishStoredCatalog } = require('./isolatedStoredPublisher');
const { createPgPolicyStore } = require('./pgPolicyStore');
const { createAdminOnlyRehearsalControl } = require('./adminOnlyRehearsalControl');
const { createIsolatedDurableReaderProvider } = require('./isolatedDurableProvider');

// Native startup integration. No migrations, credential provisioning or source clients.
// The short exposure lease is unchanged; startup explicitly admits a new window.
async function prepareControlledStartup({ centralPool, target, settings, Pool, express, policyVersion, evidenceDirectory, sink, validationOnly = false }) {
  if(settings?.version!==1 || settings.mode!=='controlled' || settings.firstAccess!=='organization-administrator'
    || !/^[a-f0-9]{64}$/.test(settings.signingKey) || !/^[a-f0-9]{64}$/.test(settings.operatorPassword)) throw Error('CATALOG_STARTUP_CONFIGURATION_INVALID');
  const admission=await admitControlledTarget({pool:centralPool,target,expected:settings.target,organizationId:settings.organizationId,userId:settings.userId,validationOnly});
  const corpus=loadStoredCatalog(evidenceDirectory);
  const publication=await publishStoredCatalog({pool:centralPool,target,controlledAdmission:admission,corpus,asOf:settings.publishedAsOf});
  const pools=[];let control,runtime,closed=false;
  try {
    const operatorLogin=validationOnly ? settings.operatorLogin || 'gcni_catalog_operator' : 'gcni_catalog_operator';
    for(const [user,password] of [['gcni_catalog_policy',settings.credentials.policy],[operatorLogin,settings.operatorPassword]]) {
      const pool=new Pool({...target,user,password,max:2,connectionTimeoutMillis:3000,query_timeout:5000});pool.on('error',()=>{});pools.push(pool);
    }
    const reader=createPgPolicyStore({controlledAdmission:admission,pool:pools[0],login:'gcni_catalog_policy'});
    const writer=createPgPolicyStore({controlledAdmission:admission,pool:pools[1],login:operatorLogin,writable:true});
    control=createAdminOnlyRehearsalControl({controlledAdmission:admission,organizationId:settings.organizationId,userId:settings.userId,store:{durable:true,read:reader.read,compareAndSet:writer.compareAndSet},sink});
    const create=createIsolatedDurableReaderProvider({controlledAdmission:admission,target,credentials:settings.credentials,Pool,express,key:Buffer.from(settings.signingKey,'hex'),policyVersion,control});
    runtime=create();await runtime.ready();
    const before=await control.operator.status();
    // A withdrawn generation is never automatically reinstated by restarting.
    const persisted=await reader.read();if(persisted.blockedGenerations.includes(publication.generationId))throw Error('CATALOG_STARTUP_GENERATION_WITHDRAWN');
    await control.operator.enable({expectedRevision:before.revision,leaseMs:300000});
    let claimed=false;
    async function close(){if(closed)return;closed=true;try{const p=await control.operator.status();await control.operator.disable({expectedRevision:p.revision});}finally{await runtime.close();await Promise.all(pools.map(p=>p.end()));}}
    return Object.freeze({admission,publication,expiresAt:(await control.operator.status()).expiresAt,
      createRuntime(){if(claimed||closed)throw Error('CATALOG_STARTUP_ALREADY_CLAIMED');claimed=true;return runtime;},close});
  } catch(error) {
    if(control)try{const p=await control.operator.status();await control.operator.disable({expectedRevision:p.revision});}catch{}
    await runtime?.close();await Promise.allSettled(pools.map(p=>p.end()));throw error;
  }
}
module.exports={prepareControlledStartup};
