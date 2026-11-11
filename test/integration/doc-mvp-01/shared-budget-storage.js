'use strict';
const {createDocumentWorkerStorageProvider:baseProvider}=require('../../../backend/test/fixtures/documentWorkerStorageProvider');
const {createBudgetClient}=require('./shared-r2-budget');

// Same application port as the controlled storage fixture. Reservations are at
// the simulated provider boundary, not around each high-level document action.
function createDocumentWorkerStorageProvider({env}) {
  if(env.NODE_ENV!=='test'||env.DOCUMENT_WORKER_TEST_ADAPTERS!=='enabled')throw new Error('BUDGET_TEST_PROVIDER_FORBIDDEN');
  const budget=createBudgetClient({port:Number(env.DOCUMENT_PROOF_BUDGET_PORT),token:env.DOCUMENT_PROOF_BUDGET_TOKEN});
  if(env.DOCUMENT_PROOF_REMOTE_STORAGE==='R2'){
    const {loadApplicationDocumentConfiguration}=require('../../../backend/src/config/applicationDocuments');
    const {createR2Storage}=require('../../../backend/src/documents/r2Storage');
    const {S3Client}=require('../../../backend/node_modules/@aws-sdk/client-s3');
    const {NodeHttpHandler}=require('../../../backend/node_modules/@smithy/node-http-handler');
    const {instrumentBudgetClient}=require('./shared-budget-transport');
    const configuration=loadApplicationDocumentConfiguration(env),stores=[];
    return Object.freeze({create({organizationId}){
      const raw=new S3Client({region:'auto',endpoint:configuration.r2.endpoint,forcePathStyle:true,followRegionRedirects:false,credentials:{...configuration.credentials},maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',requestHandler:new NodeHttpHandler()});
      const guarded=instrumentBudgetClient(raw,budget);const store=createR2Storage(configuration.r2,{organizationId,credentials:configuration.credentials,client:guarded});
      stores.push({store,raw});return store;
    },async close(){for(const {store,raw} of stores){await store.shutdown();raw.destroy();}}});
  }
  if(env.DOCUMENT_PROOF_REMOTE_STORAGE)throw new Error('BUDGET_STORAGE_MODE_INVALID');
  const provider=baseProvider({env});
  return Object.freeze({create(input){const base=provider.create(input);return Object.freeze({...base,
    async beginWrite(value){return budget.perform('OBJECT_INTENT',0,()=>base.beginWrite(value),{objectId:value.objectId});},
    async commit(handle,value){return budget.perform('PutObject',value.size,()=>base.commit(handle,value),{objectId:handle.objectId});},
    async head(value){return budget.perform('HeadObject',0,()=>base.head(value));},
    async readRange(value){return budget.perform('GetObject',value.end-value.start+1,()=>base.readRange(value));},
    async health(){await budget.perform('HeadBucket',0,()=>base.health());return budget.perform('HeadBucket',0,()=>base.health());}
  });},close:()=>provider.close()});
}
module.exports={createDocumentWorkerStorageProvider};
