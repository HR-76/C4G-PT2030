'use strict';
const {OPS}=require('./operationalService');
const operations=new Set(Object.keys(OPS).map(method=>`profile.operational.${method}`));
function createOperationalTelemetry({metrics}){if(!metrics?.record)throw new TypeError('F13 metrics required');return Object.freeze({async observe(operation,work){
 if(!operations.has(operation))throw new TypeError('Unknown operation');const start=Date.now();let resultClass='success';
 try{return await work();}catch(error){resultClass=/AUTHORIZATION|NOT_AVAILABLE/.test(error.code||'')?'denied':/CONFLICT|STALE|STATE/.test(error.code||'')?'conflict':/INVALID/.test(error.code||'')?'invalid':'unavailable';throw error;}
 finally{try{metrics.record('c4g.profile_operational.operation',1,{operation,resultClass});metrics.record('c4g.profile_operational.duration',(Date.now()-start)/1000,{operation,resultClass});}catch{}}
}});}
module.exports={createOperationalTelemetry};
