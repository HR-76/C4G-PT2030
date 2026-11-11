'use strict';
const {createJobRegistry}=require('../async/jobRegistry');
const {result}=require('../async/jobResult');
const JOB_TYPE='opportunity.import.portugal2030';
function createOpportunityImportJobRegistry(handler){if(typeof handler!=='function')throw new TypeError('Opportunity import handler is required.');return createJobRegistry([Object.freeze({type:JOB_TYPE,version:1,payloadVersion:1,handler:async execution=>{const payload=execution?.payload;if(execution?.envelopeVersion!==2||!payload||Object.getPrototypeOf(payload)!==Object.prototype||Reflect.ownKeys(payload).length!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.importId||''))throw new TypeError('Opportunity import job payload is invalid.');const value=await handler(execution);return value?.state==='CANCELLED'?result('CANCELLED'):result('SUCCESS');}})]);}
module.exports={JOB_TYPE,createOpportunityImportJobRegistry};
