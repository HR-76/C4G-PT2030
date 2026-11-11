'use strict';
// Lifecycle proof only: HTTP is real; business composition/pool are explicit doubles.
const express=require('express');
const {start}=require('../../src/server');
const app=express();app.get('/health/live',(req,res)=>res.json({status:'LIVE'}));
const events=[];
const production={app,port:0,logger:{info(){},error(){}},
 observability:{lifecycle:{start(){},async stop(){events.push('lifecycle-stop');}}},
 async assertDatabaseReadiness(){if(process.env.AV01_FAIL==='readiness')throw Error('SYNTHETIC_SCHEMA_FAILURE');},
 async runRequiredLegacyBootstrap(){},async closeOpportunityRuntime(){events.push('runtime-close');},logFrontendUrlHealth(){},
 legacyBootstrapEnabled:false,notificationSchedulerEnabled:false,euFundingSchedulerEnabled:false};
start({production,telemetry:{},host:'127.0.0.1',installSignals:true,env:{API_SHUTDOWN_GRACE_MS:'200',API_SHUTDOWN_SETTLE_MS:'500'}}).then(api=>{
 process.send({kind:'READY',port:api.server.address().port});
 process.once('message',async message=>{
  if(message!=='STOP')throw Error('UNEXPECTED_TEST_CONTROL');
  try{const result=await api.shutdown();process.send({kind:'SHUTDOWN',result,events},()=>process.disconnect());}
  catch{process.exitCode=1;process.send({kind:'FAILED',events},()=>process.disconnect());}
 });
},()=>{process.exitCode=1;process.send({kind:'START_FAILED',events},()=>process.disconnect());});
