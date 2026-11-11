'use strict';
const {OPS}=require('./populationService');
const operations=new Set(Object.keys(OPS).map(method=>`profile.population.${method}`));
function createPopulationTelemetry({metrics}){if(!metrics?.record)throw new TypeError('F13 metrics required');return Object.freeze({async observe(operation,work){
 if(!operations.has(operation))throw new TypeError('Unknown operation');const start=Date.now();let resultClass='success';
 try{return await work();}catch(error){resultClass=/AUTHORIZATION|NOT_AVAILABLE/.test(error.code||'')?'denied':/CONFLICT|STALE|STATE/.test(error.code||'')?'conflict':/INVALID/.test(error.code||'')?'invalid':'unavailable';throw error;}
 finally{try{metrics.record('c4g.profile_population.operation',1,{operation,resultClass});metrics.record('c4g.profile_population.duration',(Date.now()-start)/1000,{operation,resultClass});}catch{}}
}});}
module.exports={createPopulationTelemetry};
