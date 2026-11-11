const { isAuthorityCoordinator } = require('./authorityCoordinator');
const queries = require('./identityQueries');
function createIdentityRepository(coordinator) {
  if (!isAuthorityCoordinator(coordinator)) throw new TypeError('Identity authority coordinator required.');
  return {
    async resolve(claims) {
      if (typeof claims?.iss !== 'string' || !claims.iss || typeof claims?.sub !== 'string' || !claims.sub) return null;
      return coordinator.withAuthority(async () => {
      const result = await coordinator.pool.query(queries.resolveIdentity, [claims.iss, claims.sub]);
      if (!Array.isArray(result?.rows) || result.rowCount !== result.rows.length || result.rows.length > 1) throw new Error('IDENTITY_RESULT_INVALID');
      const user = result.rows[0];
      if (!user) return null;
      if (typeof user.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user.id) || typeof user.display_name !== 'string' || typeof user.primary_email !== 'string' || !Number.isSafeInteger(Number(user.session_revocation_version)) || Number(user.session_revocation_version)<1) throw new Error('IDENTITY_RESULT_INVALID');
      const roles = await coordinator.pool.query(queries.loginRoles, [claims.iss, claims.sub, user.id]);
      if (!Array.isArray(roles?.rows) || roles.rowCount !== roles.rows.length || roles.rows.some(row => !['C4G_ADMIN', 'SUPPORT'].includes(row.role_code))) throw new Error('IDENTITY_ROLES_INVALID');
      return {
        id: user.id,
        name: user.display_name,
        email: user.primary_email,
        platformRoles: roles.rows.map(row => row.role_code),
        sessionRevocationVersion: Number(user.session_revocation_version)
      };
      });
    }
  };
}

module.exports = { createIdentityRepository };
