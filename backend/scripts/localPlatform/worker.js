'use strict';
const fs=require('node:fs'),path=require('node:path');
const {folder,readConfig,saveState}=require('./config');
async function main(){
 if(process.argv.slice(2).some(arg=>arg!=='--standby'))throw Error('LOCAL_WORKER_ARGUMENT_INVALID');
 const standby=process.argv.includes('--standby');
 const state=JSON.parse(fs.readFileSync(path.join(folder,'runtime.json')));
 if(!state.funding)throw Error('LOCAL_FUNDING_SETUP_REQUIRED');
 const env=require('./runtime').runtimeEnvironment(readConfig(),state);
 const worker=await require('../../src/config/fundingTendersWorker').loadFundingTendersWorker({env});
 try { await beginProcessing(worker,{standby}); } catch(error) { await worker.shutdown(); throw error; }
 const file=path.join(folder,'funding-worker-heartbeat.json');
 const heartbeat=()=>saveState({pid:process.pid,at:Date.now(),installationId:state.installationId,mode:standby?'STANDBY':'PROCESSING',...worker.health()},file);
 heartbeat();const timer=setInterval(heartbeat,2000);
 const stop=async()=>{clearInterval(timer);saveState({pid:process.pid,at:0,installationId:state.installationId},file);await worker.shutdown();process.exitCode=0;};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 console.log(standby?'C4G_LOCAL_FUNDING_WORKER_STANDBY':'C4G_LOCAL_FUNDING_WORKER_READY');
}
async function beginProcessing(worker,{standby=false}={}) { if(standby)return;await worker.runOnce();await worker.start(); }
if(require.main===module)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:e.code||'LOCAL_FUNDING_WORKER_FAILED');process.exitCode=1});
module.exports={beginProcessing};
