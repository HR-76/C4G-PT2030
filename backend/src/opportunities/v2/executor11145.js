'use strict';
// Explicit bounded composition. Importing it neither opens a pool nor collects.
function createExecutor11145({pool,policyVersion,recentMfaRequirement,fetchImpl=globalThis.fetch}={}){
 const options={pool,policyVersion,recentMfaRequirement};
 const collector=require('./collector11145').createEu11145Collector({...options,fetchImpl});
 const activation=require('./activationComposition').createOpportunityActivationV2(options);
 return Object.freeze({collect:collector.collect,prepare:activation.prepare11145,accept:activation.accept11145});
}
module.exports={createExecutor11145};
