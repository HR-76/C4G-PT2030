let cliTelemetry=null;
if(require.main===module)cliTelemetry=require('./workerBootstrap');
const {productionRegistry}=require('./async/productionRegistry');
const {createObservability}=require('./observability');
const {createRuntimeLifecycle}=require('./observability/runtimeLifecycle');
const {createMessagingTelemetry}=require('./observability/messaging');
const {createFeatureMetricAdapter}=require('./observability/featureAdapters');
const {installProcessHandlers}=require('./observability/workerProcessLifecycle');
const {loadOpportunityImportWorkerRuntime}=require('./config/opportunityImportWorker');

async function main({runtime=null,runtimeLoader=loadOpportunityImportWorkerRuntime,registry=productionRegistry,run=null,queue=null,env=process.env,telemetryRuntime=null}={}){
  const telemetry=telemetryRuntime||cliTelemetry||require('./workerBootstrap');
  if(!telemetry||typeof telemetry.forceFlush!=='function'||typeof telemetry.shutdown!=='function'||!telemetry.tracer)throw new TypeError('Worker telemetry runtime is invalid.');
  if (!runtime && (env.F12_OPPORTUNITY_WORKER_PROVIDER || env.F12_OPPORTUNITY_WORKER_ORGANIZATION_ID)) {
    if (env.FUNDING_TENDERS_RUNTIME === 'central' || env.OPPORTUNITY_IMPORTS_RUNTIME === 'f12-xlsx') {
      throw new Error('The F12 opportunity worker requires a separate worker process.');
    }
    runtime = await require('./config/opportunityReceiptWorker').loadOpportunityReceiptWorker({
      env, telemetry: createMessagingTelemetry({ tracer: telemetry.tracer })
    });
  }
  if(!runtime&&env.FUNDING_TENDERS_RUNTIME==='central')runtime=await require('./config/fundingTendersWorker').loadFundingTendersWorker({env});
  if(!runtime&&env.OPPORTUNITY_IMPORTS_RUNTIME==='f12-xlsx')runtime=await runtimeLoader({env,telemetry:createMessagingTelemetry({tracer:telemetry.tracer})});
  if(runtime){
    if(!runtime.registry||typeof runtime.start!=='function'||typeof runtime.shutdown!=='function')throw new TypeError('Worker runtime is invalid.');
    registry=runtime.registry;queue=runtime.queue;run=()=>runtime.start();
  }
  const observability=createObservability({service:'c4g-worker'});
  if(!registry||!Array.isArray(registry.types))throw new TypeError('F9 productive registry is invalid.');
  if(registry.types.length>0&&typeof run!=='function')throw new TypeError('F9 productive jobs require an explicit worker runner.');
  observability.lifecycle.start();
  const lifecycle=createRuntimeLifecycle({flush:telemetry.forceFlush,providerShutdown:telemetry.shutdown});
  if(runtime)lifecycle.register(()=>runtime.shutdown());
  else if(queue&&typeof queue.shutdown==='function')lifecycle.register(()=>queue.shutdown());
  lifecycle.register(()=>observability.lifecycle.stop());
  lifecycle.ready();
  let startResult=null;
  try { if(run)startResult=await run({registry,observability}); }
  catch(error) { await lifecycle.shutdown().catch(()=>{}); throw error; }
  observability.logger.info('c4g.api.started',{component:'worker',operation:'api.start',outcome:'success'});
  return Object.freeze({observability,lifecycle,startResult,featureTelemetry:createFeatureMetricAdapter({registry:observability.metrics}),messagingTelemetry:createMessagingTelemetry({tracer:telemetry.tracer}),shutdown:()=>lifecycle.shutdown()});
}

if(require.main===module){main({env:process.env}).then(runtime=>installProcessHandlers(runtime)).catch(()=>{process.exitCode=1;});}
module.exports={installProcessHandlers,main};
