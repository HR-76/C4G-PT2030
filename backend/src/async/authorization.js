async function authorizeExecution({ envelope, membershipPort, serviceActorRegistry, authorizationPort }) {
  let subject;
  if(envelope.actor.kind==='HUMAN') { const membership=await membershipPort.getActive({organizationId:envelope.organizationId,userId:envelope.actor.id}); if(!membership || membership.version!==envelope.actor.membershipVersion) return Object.freeze({allowed:false,reason:'AUTHORIZATION_REVOKED'}); subject={kind:'HUMAN',membership}; }
  else { const actor=serviceActorRegistry.resolve(envelope.actor.serviceActorCode); if(!actor || actor.organizationId!==envelope.organizationId || actor.operation!==envelope.operation) return Object.freeze({allowed:false,reason:'AUTHORIZATION_REVOKED'}); subject={kind:'SERVICE',actor}; }
  return authorizationPort.authorize({organizationId:envelope.organizationId,subject,operation:envelope.operation,channel:'JOB'});
}
module.exports={authorizeExecution};
