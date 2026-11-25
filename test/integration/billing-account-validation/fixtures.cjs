'use strict';
const {randomUUID}=require('node:crypto');
async function fixtures(pool) {
  const ids = {
    admin: randomUUID(), outsider: randomUUID(), orgAdminA: randomUUID(), contributorA: randomUUID(), orgAdminB: randomUUID(),
    orgA: randomUUID(), orgB: randomUUID(), inactiveOrg: randomUUID(),
  };
  const sessions = {};
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL session_replication_role='replica'");
    for (const key of ['admin', 'outsider', 'orgAdminA', 'contributorA', 'orgAdminB']) {
      await c.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic email test',$2,'ACTIVE')", [ids[key], ids[key] + '@example.invalid']);
    }
    for (const [key, status] of [['orgA', 'ACTIVE'], ['orgB', 'ACTIVE'], ['inactiveOrg', 'SUSPENDED']]) {
      await c.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,$2,$2,$3,'COMPANY',$4,'EUR','OPTIONAL')",
        [ids[key], 'Email test ' + key, 'email-test-' + key.toLowerCase(), status]);
    }
    await c.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')", [randomUUID(), ids.admin]);
    const session = async (key, user, membership, interval = '1 hour') => {
      sessions[key] = randomUUID();
      await c.query(`INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at,
        selected_organization_id,selected_membership_id,selected_membership_version)
        VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+$3::interval,$4,$5,$6)`,
        [sessions[key], user, interval, membership?.organization || null, membership?.id || null, membership ? 1 : null]);
    };
    const member = async (user, organization, role) => {
      const id = randomUUID();
      await c.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,$4,'ACTIVE',clock_timestamp())", [id, user, organization, role]);
      return { id, organization };
    };
    await session('admin', ids.admin);
    await session('outsider', ids.outsider);
    await session('expiredAdmin', ids.admin, null, '-1 hour');
    await session('orgAdminA', ids.orgAdminA, await member(ids.orgAdminA, ids.orgA, 'ORG_ADMIN'));
    await session('contributorA', ids.contributorA, await member(ids.contributorA, ids.orgA, 'CONTRIBUTOR'));
    await session('orgAdminB', ids.orgAdminB, await member(ids.orgAdminB, ids.orgB, 'ORG_ADMIN'));
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
  return { ids, sessions };
}


module.exports={fixtures};
