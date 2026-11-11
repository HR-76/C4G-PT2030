'use strict';
const {importError}=require('./httpErrors');

const {createOpportunityImportWorkflow}=require('./workflow');
const {createImportRepository}=require('./repository');
const {createOpportunityImportAudit}=require('./audit');
const {createOpportunityImportF9JobPort}=require('./f9JobPort');
const {createOpportunityImportJobRegistry}=require('./jobs');
const {createUuidV7}=require('../audit/uuidV7');

const CONTEXT=Symbol('f12.import.production.context');

function method(value,name){if(!value||typeof value[name]!=='function')throw new TypeError(`F12 import production ${name} dependency is required.`);}
function trusted(value){return Boolean(value&&value[CONTEXT]===true&&value.actor&&typeof value.actor.organizationId==='string'&&typeof value.tenantId==='string');}

function createOpportunityImportProductionComposition({requestContextPort,workerContextPort,tenantDirectory,
  transactionPortFactory,authorizationPortFactory,documentPortFactory,opportunityPortFactory,clock,id=createUuidV7,telemetry=null}){
 method(requestContextPort,'resolve');method(workerContextPort,'resolve');method(tenantDirectory,'resolveSnapshotByOrganization');
 for(const [value,name] of [[transactionPortFactory,'transactionPortFactory'],[authorizationPortFactory,'authorizationPortFactory'],
   [documentPortFactory,'documentPortFactory'],[opportunityPortFactory,'opportunityPortFactory']])if(typeof value!=='function')throw new TypeError(`F12 import production ${name} is required.`);
 const observed=(operation,work)=>telemetry?.observe?telemetry.observe(operation,work):work();
 async function seal(raw,source){
  if(!raw?.actor||typeof raw.actor.organizationId!=='string'||!['API','WORKER'].includes(source))throw importError('AUTHORITY_REQUIRED');
  const snapshot=await tenantDirectory.resolveSnapshotByOrganization(raw.actor.organizationId,source);
  if(!snapshot?.tenantId||snapshot.organizationId!==raw.actor.organizationId)throw importError('IMPORT_TENANT_UNAVAILABLE');
  return Object.freeze({...raw,tenantId:snapshot.tenantId,source,channel:'APPLICATION',[CONTEXT]:true});
 }
 let registry;
 async function bind(context){
  if(!trusted(context))throw importError('AUTHORITY_REQUIRED');
  const binding=Object.freeze({organizationId:context.actor.organizationId,tenantId:context.tenantId,source:context.source});
  const transactions=await transactionPortFactory(binding,context),authorization=await authorizationPortFactory(binding,context),
    documents=await documentPortFactory(binding,context),opportunities=await opportunityPortFactory(binding,context);
  method(transactions,'run');method(authorization,'protect');
  for(const name of ['storeOriginal','read','storeReport','download'])method(documents,name);
  method(opportunities,'create');
  const jobs=createOpportunityImportF9JobPort({registry,...(clock?{clock}:{}),...(id?{id}:{})});
  return createOpportunityImportWorkflow({transactions,authorization,documents,opportunities,jobs,
    repository:createImportRepository({organizationId:binding.organizationId}),
    audit:createOpportunityImportAudit({organizationId:binding.organizationId,tenantId:binding.tenantId,...(clock?{clock}:{}),...(id?{uuid:id}:{})}),
    ...(clock?{clock}:{}),...(id?{id}:{})});
 }
 registry=createOpportunityImportJobRegistry(async execution=>observed('opportunity_import.process',async()=>{
  const context=await seal(await workerContextPort.resolve(execution),'WORKER');
  if(context.actor.organizationId!==execution.organizationId)throw importError('IMPORT_JOB_CONTEXT_CONFLICT');
  return (await bind(context)).process({context,importId:execution.payload.importId});
 }));
 const contextPort=Object.freeze({async resolve(request){return seal(await requestContextPort.resolve(request),'API');}});
 const dispatch=name=>async input=>{
  if(!trusted(input?.context))throw importError('AUTHORITY_REQUIRED');
  return observed(`opportunity_import.${name}`,async()=>{
   const workflow=await bind(input.context);return workflow[name](input);
  });
 };
 const workflow=Object.freeze(Object.fromEntries(['upload','preview','confirm','list','get','cancel','review','downloadReport']
   .map(name=>[name,dispatch(name)])));
 return Object.freeze({contextPort,workflow,registry,bindWorkerContext:execution=>workerContextPort.resolve(execution)});
}

module.exports={createOpportunityImportProductionComposition};
