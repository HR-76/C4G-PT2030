'use strict';
// Called only by the disposable-cluster gate, after installer replay assertions.
// This helper never selects an external target and never prints credentials.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('../../../backend/node_modules/pg');
const { createAuthorityCoordinator } = require('../../../backend/src/security/authorityCoordinator');
const { createIdentityRepository } = require('../../../backend/src/security/identityRepository');
const { createMembershipRepository } = require('../../../backend/src/security/membershipRepository');
const { createAuthorityDataRepository } = require('../../../backend/src/authorization/authorityDataRepository');
const { createProductionCatalogs } = require('../../../backend/src/authorization/catalogs');
const { grantsForProfile } = require('../../../backend/src/organizationDirectory/accessProfiles');
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../../backend/src/security/authConfig');
const { createRolePool } = require('../../../backend/src/security/productionCentralProfile');
const { createTenantDirectoryReader } = require('../../../backend/src/security/tenantDirectoryReader');

async function run({ central, tenant, config, credentials, connection = {}, check }) {
  const target = { host: config.target.host, port: config.target.port, ssl: config.target.ssl, ...connection,
    database: config.target.centralDatabase, max: 2 };
  const authority = new Pool({ ...target, user: 'c4g_authority_runtime', password: credentials.central.authority });
  const read = new Pool({ ...target, user: 'c4g_prod_api_read', password: credentials.central.read });
  const coordinator = createAuthorityCoordinator({ pool: authority, permitSecret: credentials.permitSecret });
  const policyVersion = 'c4g-user-mfa-v1';
  const assuranceRequirements = RECOGNIZED_ASSURANCE_POLICIES[policyVersion].policy['recent-auth'];
  const data = createAuthorityDataRepository({ coordinator, policyVersion, catalogs: createProductionCatalogs({ catalogVersion: 'f13' }), recentMfaRequirement: assuranceRequirements });
  const memberships = createMembershipRepository(authority, coordinator);
  const actor = { organizationId: config.organization.id, membershipId: config.administrator.membershipId, globalUserId: config.administrator.globalUserId };
  try {
    await check('real limited identity resolver recognizes only the bound C4G administrator', async () => {
      const identity = createIdentityRepository(coordinator);
      const resolved = await identity.resolve({ iss: config.administrator.issuer, sub: config.administrator.subject });
      assert.equal(resolved.id, config.administrator.globalUserId);
      assert.equal(resolved.name, config.administrator.name);
      assert.equal(resolved.email, config.administrator.email);
      assert.deepEqual(resolved.platformRoles, ['C4G_ADMIN']);
      assert.equal(await identity.resolve({ iss: config.administrator.issuer, sub: randomUUID() }), null);
      assert.equal(await identity.resolve({ iss: 'https://different.example.invalid/realms/untrusted', sub: config.administrator.subject }), null);
    });

    await check('real membership and authorization ports resolve exact ORG_ADMIN grants with optional MFA', async () => {
      assert.equal(config.administrator.organizationProfile, 'ORG_ADMIN');
      const eligible = await memberships.listEligible(actor.globalUserId, Date.now());
      assert.equal(eligible.length, 1);
      assert.equal(eligible[0].organizationId, actor.organizationId);
      assert.equal(eligible[0].membershipId, actor.membershipId);
      assert.equal(eligible[0].membershipVersion, 2);
      assert.equal(eligible[0].baseRoleCode, 'ORG_ADMIN');
      const state = await data.authorizationDataPort.load(actor);
      assert.equal(state.organizationId, actor.organizationId);
      assert.equal(state.profileCode, 'ORG_ADMIN');
      assert.equal(state.authorizationVersion, 1);
      assert.deepEqual(state.grants, grantsForProfile({ organizationId: actor.organizationId, profileCode: 'ORG_ADMIN' }));
      assert.ok(state.grants.every(grant => grant.scope.organizationId === actor.organizationId && grant.scope.id === actor.organizationId));
      const stored = (await central.query('SELECT policy_version,assurance_requirements FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2', [actor.organizationId, actor.membershipId])).rows[0];
      assert.equal(stored.policy_version, policyVersion);
      assert.deepEqual(stored.assurance_requirements, assuranceRequirements);
      assert.equal(stored.assurance_requirements.mfa, false);
    });

    await check('real bounded authority directory resolves the published tenant and named person projection', async () => {
      const directory = createTenantDirectoryReader({ coordinator, organizations: [actor.organizationId], workload: 'API' });
      const published = await directory.resolveSnapshotByOrganization(actor.organizationId, 'API');
      assert.equal(published.organizationId, actor.organizationId);
      assert.equal(published.tenantId, config.tenant.id);
      assert.equal(published.databaseGenerationId, config.tenant.generationId);
      assert.equal(published.databaseRef, config.target.tenantDatabase);
      assert.equal(published.credentialRef, config.tenant.credentialRef);
      assert.equal(published.observedSystemIdentifier, config.target.expectedSystemIdentifier);
      assert.equal(published.connectionState, 'AVAILABLE');
      assert.equal(published.provisioningStatus, 'READY');
      assert.equal(published.schema.compatibilityState, 'COMPATIBLE');
      assert.equal(published.schema.currentVersion, '041_account_identity_erasure');
      await assert.rejects(directory.resolveSnapshotByOrganization(randomUUID(), 'API'), /TENANT_DIRECTORY_SCOPE_DENIED/);
      await assert.rejects(directory.resolveSnapshotByOrganization(actor.organizationId, 'WORKER'), /TENANT_DIRECTORY_SCOPE_DENIED/);
      const projected = (await tenant.query('SELECT p.person_id,p.name,p.email,x.membership_id FROM organizational_scope.person p JOIN organizational_scope.person_profile x ON x.organization_id=p.organization_id AND x.person_id=p.person_id WHERE p.organization_id=$1', [actor.organizationId])).rows;
      assert.equal(projected.length, 1);
      assert.equal(projected[0].person_id, actor.membershipId);
      assert.equal(projected[0].membership_id, actor.membershipId);
      assert.equal(projected[0].name, config.administrator.name);
      assert.equal(projected[0].email, config.administrator.email);
    });

    await check('direct F5 DML is denied to both authority and production read logins', async () => {
      const statements = [
        "INSERT INTO public.authority_f5_state(organization_id,membership_id,authorization_version,policy_version,grants,assurance_requirements) SELECT $1::uuid,$2::uuid,1,'forbidden','[]'::jsonb,'{}'::jsonb WHERE false",
        'UPDATE public.authority_f5_state SET policy_version=policy_version WHERE organization_id=$1 AND membership_id=$2 AND false',
        'DELETE FROM public.authority_f5_state WHERE organization_id=$1 AND membership_id=$2 AND false'
      ];
      const readCapability = createRolePool(read, 'read');
      for (const sql of statements) {
        await assert.rejects(authority.query(sql, [actor.organizationId, actor.membershipId]), { code: '42501' });
        await assert.rejects(readCapability.query(sql, [actor.organizationId, actor.membershipId]), { code: '42501' });
      }
    });

    await check('bootstrap audit records the installation service without personal data or secrets', async () => {
      const events = (await central.query("SELECT event_code,event_data FROM audit.event WHERE event_data->>'source'='PRODUCTION_INSTALLER' ORDER BY event_code")).rows;
      assert.deepEqual(events.map(row => row.event_code), ['PLATFORM_ACCESS_CHANGED', 'PLATFORM_ADMINISTRATOR_ACTIVATED', 'PLATFORM_ONBOARDING_ADVANCED', 'PLATFORM_ORGANIZATION_CREATED', 'PLATFORM_USER_CREATED']);
      for (const { event_data: event } of events) {
        assert.equal(event.actor.type, 'SERVICE');
        assert.equal(event.actor.id, config.installationId);
        assert.equal(event.actor.serviceActorCode, 'PRODUCTION_INSTALLER');
        assert.equal(event.actor.membershipId, null);
        assert.equal(event.organizationId, null);
        assert.equal(event.tenantId, null);
        assert.deepEqual(event.payload, { detailCode: 'PRODUCTION_BOOTSTRAP' });
      }
      const serialized = JSON.stringify(events);
      for (const privateValue of [config.administrator.name, config.administrator.email, config.administrator.subject,
        ...Object.values(credentials.central), credentials.tenantApi, credentials.permitSecret]) assert.equal(serialized.includes(privateValue), false);
    });

    await check('C4G role gives the first administrator no implicit membership or F5 authority in a second organization', async () => {
      const other = { organizationId: randomUUID(), globalUserId: randomUUID(), membershipId: randomUUID() };
      const client = await central.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(43001306,1)');
        await client.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code,data_residency_code) VALUES($1,'Disposable second entity','Disposable second entity',$2,'OTHER','ACTIVE','EUR','USER_OPTIONAL','EU')", [other.organizationId, 'disposable-second-' + other.organizationId]);
        await client.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Disposable second administrator',$2,'ACTIVE')", [other.globalUserId, other.globalUserId + '@example.invalid']);
        await client.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())", [other.membershipId, other.globalUserId, other.organizationId]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      await data.change({ organizationId: other.organizationId, membershipId: other.membershipId, expectedVersion: 0,
        grants: grantsForProfile({ organizationId: other.organizationId, profileCode: 'ORG_ADMIN' }), assuranceRequirements });
      assert.equal(await memberships.resolveEligible(actor.globalUserId, other.organizationId, Date.now()), null);
      assert.equal((await memberships.resolveEligible(other.globalUserId, other.organizationId, Date.now())).membershipId, other.membershipId);
      assert.deepEqual((await memberships.listEligible(actor.globalUserId, Date.now())).map(row => row.organizationId), [actor.organizationId]);
      assert.equal(await data.authorizationDataPort.load({ ...actor, organizationId: other.organizationId }), null);
      assert.equal(await data.membershipPort.revalidate({ ...actor, organizationId: other.organizationId }), null);
      assert.equal(await data.authorizationDataPort.load({ ...other, organizationId: actor.organizationId }), null);
      const otherState = await data.authorizationDataPort.load(other);
      assert.ok(otherState.grants.length > 0);
      assert.ok(otherState.grants.every(grant => grant.scope.organizationId === other.organizationId));
    });
  } finally { await Promise.allSettled([authority.end(), read.end()]); }
}

module.exports = { run };
