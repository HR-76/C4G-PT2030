'use strict';
// Test-process observer only. No SQL/arguments/results, admission or authority
// decisions are changed. Loaded before the unchanged contention profile.
const {AsyncLocalStorage}=require('node:async_hooks');
const {createHash}=require('node:crypto');
const {Client}=require('../../../backend/node_modules/pg');
const instrumentation=require('../http-contention/instrumentation');
const scope=new AsyncLocalStorage();
const round=n=>Math.round(n*100)/100;
const digest=sql=>createHash('sha256').update(sql).digest('hex').slice(0,16);
const role=client=>{
 const user=client.connectionParameters.user;
 return user==='c4g_authority_runtime'?'authority':user?.startsWith('c4g_onb_api_')?'tenant':user?.startsWith('c4g_catalog_')?'catalog':'central-reader';
};
function add(target,key,ms){const v=target[key] ||= {calls:0,ms:0,maxMs:0};v.calls++;v.ms+=ms;v.maxMs=Math.max(v.maxMs,ms);}
function timed(kind,name,original,receiver,args){
 const state=scope.getStore();if(!state)return original.apply(receiver,args);
 const entry={id:state.trace.spans.length,kind,name,parent:state.span?.id??null,stage:kind==='stage'?name:state.stage,startMs:round(performance.now()-state.trace.startedAt),endMs:null,ms:null};
 state.trace.spans.push(entry);const start=performance.now();
 const finish=()=>{entry.ms=round(performance.now()-start);entry.endMs=round(performance.now()-state.trace.startedAt);};
 return scope.run({...state,stage:entry.stage,span:entry},()=>{
  let result;try{result=original.apply(receiver,args);}catch(error){finish();entry.failed=true;throw error;}
  // All observed ports are async. Preserve the value and original rejection.
  return Promise.resolve(result).then(value=>{finish();return value;},error=>{finish();entry.failed=true;throw error;});
 });
}
const originalInstall=instrumentation.install;
instrumentation.install=function(...args){
 const metrics=originalInstall.apply(this,args),undo=[];
 const originalQuery=Client.prototype.query;
 Client.prototype.query=function(...queryArgs){
  const state=scope.getStore();if(!state)return originalQuery.apply(this,queryArgs);
  const sql=typeof queryArgs[0]==='string'?queryArgs[0]:queryArgs[0]?.text||'';
  const category=instrumentation.label(sql),who=role(this),hash=digest(sql),stage=state.stage||'request-outside-stages';
  const bucket=state.trace.stages[stage] ||= {queries:0,authorityTransactions:0,roles:{},hashes:{}};
  bucket.queries++;if(category==='authority-lock')bucket.authorityTransactions++;
  const begin=performance.now();let completed=false;
  const finish=error=>{
   if(completed)return;completed=true;const end=performance.now(),ms=end-begin;
   add(bucket.roles,who+'/'+category,ms);add(bucket.hashes,hash,ms);
   if(error)bucket.errors=(bucket.errors||0)+1;
   if(state.trace.captureEvents)state.trace.queryEvents.push([round(begin-state.trace.startedAt),round(end-state.trace.startedAt),stage,who,category,hash,state.span?.id??null]);
  };
  if(typeof queryArgs.at(-1)==='function'){
   const callback=queryArgs.at(-1);queryArgs[queryArgs.length-1]=function(error,...values){finish(error);return callback.call(this,error,...values);};
   try{return originalQuery.apply(this,queryArgs);}catch(error){finish(error);throw error;}
  }
  try{return originalQuery.apply(this,queryArgs).then(value=>{finish();return value;},error=>{finish(error);throw error;});}
  catch(error){finish(error);throw error;}
 };
 undo.push(()=>{Client.prototype.query=originalQuery;});
 for(const [file,names]of [
  ['authoritySecurityManifest',['assertAuthorityAdmission','assertAuthoritySecurity']],
  ['centralSchemaManifest',['assertCentralSchema','assertCentralSchemaForVersions']],
  ['tenantRuntimeMetadata',['observeTenantRuntimeMetadata']]
 ]){
  const module=require('../../../backend/src/security/'+file);
  for(const name of names){const original=module[name];module[name]=function(...values){return timed('checkpoint',name,original,this,values);};undo.push(()=>{module[name]=original;});}
 }
 const routes=require('../../../backend/src/routes/organizationDashboardRoutes'),originalFactory=routes.createOrganizationDashboardRouter;
 routes.createOrganizationDashboardRouter=function(options){
  const applications={...options.applications,execute(...values){return timed('stage',values[0],options.applications.execute,options.applications,values);}};
  const opportunities={...options.opportunities,dashboardSummary(...values){return timed('stage','privateSummary',options.opportunities.dashboardSummary,options.opportunities,values);}};
  const central={...options.central,dashboardSummary(...values){return timed('stage','centralSummary',options.central.dashboardSummary,options.central,values);}};
  return originalFactory.call(this,{...options,applications,opportunities,central});
 };
 undo.push(()=>{routes.createOrganizationDashboardRouter=originalFactory;});
 return {...metrics,
  middleware(req,res,next){return metrics.middleware(req,res,()=>{
   const record=metrics.records.get(req.get('X-Contention-Request'));
   if(!record||!req.path.endsWith('/dashboard/summary'))return next();
   const trace={startedAt:performance.now(),responseMs:null,spans:[],stages:{},captureEvents:record.phase==='dashboard-c1',queryEvents:[],eventFields:['startMs','endMs','stage','role','category','sqlHash','spanId']};
   record.stageTrace=trace;res.once('finish',()=>{trace.responseMs=round(performance.now()-trace.startedAt);});
   return scope.run({trace,stage:'request-outside-stages',span:null},next);
  });},
  async close(){undo.reverse().forEach(fn=>fn());await metrics.close();}
 };
};
