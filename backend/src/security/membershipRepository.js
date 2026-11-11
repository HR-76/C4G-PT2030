const { rollbackReleaseAndThrow } = require('./postgresTransaction');

function publicOrganization(row) {
  return Object.freeze({ id: row.organization_id, displayName: row.display_name, slug: row.slug });
}

function membershipContext(row) {
  return Object.freeze({
    organizationId: row.organization_id,
    membershipId: row.membership_id,
    membershipVersion: Number(row.membership_version),
    baseRoleCode: row.base_role_code,
    organization: publicOrganization(row)
  });
}

const ELIGIBLE_MEMBERSHIP = `
  gu.status = 'ACTIVE'
  AND org.status = 'ACTIVE'
  AND om.status = 'ACTIVE'
  AND om.valid_from <= $2
  AND (om.valid_until IS NULL OR om.valid_until > $2)`;

function createMembershipRepository(pool, authorityCoordinator = null) {
  if (authorityCoordinator) pool = authorityCoordinator.pool;
  const repository = {
    async listEligible(globalUserId, now) {
      const result = await pool.query(
        `SELECT om.id AS membership_id, om.organization_id, om.membership_version,
                om.base_role_code, org.display_name, org.slug
         FROM public.organization_membership om
         INNER JOIN public.global_user gu ON gu.id = om.global_user_id
         INNER JOIN public.organization org ON org.id = om.organization_id
         WHERE om.global_user_id = $1 AND ${ELIGIBLE_MEMBERSHIP}
         ORDER BY org.display_name ASC, org.id ASC`,
        [globalUserId, new Date(now)]
      );
      return result.rows.map(membershipContext);
    },

    async resolveEligible(globalUserId, organizationId, now) {
      const result = await pool.query(
        `SELECT om.id AS membership_id, om.organization_id, om.membership_version,
                om.base_role_code, org.display_name, org.slug
         FROM public.organization_membership om
         INNER JOIN public.global_user gu ON gu.id = om.global_user_id
         INNER JOIN public.organization org ON org.id = om.organization_id
         WHERE om.global_user_id = $1 AND om.organization_id = $3 AND ${ELIGIBLE_MEMBERSHIP}
         FOR SHARE OF gu, org, om`,
        [globalUserId, new Date(now), organizationId]
      );
      return result.rows.length === 1 ? membershipContext(result.rows[0]) : null;
    },

    async revalidateContext({ organizationId, membershipId, membershipVersion }, now) {
      if (typeof organizationId !== 'string' || typeof membershipId !== 'string'
          || !Number.isSafeInteger(membershipVersion) || membershipVersion <= 0) {
        throw new TypeError('Organization context is invalid.');
      }
      const result = await pool.query(
        `SELECT om.id AS membership_id, om.organization_id, om.membership_version,
                om.base_role_code, org.display_name, org.slug
         FROM public.organization_membership om
         INNER JOIN public.global_user gu ON gu.id = om.global_user_id
         INNER JOIN public.organization org ON org.id = om.organization_id
         WHERE om.id = $1 AND om.organization_id = $3 AND om.membership_version = $4
           AND ${ELIGIBLE_MEMBERSHIP}
         FOR SHARE OF gu, org, om`,
        [membershipId, new Date(now), organizationId, membershipVersion]
      );
      return result.rows.length === 1 ? membershipContext(result.rows[0]) : null;
    },

    async changeStatus({ membershipId, status, reason = null }) {
      if (!['SUSPENDED', 'REMOVED'].includes(status)) throw new TypeError('Membership status must be SUSPENDED or REMOVED.');
      const client = await pool.connect();
      let membership;
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE public.organization_membership
           SET status = $2,
               membership_version = membership_version + 1,
               status_reason = $3,
               suspended_at = CASE WHEN $2 = 'SUSPENDED' THEN NOW() ELSE suspended_at END,
               removed_at = CASE WHEN $2 = 'REMOVED' THEN NOW() ELSE removed_at END,
               updated_at = NOW()
           WHERE id = $1 AND status <> 'REMOVED'
           RETURNING id, global_user_id, organization_id, membership_version`,
          [membershipId, status, reason]
        );
        if (result.rows.length !== 1) throw new Error('Membership is not available for a status transition.');
        await client.query('COMMIT');
        membership = { ...result.rows[0], membershipVersion: Number(result.rows[0].membership_version) };
      } catch (error) {
        await rollbackReleaseAndThrow(client, error, 'Membership status change and transaction cleanup failed.');
      }
      client.release();
      return membership;
    }
  };
  if (authorityCoordinator) {
    const change = repository.changeStatus;
    repository.changeStatus = input => authorityCoordinator.write([`MEMBER:${input.membershipId}`], () => change(input));
  }
  return repository;
}

module.exports = { createMembershipRepository, membershipContext, publicOrganization };
