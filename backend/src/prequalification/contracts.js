'use strict';
const {uuid:assertUuid}=require('./materializer');
function uuid(value){try{assertUuid(value);}catch{fail('INVALID_INPUT');}}
const {fail}=require('./release');
const operations=Object.freeze({activate:'F13_PROFILE_COHORT_ACTIVATE',evaluate:'F14_PREQUALIFICATION_EVALUATE',read:'F14_PREQUALIFICATION_READ',decide:'F14_PREQUALIFICATION_DECIDE',decisions:'F14_PREQUALIFICATION_READ',active:'F13_PROFILE_READ',context:'F13_PROFILE_READ',preview:'F13_PROFILE_READ',snapshot:'F13_PROFILE_READ',activations:'F13_PROFILE_READ'});
function validate(method,input){
 const keys={activate:['versionId','expectedActivationId','expectedGeneration','reason','idempotencyKey'],evaluate:['opportunityId','opportunityRevisionId','criteriaRevisionId','activationId','generation','idempotencyKey'],decide:['evaluationId','decision','reasonCode','justification','criterionIds','expectedDecisionId','expectedGeneration','idempotencyKey'],decisions:['evaluationId','cursor'],read:['evaluationId'],active:[],context:['cursor'],preview:['versionId'],snapshot:['snapshotId'],activations:['cursor'],lookup:['operation','resourceId','idempotencyKey']}[method];
 if(!keys||!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k)))fail('INVALID_INPUT');
 for(const k of keys)if(k.endsWith('Id')||k==='idempotencyKey'){if(['expectedActivationId','expectedDecisionId'].includes(k)&&input[k]===null)continue;uuid(input[k]);}
 if(method==='activate'){
  if(!Number.isSafeInteger(input.expectedGeneration)||input.expectedGeneration<0||input.expectedGeneration>=Number.MAX_SAFE_INTEGER||(input.expectedActivationId===null)!==(input.expectedGeneration===0))fail('INVALID_INPUT');
  if(typeof input.reason!=='string'||input.reason.trim().length<1||input.reason.length>2000)fail('INVALID_INPUT');
 }
 if(method==='evaluate'&&(!Number.isSafeInteger(input.generation)||input.generation<1))fail('INVALID_INPUT');
 if(['context','activations','decisions'].includes(method)&&input.cursor!==null&&(typeof input.cursor!=='string'||input.cursor.length>4096))fail('INVALID_INPUT');
 if(method==='lookup'&&!['PQ1_ACTIVATE','PQ1_EVALUATE','PQ1_DECIDE'].includes(input.operation))fail('INVALID_INPUT');
 if(method==='decide'){
  const reasons={REQUEST_INFORMATION:['INFORMATION_MISSING'],KEEP_UNDER_REVIEW:['FURTHER_REVIEW'],DISCARD_FROM_ANALYSIS:['OUT_OF_SCOPE_FOR_ORGANIZATION','OTHER_JUSTIFIED']};
  if(!reasons[input.decision]?.includes(input.reasonCode)||typeof input.justification!=='string'||!input.justification.trim()||input.justification.length>2000)fail('INVALID_INPUT');
  if(!Array.isArray(input.criterionIds)||input.criterionIds.length>100||new Set(input.criterionIds).size!==input.criterionIds.length)fail('INVALID_INPUT');input.criterionIds.forEach(uuid);
  if((input.decision==='REQUEST_INFORMATION')!==(input.criterionIds.length>0))fail('INVALID_INPUT');
  if(!Number.isSafeInteger(input.expectedGeneration)||input.expectedGeneration<0||input.expectedGeneration>=Number.MAX_SAFE_INTEGER||(input.expectedDecisionId===null)!==(input.expectedGeneration===0))fail('INVALID_INPUT');
 }
 return Object.freeze({...input});
}
module.exports={validate,operations};
