'use strict';
const { isAuthorityCoordinator } = require('../security/authorityCoordinator');
const ports = new WeakMap();
function isCoordinatedAuthorityDataPort(port, coordinator) { return ports.get(port)===coordinator; }
function createAuthorityDataRepository({ coordinator, policyVersion, catalogs, recentMfaRequirement = {maxAgeSeconds:300,mfa:true,acceptedAcr:['c4g-loa2'],acceptedAmr:['otp'],amrMode:'all'} }) {
  if (!isAuthorityCoordinator(coordinator) || !catalogs?.permissionCatalog || typeof policyVersion!=='string') throw new TypeError('Coordinated F5 source required.');
  const pool = coordinator.pool;
  const authorizationDataPort = Object.freeze({ async load(actor) {
    const row = (await pool.query(`SELECT f.organization_id,f.membership_id,f.authorization_version,f.policy_version,f.grants,f.assurance_requirements,
      m.membership_version,m.base_role_code FROM public.authority_f5_state f
      JOIN public.organization_membership m ON m.id=f.membership_id AND m.organization_id=f.organization_id
      WHERE f.organization_id=$1 AND f.membership_id=$2`, [actor.organizationId,actor.membershipId])).rows[0];
    if (!row || row.policy_version!==policyVersion || Object.keys(recentMfaRequirement).some(key=>
      JSON.stringify(row.assurance_requirements[key])!==JSON.stringify(recentMfaRequirement[key]))) return null;
    return Object.freeze({ organizationId:row.organization_id, membershipVersion:Number(row.membership_version),
      authorizationVersion:Number(row.authorization_version), profileCode:row.base_role_code, grants:row.grants,
      sodRules:[{code:'F13_TAXONOMY_CONCEPT_SOD',distinctFromActorIds:[]},{code:'F13_TAXONOMY_RELEASE_SOD',distinctFromActorIds:[]},
          {code:'F13_PROFILE_ACTIVATION_SOD',distinctFromActorIds:[]},{code:'F13_PROFILE_APPROVAL_SOD',distinctFromActorIds:[]},{code:'F13_PROFILE_PUBLICATION_SOD',distinctFromActorIds:[]},
          {code:'F13_COMPETENCY_VERIFICATION_SOD',distinctFromActorIds:[]},{code:'OPPORTUNITY_ARCHIVE_SOD',distinctFromActorIds:[]},
          {code:'F13_FINANCIAL_VERIFICATION_SOD',distinctFromActorIds:[]},
          {code:'F13_OPERATIONAL_VERIFICATION_SOD',distinctFromActorIds:[]},{code:'F13_POPULATION_VERIFICATION_SOD',distinctFromActorIds:[]}], supportGrant:null });
  } });
  ports.set(authorizationDataPort, coordinator);
  const membershipPort = Object.freeze({ async revalidate(actor) {
    const row = (await pool.query(`SELECT m.id,m.organization_id,m.global_user_id,m.membership_version,m.status,m.valid_until
      FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id
      JOIN public.global_user u ON u.id=m.global_user_id WHERE m.id=$1 AND m.organization_id=$2
      AND o.status='ACTIVE' AND u.status='ACTIVE' AND m.valid_from<=clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())`,[actor.membershipId,actor.organizationId])).rows[0];
    return row ? {id:row.id,organizationId:row.organization_id,globalUserId:row.global_user_id,membershipVersion:Number(row.membership_version),status:row.status,
      validUntil:row.valid_until?new Date(row.valid_until).getTime():Infinity} : null;
  } });
  async function change({ organizationId,membershipId,expectedVersion,grants,newPolicyVersion=policyVersion,assuranceRequirements }) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion<0 || !Array.isArray(grants) || grants.length>1000
        || !/^[a-zA-Z0-9_.-]{1,128}$/.test(newPolicyVersion)) throw new TypeError('F5 authority change invalid.');
    for (const grant of grants) {
      if (!grant || Object.keys(grant).some(key=>!['permission','resourceId','resourceType','scope'].includes(key))
          || !catalogs.permissionCatalog.resolve(grant.permission) || grant.scope?.organizationId!==organizationId
          || !['ORGANIZATION','UNIT','UNIT_SUBTREE','TEAM','RESOURCE'].includes(grant.scope.type)
          || Object.keys(grant.scope).some(key=>!['type','id','organizationId'].includes(key))
          || !/^[0-9a-f-]{36}$/i.test(grant.scope.id)
          || (grant.resourceId && !/^[0-9a-f-]{36}$/i.test(grant.resourceId))
          || (grant.resourceType && !/^[A-Z0-9_]{1,128}$/.test(grant.resourceType))) throw new TypeError('F5 grant invalid.');
    }
    if (!assuranceRequirements || Object.keys(assuranceRequirements).some(key=>!['maxAgeSeconds','mfa','acceptedAcr','acceptedAmr','amrMode'].includes(key))
        || !Number.isSafeInteger(assuranceRequirements.maxAgeSeconds) || assuranceRequirements.maxAgeSeconds<1
        || typeof assuranceRequirements.mfa!=='boolean'
        || !Array.isArray(assuranceRequirements.acceptedAcr) || !Array.isArray(assuranceRequirements.acceptedAmr)
        || [...assuranceRequirements.acceptedAcr,...assuranceRequirements.acceptedAmr].some(code=>typeof code!=='string'||!/^[a-zA-Z0-9_.:-]{1,128}$/.test(code))
        || !['all','any'].includes(assuranceRequirements.amrMode)) throw new TypeError('F5 assurance requirement invalid.');
    return coordinator.write([`MEMBER:${membershipId}`], async () => {
      const member=(await pool.query('SELECT id FROM public.organization_membership WHERE id=$1 AND organization_id=$2',[membershipId,organizationId])).rows[0];
      if (!member) throw new Error('F5_MEMBERSHIP_MISMATCH');
      const row=(await pool.query(`INSERT INTO public.authority_f5_state(organization_id,membership_id,authorization_version,policy_version,grants,assurance_requirements)
        SELECT $1,$2,1,$4,$5,$6 WHERE $3::bigint=0
        ON CONFLICT(organization_id,membership_id) DO UPDATE SET authorization_version=authority_f5_state.authorization_version+1,
        policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp()
        WHERE authority_f5_state.authorization_version=$3 RETURNING authorization_version`,
        [organizationId,membershipId,expectedVersion,newPolicyVersion,JSON.stringify(grants),JSON.stringify(assuranceRequirements)])).rows[0];
      // UPDATE for an existing version cannot use an INSERT SELECT filtered out.
      if (row) return Number(row.authorization_version);
      if (expectedVersion>0) {
        const updated=(await pool.query(`UPDATE public.authority_f5_state SET authorization_version=authorization_version+1,
          policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp()
          WHERE organization_id=$1 AND membership_id=$2 AND authorization_version=$3 RETURNING authorization_version`,
          [organizationId,membershipId,expectedVersion,newPolicyVersion,JSON.stringify(grants),JSON.stringify(assuranceRequirements)])).rows[0];
        if (updated) return Number(updated.authorization_version);
      }
      throw new Error('F5_VERSION_STALE');
    });
  }
  return Object.freeze({ membershipPort,authorizationDataPort,change });
}
module.exports={createAuthorityDataRepository,isCoordinatedAuthorityDataPort};
