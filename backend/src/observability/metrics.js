'use strict';
const {MEMORY_LIMIT}=require('./exporters');
const ID=/[0-9a-f]{8}-[0-9a-f-]{27,}/i;const LABELS=new Set(['service','component','routeTemplate','method','statusClass','errorCode','jobType','resultClass','dependencyClass','operation']);
const CATALOG=Object.freeze({
 'c4g.http.server.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2,5]},
 'c4g.worker.job.duration':{type:'histogram',unit:'s',buckets:[.01,.05,.1,.5,1,5,30,120]},
 'c4g.db.pool.wait':{type:'histogram',unit:'s',buckets:[.001,.005,.01,.05,.1,.5,2]},
 'c4g.reconciliation.lag':{type:'histogram',unit:'s',buckets:[1,5,30,60,300]},
 'c4g.document.bytes':{type:'histogram',unit:'By',buckets:[1024,1048576,16777216,52428800,104857600]},
 'c4g.telemetry.drop':{type:'counter',unit:'{item}',buckets:[]},
 'c4g.health.probe.duration':{type:'histogram',unit:'s',buckets:[.01,.05,.1,.5,1,2]}
 ,'c4g.authorization.decision':{type:'counter',unit:'{request}',buckets:[]}
 ,'c4g.audit.operation':{type:'counter',unit:'{event}',buckets:[]}
 ,'c4g.worker.job':{type:'counter',unit:'{job}',buckets:[]}
 ,'c4g.document.operation':{type:'counter',unit:'{request}',buckets:[]}
 ,'c4g.opportunity.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.opportunity.deduplication':{type:'counter',unit:'{classification}',buckets:[]}
 ,'c4g.opportunity.query.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
 ,'c4g.opportunity_import.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.opportunity_import.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2,5,30,120]}
 ,'c4g.profile_taxonomy.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.profile_taxonomy.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
 ,'c4g.profile_authoring.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.profile_editorial.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.profile_editorial.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
 ,'c4g.profile_authoring.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
 ,'c4g.profile_competency.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.profile_financial.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.profile_population.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.profile_population.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
 ,'c4g.profile_operational.operation':{type:'counter',unit:'{operation}',buckets:[]}
 ,'c4g.profile_operational.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
 ,'c4g.profile_financial.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
 ,'c4g.profile_competency.duration':{type:'histogram',unit:'s',buckets:[.005,.01,.025,.05,.1,.25,.5,1,2]}
});
class MetricRegistry{constructor({seriesPerInstrument=128,seriesPerProcess=4096}={}){this.limits={seriesPerInstrument,seriesPerProcess};this.series=new Map();this.records=[];this.overflow=0;this.recordDrops=0;}record(name,value,labels={}){if(!CATALOG[name]||!Number.isFinite(value))throw new TypeError('Metric is not allowlisted.');for(const [k,v] of Object.entries(labels))if(!LABELS.has(k)||typeof v!=='string'||v.length>64||ID.test(v))throw new TypeError('Metric label is not allowlisted.');const key=JSON.stringify(Object.entries(labels).sort());let set=this.series.get(name);if(!set){set=new Set();this.series.set(name,set);}const total=[...this.series.values()].reduce((n,s)=>n+s.size,0);if(!set.has(key)&&(set.size>=this.limits.seriesPerInstrument||total>=this.limits.seriesPerProcess)){this.overflow++;this.addRecord({name:'c4g.telemetry.drop',value:1,labels:{resultClass:'cardinality_overflow'}});return false;}set.add(key);this.addRecord({name,value,labels:Object.freeze({...labels})});return true;}addRecord(record){if(this.records.length>=MEMORY_LIMIT){this.records.shift();this.recordDrops++;}this.records.push(record);}snapshot(){return Object.freeze({records:this.records.map(Object.freeze),overflow:this.overflow,recordDrops:this.recordDrops});}}
module.exports={CATALOG,LABELS,MetricRegistry};
