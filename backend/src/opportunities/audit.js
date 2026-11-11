'use strict';
const {F12_EVENTS}=require('../audit/eventCatalog');
const FORBIDDEN=/(?:title|summary|url|identifier|organization|tenant|actor|document|sql|dsn|stack|message|secret|token)/i;
const ALLOWED=new Set(['schemaVersion','eventCode','correlationId','causationId','catalogVersion','normalizationVersion','qualityRuleVersion','deduplicationRuleVersion','lifecycleState','validationState','qualityBucket','classification','reasonCodes','contentDigest','provenanceDigest','idempotencyDigest']);
function createOpportunityAuditPort(f7){
 if(!f7||typeof f7.accept!=='function')throw new TypeError('F12 requires the F7 audit port.');
 async function send(eventCode,input,critical){
  if(!Object.hasOwn(F12_EVENTS,eventCode)||!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).some(key=>!ALLOWED.has(key)||FORBIDDEN.test(key)))throw new TypeError('Opportunity audit event is not allowlisted.');
  const result=await f7.accept(Object.freeze({schemaVersion:1,eventCode,...input}));
  if(critical&&(!result||!['ACCEPTED','APPENDED','DUPLICATE'].includes(result.status)))throw new Error('OPPORTUNITY_CRITICAL_AUDIT_UNAVAILABLE');
  return result;
 }
 return Object.freeze({accept:(code,input)=>send(code,input,true),emit:(code,input)=>send(code,input,false)});
}
module.exports={createOpportunityAuditPort};
