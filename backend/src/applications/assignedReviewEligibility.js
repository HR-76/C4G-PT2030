'use strict';

// The caller must provide a fresh, protected Central snapshot and evaluate the
// actual policy for the candidate; this helper never grants access itself.
function reviewerEligible({requester,candidate,application,documents,evaluate,now}) {
 const actor=candidate?.actor,membership=candidate?.membership,snapshot=candidate?.snapshot;
 const org=requester?.organizationId;
 if(!org||!requester.id||!actor?.id||!actor.membershipId||actor.id===requester.id
  ||actor.organizationId!==org||membership?.id!==actor.membershipId
  ||membership.globalUserId!==actor.id||membership.organizationId!==org||membership.status!=='ACTIVE'
  ||!Number.isFinite(now)||typeof membership.validUntil!=='number'||Number.isNaN(membership.validUntil)||membership.validUntil<=now
  ||!Number.isSafeInteger(actor.membershipVersion)||actor.membershipVersion<1
  ||!Number.isSafeInteger(actor.authorizationVersion)||actor.authorizationVersion<1
  ||membership.membershipVersion!==actor.membershipVersion||snapshot?.membershipVersion!==actor.membershipVersion
  ||snapshot.authorizationVersion!==actor.authorizationVersion
  ||snapshot.organizationId!==org||application?.organizationId!==org||!application.id
  ||!Array.isArray(documents)||documents.length===0||documents.some(item=>!item?.id||item.organizationId!==org)
  ||typeof evaluate!=='function')return false;
 try {
  return [['APPLICATION_READ',application],['APPLICATION_REVIEW_DECIDE',application],
   ...documents.map(item=>['DOCUMENT_READ',item])].every(([operation,resource])=>evaluate(operation,resource)?.allowed===true);
 } catch {return false;}
}
module.exports={reviewerEligible};
