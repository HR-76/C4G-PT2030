'use strict';
const {createDocumentWorkerProductionRuntime}=require('./documentWorkerFactory');
async function loadDocumentWorkerRuntime({env=process.env,telemetry=null}={}){if(env.DOCUMENT_WORKER_RUNTIME!=='f11-documents')throw new TypeError('Document worker runtime selection is invalid.');return createDocumentWorkerProductionRuntime({env,telemetry});}
module.exports={loadDocumentWorkerRuntime};
