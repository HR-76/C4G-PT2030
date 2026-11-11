'use strict';
const path=require('node:path');
const {installShutdownControl}=require('./documentWorkerEntrypointChild');

const control=path.resolve(String(process.env.DOCUMENT_WORKER_TEST_CONTROL_PATH||''));
if(process.env.NODE_ENV!=='test'||!path.isAbsolute(control))throw new Error('DOCUMENT_WORKER_TEST_CONTROL_INVALID');
installShutdownControl({controlPath:control,runtime:{async shutdown(){return Object.freeze({mode:'GRACEFUL',controlReceived:true});}}});
process.stdout.write(`${JSON.stringify({type:'READY',readiness:{fixture:'document-worker-entrypoint-control-v1',controlArmed:true}})}\n`);
