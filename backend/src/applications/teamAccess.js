'use strict';

// Only installed in the application composition. Central membership/profile/version
// remain authoritative. Effective read grants never leave this request/transaction.
function createTeamAccessPolicy({currentClient, operationCatalog}) {
  return async function snapshotForResource({actor, snapshot, resource, operationCode}) {
    if (snapshot.profileCode !== 'CONTRIBUTOR' || actor.type !== 'HUMAN') return snapshot;
    if (actor.organizationId !== resource.organizationId || snapshot.organizationId !== actor.organizationId) throw Error('TEAM_SCOPE_MISMATCH');
    const operation = operationCatalog.resolve(operationCode);
    if (!operation || operation.resourceType !== resource.resourceType) return snapshot;
    const client = currentClient(actor.organizationId);
    const root = resource.id === actor.organizationId;
    const application = resource.resourceType === 'APPLICATION';
    const source = operationCode === 'OPPORTUNITY_READ' || operationCode === 'F14_PREQUALIFICATION_READ';
    if (!application && !source) return snapshot;

    // A collection read only opens the filtered list. Individual resources below
    // must still pass the current participant check, including broad old grants.
    // A technician allowed to start applications may read opportunities at organization level (list and
    // capabilities only); individual opportunities stay limited to the teams they belong to.
    const mayStart = source && root && operationCode === 'OPPORTUNITY_READ'
      && snapshot.grants.some(g => g.permission === 'application.create' && g.scope?.type === 'ORGANIZATION'
        && g.scope.organizationId === actor.organizationId && !g.resourceId);
    let participating = (application && root && operation.permission === 'application.read') || mayStart;
    if (application && root && operation.permission !== 'application.read') return snapshot;
    if (!participating) {
      const predicate = application ? 'a.application_id=$3'
        : operationCode === 'F14_PREQUALIFICATION_READ' ? 'a.evaluation_id=$3'
        : root ? "to_jsonb(a)->>'central_opportunity_id' IS NOT NULL"
        : "(a.opportunity_id=$3 OR to_jsonb(a)->>'central_opportunity_id'=$3::text)";
      const params = [actor.organizationId, actor.membershipId];
      if (!(source && operationCode === 'OPPORTUNITY_READ' && root)) params.push(resource.id);
      participating = Boolean((await client.query(`SELECT 1 FROM opportunity_catalog.application a
        JOIN opportunity_catalog.application_participant p ON p.organization_id=a.organization_id AND p.application_id=a.application_id
        WHERE a.organization_id=$1 AND p.membership_id=$2 AND p.active AND ${predicate} LIMIT 1`, params)).rows[0]);
    }
    if (application && !participating) return {...snapshot, grants: snapshot.grants.filter(g => !g.permission.startsWith('application.'))};
    // The chat is writable by active participants. Other writes keep their
    // existing grants. Source reads are limited to accessible applications.
    const chatSend = application && !root && operationCode === 'APPLICATION_CHAT_SEND';
    if (!participating || (operation.effect !== 'READ' && !chatSend) || !(source || operation.permission === 'application.read')) return snapshot;
    return {...snapshot, grants: [...snapshot.grants, {
      permission: operation.permission, resourceId: resource.id, resourceType: resource.resourceType,
      // F14's catalog permits ORGANIZATION scope only. The exact resourceId/type
      // binding above still limits this transient grant to the checked reference.
      scope: {type: root || operationCode === 'F14_PREQUALIFICATION_READ' ? 'ORGANIZATION' : 'RESOURCE',
        id: root || operationCode === 'F14_PREQUALIFICATION_READ' ? actor.organizationId : resource.id, organizationId: actor.organizationId}
    }]};
  };
}
module.exports = {createTeamAccessPolicy};
