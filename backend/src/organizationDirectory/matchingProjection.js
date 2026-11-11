'use strict';
const factValue=fact=>fact?.state==='PRESENT'?fact.value:null;
function projectMatchOpportunity(record,{origin,opportunityId,asOf}){
 const snapshot=record.snapshot||record;
 const model=record.readModel||(snapshot.schemaVersion===2?require('../opportunities/v2/readModel').createOpportunityReadModel(snapshot,{revisionId:record.revisionId||null,asOf}):null);
 const href=(origin==='CENTRAL'?'/catalogo/':'/oportunidades/')+opportunityId;
 if(!model)return {...snapshot,opportunityId,origin,href};
 const p=model.projection,temporal=model.temporal;
 if(model.sourceVersion===1)return {opportunityId,origin,href,sourceVersion:1,lifecycleState:record.lifecycleState||snapshot.lifecycleState||null,
  title:factValue(p.description.title),summary:factValue(p.description.summary),programmeName:factValue(p.legacy.programmeName),
  funderName:factValue(p.legacy.funderName),eligibility:factValue(p.legacy.eligibilitySummary),
  callReference:factValue(p.legacy.callReference),officialUrl:factValue(p.links.official),
  openingDate:factValue(p.legacy.openingDate),closingDate:factValue(p.legacy.closingDate)};
 const displayLabels=fact=>(factValue(fact)||[]).map(item=>typeof item==='string'?item:item.label).filter(Boolean).join(' · ')||null;
 const confirmed=temporal.nextDeadline?.at||(!temporal.nextDeadlineCandidates.length?temporal.finalDeadline?.at:null);
 const deadline=confirmed||factValue(p.schedule.plannedClosing)||null;
 // Matching is a compact suggestion projection, not an opportunity snapshot.
 // Do not copy every source artifact or infer eligibility from these keywords.
 return {opportunityId,origin,href,sourceVersion:2,lifecycleState:record.lifecycleState||null,
  title:factValue(p.description.title),programmeName:displayLabels(p.programmes),summary:factValue(p.description.summary),
  eligibility:factValue(p.eligibility.conditions),
  closingDate:confirmed&&['DATE','INSTANT'].includes(confirmed.precision)?confirmed.value:null,
  deadline,deadlineKind:confirmed?'CONFIRMED':deadline?'PLANNED':null,
  temporalState:temporal.effectiveState,temporalReasonCodes:temporal.reasonCodes};
}
function currentForMatching(item,today){
 if(item.lifecycleState!=='ACTIVE')return false;
 if(item.sourceVersion===2||item.readModel?.sourceVersion===2){
  const state=item.temporalState||item.readModel.temporal.effectiveState;
  return !['CLOSED','CANCELLED'].includes(state);
 }
 return !item.closingDate||item.closingDate.slice(0,10)>=today;
}
module.exports={projectMatchOpportunity,currentForMatching};
