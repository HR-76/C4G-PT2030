'use strict';
const {OPS}=require('./competencyService');
const operations=new Set(Object.keys(OPS).map(method=>`profile.competency.${method}`));
function createCompetencyTelemetry({metrics}){if(!metrics?.record)throw new TypeError('F13 metrics required');return Object.freeze({async observe(operation,work){
 if(!operations.has(operation))throw new TypeError('Unknown operation');const start=Date.now();let resultClass='success';
 try{return await work();}catch(error){resultClass=/AUTHORIZATION|NOT_AVAILABLE/.test(error.code||'')?'denied':/CONFLICT|STALE|STATE/.test(error.code||'')?'conflict':/INVALID/.test(error.code||'')?'invalid':'unavailable';throw error;}
 finally{try{metrics.record('c4g.profile_competency.operation',1,{operation,resultClass});metrics.record('c4g.profile_competency.duration',(Date.now()-start)/1000,{operation,resultClass});}catch{}}
}});}
module.exports={createCompetencyTelemetry};
