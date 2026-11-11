'use strict';
// Grants are independent of job profiles and never confer management of access.
function financialGrants(previous,organizationId,enabled) {
  const grants=previous.filter(grant=>grant.permission!=='billing.read');
  if(enabled)grants.push({permission:'billing.read',scope:{type:'ORGANIZATION',id:organizationId,organizationId}});
  return grants;
}
module.exports={financialGrants};
