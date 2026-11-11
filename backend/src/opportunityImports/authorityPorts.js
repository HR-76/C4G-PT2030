'use strict';
const {importError}=require('./httpErrors');

function createOpportunityImportWorkerContextPort({membershipPort,authorizationDataPort}){
 if(!membershipPort||typeof membershipPort.revalidate!=='function'||!authorizationDataPort||typeof authorizationDataPort.load!=='function')throw new TypeError('F12 import worker authority dependencies are required.');
 return Object.freeze({async resolve(execution){
  const supplied=execution?.actor;
  if(!supplied||supplied.kind!=='HUMAN'||typeof supplied.id!=='string'||!Number.isSafeInteger(supplied.membershipVersion))throw importError('AUTHORITY_REQUIRED');
  const actor={type:'HUMAN',id:supplied.id,organizationId:execution.organizationId,membershipId:supplied.membershipId||null,membershipVersion:supplied.membershipVersion};
  if(!actor.membershipId)throw importError('AUTHORITY_REQUIRED');
  const membership=await membershipPort.revalidate(actor);
  if(!membership||membership.status!=='ACTIVE'||membership.id!==actor.membershipId||membership.organizationId!==actor.organizationId||membership.globalUserId!==actor.id||membership.membershipVersion!==actor.membershipVersion)throw importError('AUTHORITY_REQUIRED');
  const snapshot=await authorizationDataPort.load(actor);
  if(!snapshot||snapshot.organizationId!==actor.organizationId||snapshot.membershipVersion!==actor.membershipVersion)throw importError('AUTHORITY_REQUIRED');
  actor.authorizationVersion=snapshot.authorizationVersion;
  return Object.freeze({actor:Object.freeze(actor),assuranceEvidence:null,correlationId:execution.correlationId,causationId:execution.executionId});
 }});
}

module.exports={createOpportunityImportWorkerContextPort};
