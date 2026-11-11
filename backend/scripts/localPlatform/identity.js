'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { root } = require('./config');
const { policyVersion, configureOptionalIdentity } = require('./optionalIdentity');
const requirement = require('../../src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES[policyVersion].policy['recent-auth'];

function identityConfig() {
  return require('dotenv').parse(fs.readFileSync(path.join(root, '.tmp/f2-integration/.env')));
}
async function configureIdentity(state, persist, options) {
  return configureOptionalIdentity(identityConfig(), state, persist, options);
}

async function seedAccess(central, authority, state) {
  const coordinator = require('../../src/security/authorityCoordinator').createAuthorityCoordinator({ pool: authority, permitSecret: state.permitSecret });
  const catalogs = require('../../src/authorization/catalogs').createProductionCatalogs({ catalogVersion: 'f13' });
  const data = require('../../src/authorization/authorityDataRepository').createAuthorityDataRepository({ coordinator, catalogs,
    policyVersion, recentMfaRequirement: requirement });
  const client = await central.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code)
      VALUES($1,'C4G','C4G','c4g','UNSPECIFIED','ACTIVE','EUR','USER_OPTIONAL') ON CONFLICT(id) DO NOTHING`, [state.organizationId]);
    for (const [id, name, email, subject] of [[state.adminId, 'Administrador C4G', 'admin@c4g.local.invalid', state.identity.adminSubject],
      [state.managerId, 'Hugo', 'hugo@c4g.local.invalid', state.identity.managerSubject]]) {
      await client.query(`INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(id) DO NOTHING`, [id, name, email]);
      await client.query(`INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4)
        ON CONFLICT(issuer,subject) DO NOTHING`, [randomUUID(), id, state.identity.issuer, subject]);
      const bound = await client.query('SELECT global_user_id FROM public.auth_identity_ref WHERE issuer=$1 AND subject=$2', [state.identity.issuer, subject]);
      if (bound.rows[0]?.global_user_id !== id) throw Error('LOCAL_IDENTITY_BINDING_MISMATCH');
    }
    await client.query(`INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status)
      SELECT $1,$2,'C4G_ADMIN','ACTIVE' WHERE NOT EXISTS(SELECT 1 FROM public.platform_admin_assignment WHERE global_user_id=$2)`, [randomUUID(), state.adminId]);
    await client.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at)
      VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp()) ON CONFLICT(id) DO NOTHING`, [state.membershipId, state.managerId, state.organizationId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  const prior = await central.query('SELECT authorization_version,policy_version,grants,assurance_requirements FROM public.authority_f5_state WHERE membership_id=$1', [state.membershipId]);
  if (!prior.rowCount) await data.change({ organizationId: state.organizationId, membershipId: state.membershipId, expectedVersion: 0,
    grants: ['notification.read','organization_notice.manage','opportunity.read','opportunity.private.create','opportunity.private.update','opportunity.archive',
      'application.read','application.create','application.edit','application.transition',
      'organization_directory.read','organization_directory.edit','organizational_scope.read',
      'organizational_scope.create','organizational_scope.rename','organizational_scope.reparent'].map(permission => ({ permission,
        scope: { type: 'ORGANIZATION', id: state.organizationId, organizationId: state.organizationId } })), assuranceRequirements: requirement });
  else if (prior.rows[0].policy_version !== policyVersion) {
    if (prior.rows[0].policy_version !== 'c4g-assurance-v1') throw Error('LOCAL_AUTHORITY_POLICY_UNKNOWN');
    await data.change({ organizationId: state.organizationId, membershipId: state.membershipId,
      expectedVersion: Number(prior.rows[0].authorization_version), grants: prior.rows[0].grants, assuranceRequirements: requirement });
  } else if (Object.keys(requirement).some(key => JSON.stringify(prior.rows[0].assurance_requirements[key]) !== JSON.stringify(requirement[key]))) {
    throw Error('LOCAL_AUTHORITY_POLICY_DRIFT');
  }
  // Effective assurance is versioned in authority_f5_state. Do not mutate the
  // historical organization policy label or broaden the authority SQL protocol.
}
module.exports = { identityConfig, configureIdentity, seedAccess, requirement };
