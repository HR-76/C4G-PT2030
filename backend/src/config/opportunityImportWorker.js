'use strict';

const {createOpportunityImportWorkerRuntime}=require('./opportunityImportWorkerFactory');

async function loadOpportunityImportWorkerRuntime({env=process.env,telemetry=null}={}){
  return createOpportunityImportWorkerRuntime({env,telemetry});
}

module.exports={loadOpportunityImportWorkerRuntime};
