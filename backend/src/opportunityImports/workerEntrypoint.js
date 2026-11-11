'use strict';

const {createOpportunityImportProductionComposition}=require('./productionComposition');
const {createOpportunityImportWorkerContextPort}=require('./authorityPorts');
const {createOpportunityImportWorkerRuntime}=require('./workerRuntime');

function createOpportunityImportWorkerEntrypoint({membershipPort,authorizationDataPort,tenantDirectory,
  transactionPortFactory,authorizationPortFactory,documentPortFactory,opportunityPortFactory,
  queue,inbox,transactionResolver,relay,clock,id,telemetry,errorObserver,continuous=true,pollIntervalMs,batchSize}){
 const workerContextPort=createOpportunityImportWorkerContextPort({membershipPort,authorizationDataPort});
 const composition=createOpportunityImportProductionComposition({
  requestContextPort:{async resolve(){throw new Error('API_CONTEXT_NOT_AVAILABLE_IN_WORKER');}},workerContextPort,tenantDirectory,
  transactionPortFactory,authorizationPortFactory,documentPortFactory,opportunityPortFactory,clock,id,telemetry
 });
 return createOpportunityImportWorkerRuntime({composition,queue,inbox,transactionResolver,relay,continuous,
  ...(pollIntervalMs===undefined?{}:{pollIntervalMs}),...(batchSize===undefined?{}:{batchSize}),telemetry,errorObserver});
}

module.exports={createOpportunityImportWorkerEntrypoint};
