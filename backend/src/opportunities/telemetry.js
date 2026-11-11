'use strict';
const OPERATIONS=new Set(['opportunity.create','opportunity.update','opportunity.archive','opportunity.restore','opportunity.read','opportunity.duplicate.scan','opportunity.reconcile']);
const RESULTS=new Set(['success','denied','invalid','conflict','unavailable']);
function createOpportunityTelemetry({metrics,logger=null,tracer=null,clock=()=>Date.now()}={}){
 if(!metrics||typeof metrics.record!=='function')throw new TypeError('F12 metrics port is required.');
 async function observe(operation,work){
  if(!OPERATIONS.has(operation))throw new TypeError('Opportunity operation is not allowlisted.');const started=clock();
  const run=async()=>{try{const value=await work();try{metrics.record('c4g.opportunity.operation',1,{operation,resultClass:'success'});if(operation==='opportunity.read')metrics.record('c4g.opportunity.query.duration',Math.max(0,clock()-started)/1000,{operation,resultClass:'success'});}catch{}return value;}catch(error){const result=error&&error.code==='OPPORTUNITY_NOT_AVAILABLE'?'denied':error&&/STALE|CONFLICT|DIGEST/.test(error.code||'')?'conflict':'invalid';try{metrics.record('c4g.opportunity.operation',1,{operation,resultClass:RESULTS.has(result)?result:'invalid'});logger?.error('c4g.opportunity.operation.failed',{operation,errorCode:error&&error.code||'OPPORTUNITY_OPERATION_FAILED'});}catch{}throw error;}};
  if(tracer&&typeof tracer.startActiveSpan==='function')return tracer.startActiveSpan(operation,span=>Promise.resolve(run()).finally(()=>span.end()));return run();
 }
 return Object.freeze({observe});
}
module.exports={OPERATIONS,RESULTS,createOpportunityTelemetry};
