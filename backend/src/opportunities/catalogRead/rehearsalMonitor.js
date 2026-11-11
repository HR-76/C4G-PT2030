'use strict';
const {MetricRegistry}=require('../../observability/metrics');
const {MEMORY_LIMIT}=require('../../observability/exporters');
const WINDOW=300000,ROUTES=['list','detail','collection','options','availability','unknown'];
const codes=new Set(['INVALID_QUERY','INVALID_CURSOR','INVALID_SNAPSHOT','SESSION_REQUIRED','ACCESS_DENIED','SNAPSHOT_SCOPE_MISMATCH','OPPORTUNITY_NOT_FOUND','RESOURCE_NOT_FOUND','CURSOR_CONTEXT_MISMATCH','SNAPSHOT_EXPIRED','SNAPSHOT_UNAVAILABLE','FILTER_VALUE_UNKNOWN','CATALOG_UNAVAILABLE','PROJECTION_ITEM_TOO_LARGE','INTERNAL_ERROR']);
function route(path){if(path==='/availability')return 'availability';if(path==='/options')return 'options';if(path==='/opportunities')return 'list';if(/^\/opportunities\/[a-f0-9-]{36}$/.test(path))return 'detail';if(/^\/opportunities\/[a-f0-9-]{36}\/(windows|funding|funding-rules|documents|conflicts|relationships|history|evidence)$/.test(path))return 'collection';return 'unknown';}
const template=r=>({list:'/opportunities',detail:'/opportunities/:id',collection:'/opportunities/:id/:collection',options:'/options',availability:'/availability',unknown:'unmatched'})[r];
function summarize(rows){const successful=rows.filter(r=>r.status===200).map(r=>r.durationMs).sort((a,b)=>a-b),eligible=rows.filter(r=>![401,403,404,409,410,422].includes(r.status)),errors=eligible.filter(r=>r.status>=500).length;return {samples:rows.length,successes:successful.length,p95Ms:successful.length?successful[Math.ceil(successful.length*.95)-1]:null,eligible:eligible.length,errors,errorRate:eligible.length?errors/eligible.length:null,sufficient:successful.length>=100};}
function createRehearsalMonitor({sink,clock=()=>Date.now(),capacity=4096}){
 if(typeof sink!=='function'||!Number.isInteger(capacity)||capacity<1||capacity>10000)throw TypeError('Bounded monitor and synchronous evidence sink required');
 let registry=new MetricRegistry();
 let samples=[],failed=false,lastDelivery=null,truncatedUntil=0,probeFailures=0,dropped=0,metricDrops=0;
 function deliver(event){try{const result=sink(Object.freeze(event));if(result?.then){result.catch?.(()=>{});throw Error('ASYNC_SINK_NOT_SUPPORTED');}lastDelivery=clock();return true;}catch{failed=true;return false;}}
 function heartbeat(){const ok=deliver({version:1,type:'heartbeat',at:clock()});if(ok)failed=false;return ok;}
 function observe({path,method='GET',status,errorCode=null,durationMs}){
  if(!Number.isInteger(status)||status<100||status>599||!Number.isFinite(durationMs)||durationMs<0){failed=true;return;}
  const r=route(path),event={version:1,type:'http',at:clock(),route:r,method:['GET','POST','HEAD','OPTIONS','PUT','PATCH','DELETE'].includes(method)?method:'OTHER',status,errorCode:codes.has(errorCode)?errorCode:null,durationMs:Math.round(durationMs*1000)/1000};
  samples=samples.filter(s=>s.at>clock()-2*WINDOW);
  if(samples.length>=capacity){truncatedUntil=Math.max(truncatedUntil,samples.shift().at+2*WINDOW);dropped++;}
  samples.push(event);
  if(registry.records.length>=Math.min(capacity,MEMORY_LIMIT))registry=new MetricRegistry();
  try{if(!registry.record('c4g.http.server.duration',event.durationMs/1000,{service:'c4g-api',component:'catalog-read',routeTemplate:template(r),method:event.method,statusClass:String(Math.floor(status/100))+'xx'}))metricDrops++;}catch{failed=true;}
  deliver(event);
 }
 function probe(ok){if(typeof ok!=='boolean')throw TypeError('Boolean probe result required');probeFailures=ok?0:probeFailures+1;deliver({version:1,type:'probe',at:clock(),ok});}
 const healthy=()=>!failed&&lastDelivery!==null&&clock()-lastDelivery<=120000;
 function control(action,p){if(!['enable','disable','withdraw','resume'].includes(action))throw TypeError('Unknown control action');return deliver({version:1,type:'control',at:clock(),action,revision:p.revision,mode:p.mode,organizationCount:p.organizations.length,withdrawnCount:p.blockedGenerations.length});}
 function snapshot(){
  const now=clock(),start=Math.floor(now/WINDOW)*WINDOW,current=samples.filter(s=>s.at>=start&&s.at<=now),previous=samples.filter(s=>s.at>=start-WINDOW&&s.at<start),complete=now>=truncatedUntil;
  const routes=Object.fromEntries(ROUTES.map(r=>[r,{current:summarize(current.filter(s=>s.route===r)),previous:summarize(previous.filter(s=>s.route===r))}]));
  const alerts=[];if(!healthy())alerts.push('TELEMETRY_UNAVAILABLE');if(probeFailures>=3)alerts.push('PROBE_FAILURE');if(!complete)alerts.push('COVERAGE_INCOMPLETE');if(metricDrops)alerts.push('METRIC_CARDINALITY_DROP');
  for(const r of ['list','detail']){const {current:c,previous:p}=routes[r];if(complete&&c.sufficient&&p.sufficient&&c.p95Ms>500&&p.p95Ms>500)alerts.push('LATENCY_SUSTAINED_'+r.toUpperCase());if(complete&&c.eligible>=100&&c.errorRate>.01)alerts.push('ERROR_RATE_'+r.toUpperCase());}
  return Object.freeze({version:1,healthy:healthy(),complete,windowMs:WINDOW,capacity,retained:samples.length,dropped,metricDrops,probeFailures,routes,alerts});
 }
 return Object.freeze({observe,heartbeat,probe,healthy,snapshot,control,metrics:()=>registry.snapshot()});
}
module.exports={createRehearsalMonitor,WINDOW,route};
