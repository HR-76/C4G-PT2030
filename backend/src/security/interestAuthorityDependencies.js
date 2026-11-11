'use strict';
// Exact extra checks supported by the interest flow; organization equality is
// enforced by the coordinator for every dependency, including these cases.
function allowsInterestDependency(operationCode,intention,item){
 const code=item.operationCode,type=item.resource?.resourceType;
 if(type==='OPPORTUNITY_INTEREST'){
  if(['OPPORTUNITY_INTEREST_REGISTER','OPPORTUNITY_INTEREST_MANAGE'].includes(operationCode))return code==='OPPORTUNITY_INTEREST_READ';
  if(operationCode==='OPPORTUNITY_INTEREST_READ'&&intention?.operation==='INTEREST_UNIT_ASSIGN')return ['OPPORTUNITY_INTEREST_REGISTER','OPPORTUNITY_INTEREST_MANAGE'].includes(code);
  if(operationCode==='APPLICATION_CREATE'&&intention?.operation==='APPLICATION_CREATE')return ['OPPORTUNITY_INTEREST_READ','OPPORTUNITY_INTEREST_MANAGE'].includes(code);
 }
 return operationCode==='APPLICATION_CREATE'&&intention?.operation==='APPLICATION_CREATE'&&type==='APPLICATION'&&code==='APPLICATION_WORK_EDIT';
}
module.exports={allowsInterestDependency};
