'use strict';
const http = require('node:http');
const {createResourceDrain,trackPool,watchServer,trackExpress,deadline}=require('./resourceDrain');
const {createResourceOwner}=require('./resourceOwner');

function duration(env,name,fallback){const value=env[name]===undefined?fallback:Number(env[name]);if(!Number.isSafeInteger(value)||value<1||value>300000)throw new TypeError(`${name} must be an integer between 1 and 300000.`);return value;}

async function start({production=null,dependencies=null,env=process.env,host=undefined,installSignals=true,
  telemetry=null,dependencyLoader=null,composer=null}={}) {
  const graceMs=duration(env,'API_SHUTDOWN_GRACE_MS',10000),settleMs=duration(env,'API_SHUTDOWN_SETTLE_MS',10000);
  const owner=createResourceOwner(),ownedPools=[];
  let server,drain,stopping,telemetryOwned=false,draining=false,lifecycleStarted=false;
  const record=event=>production?.logger.info('c4g.api.lifecycle',{component:'server',operation:'api.shutdown',outcome:'observed',phase:event.phase,elapsedMs:event.elapsedMs});
  const signals=['SIGTERM','SIGINT'];
  async function stopLifecycle(){if(lifecycleStarted){const result=await production.observability.lifecycle.stop();if(result?.errorCode)throw new Error('API_OBSERVABILITY_SHUTDOWN_FAILED');}}
  const onSignal=()=>{stop().catch(()=>{process.stderr.write('C4G_API_SHUTDOWN_FAILED\n');process.exitCode=1;});};
  function stop(){return stopping ||= (async()=>{
    draining=true;
    for(const signal of signals)process.removeListener(signal,onSignal);
    try {
      if(drain)await drain();
      else {
        const failures=[];
        if(lifecycleStarted)try{await deadline(stopLifecycle,settleMs,'LIFECYCLE_STOP_TIMEOUT');}catch(error){failures.push(error);}
        if(production)try{await deadline(()=>production.closeOpportunityRuntime(),settleMs,'RUNTIME_CLOSE_TIMEOUT');}catch(error){failures.push(error);}
        try{await deadline(()=>owner.close(),settleMs,'STARTUP_CLEANUP_TIMEOUT');}catch(error){failures.push(error);}
        if(failures.length)throw new AggregateError(failures,'STARTUP_CLEANUP_FAILED');
      }
      return Object.freeze({status:'CLOSED'});
    } finally {
      // Telemetry never owns application pools and can be closed even on drain failure.
      if(telemetryOwned)await deadline(()=>telemetry.shutdown(),settleMs,'TELEMETRY_SHUTDOWN_TIMEOUT');
    }
  })();}
  try {
    if(!telemetry){telemetry=require('./observability/bootstrap').bootstrapTelemetry({service:'c4g-api',env});telemetryOwned=true;}
    if(!production){
      if((env.AUTH_MODE||'oidc')!=='oidc')throw new Error('C4G_API_OIDC_REQUIRED');
      const composition=require('./productionComposition');
      const loader=dependencyLoader||composition.loadProductionDependencies;
      if(!dependencies){dependencies=loader({ownResource:owner.own});for(const pool of [...new Set([dependencies.centralPool,dependencies.authorityPool].filter(Boolean))]){trackPool(pool);ownedPools.push(pool);}}
      production=(composer||composition.createProductionComposition)({dependencies,env});
    }
    await production.assertDatabaseReadiness();
    production.observability.lifecycle.start();lifecycleStarted=true;
    const work=trackExpress(production.app);
    server=http.createServer((req,res)=>{
      if(draining){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end('{"error":{"code":"SERVICE_UNAVAILABLE"}}');return;}
      production.app(req,res);
    });
    const watched=watchServer(server);
    drain=createResourceDrain({servers:[watched],pools:ownedPools,closePools:false,work:[work],graceMs,settleMs,record,
      stopProducers:async()=>{},
      stopWorkers:async()=>{},
      closeConsumers:async()=>{await stopLifecycle();await production.closeOpportunityRuntime();}});
    const drainConsumers=drain;
    drain=async()=>{await drainConsumers();await deadline(()=>owner.close(),settleMs,'RESOURCE_CLOSE_TIMEOUT');};
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(production.port,host,()=>{server.removeListener('error',reject);resolve();});});
    production.logger.info('c4g.api.started',{component:'server',operation:'api.start',outcome:'success'});
    production.logFrontendUrlHealth();
    if(installSignals)for(const signal of signals)process.once(signal,onSignal);
    return Object.freeze({production,server,shutdown:stop});
  } catch(error){
    try {await stop();}catch(cleanupError){throw new AggregateError([error,cleanupError],'API_START_AND_CLEANUP_FAILED');}
    throw error;
  }
}

if(require.main===module){
  try{require('./config/loadEnvironment').loadEnvironment({env:process.env,backendRoot:require('node:path').resolve(__dirname,'..')});}
  catch{process.stderr.write('C4G_API_CONFIG_INVALID\n');process.exitCode=1;}
  if(!process.exitCode)start().catch(()=>{process.stderr.write('C4G_API_START_FAILED\n');process.exitCode=1;});
}
module.exports={start};
