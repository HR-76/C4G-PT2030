const { rollbackReleaseAndThrow } = require('./postgresTransaction');

function epochMillisecondsToDate(value, fieldName) {
  if (!Number.isFinite(value)) throw new TypeError(`${fieldName} must be a finite epoch in milliseconds.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${fieldName} must represent a valid date.`);
  return date;
}

function createPgSessionRegistry(pool, authorityCoordinator = null) {
  if (authorityCoordinator) pool = authorityCoordinator.pool;
  const registry = {
    async registerOidcTransaction({ sid, state, expiresAt }) {
      const expiresAtDate = epochMillisecondsToDate(expiresAt, "expiresAt");
      await pool.query(
        `INSERT INTO public.oidc_transaction (sid, state, expires_at)
         VALUES ($1, $2, $3)`,
        [sid, state, expiresAtDate]
      );
    },

    async consumeOidcTransaction({ sid, state, now }) {
      const nowDate = epochMillisecondsToDate(now, "now");
      const result = await pool.query(
        `UPDATE public.oidc_transaction
         SET consumed_at = $3
         WHERE sid = $1 AND state = $2 AND consumed_at IS NULL AND expires_at > $3
         RETURNING sid`,
        [sid, state, nowDate]
      );
      return result.rows.length === 1;
    },

    async bindSession({ sid, globalUserId, revocationVersion, expiresAt }) {
      const expiresAtDate = epochMillisecondsToDate(expiresAt, "expiresAt");
      await pool.query(
        `INSERT INTO public.application_session (sid, global_user_id, status, revocation_version, created_at, last_seen_at, expires_at)
         VALUES ($1, $2, 'ACTIVE', $3, NOW(), NOW(), $4)
         ON CONFLICT (sid) DO UPDATE SET
           global_user_id = EXCLUDED.global_user_id,
           status = 'ACTIVE',
           revocation_version = EXCLUDED.revocation_version,
           last_seen_at = NOW(),
           expires_at = EXCLUDED.expires_at`,
        [sid, globalUserId, revocationVersion, expiresAtDate]
      );
    },

    async rotateSession({ previousSid, sid, globalUserId, revocationVersion, expiresAt, organizationContext = null }) {
      const expiresAtDate = epochMillisecondsToDate(expiresAt, "expiresAt");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (organizationContext) {
          const eligibility = await client.query(
            `SELECT om.id
             FROM public.organization_membership om
             INNER JOIN public.global_user gu ON gu.id = om.global_user_id
             INNER JOIN public.organization org ON org.id = om.organization_id
             WHERE om.id = $1 AND om.global_user_id = $2 AND om.organization_id = $3
               AND om.membership_version = $4 AND gu.status = 'ACTIVE' AND org.status = 'ACTIVE'
               AND om.status = 'ACTIVE' AND om.valid_from <= NOW()
               AND (om.valid_until IS NULL OR om.valid_until > NOW())
             FOR SHARE OF om, gu, org`,
            [organizationContext.membershipId, globalUserId, organizationContext.organizationId,
              organizationContext.membershipVersion]
          );
          if (eligibility.rows.length !== 1) throw new Error("Organization context is no longer eligible.");
        }
        await client.query(
          `INSERT INTO public.application_session (
             sid, global_user_id, status, revocation_version, created_at, last_seen_at, expires_at,
             selected_organization_id, selected_membership_id, selected_membership_version
           )
           VALUES ($1, $2, 'ACTIVE', $3, NOW(), NOW(), $4, $5, $6, $7)
           ON CONFLICT (sid) DO UPDATE SET
             global_user_id = EXCLUDED.global_user_id,
             status = 'ACTIVE',
             revocation_version = EXCLUDED.revocation_version,
             last_seen_at = NOW(),
             expires_at = EXCLUDED.expires_at,
             selected_organization_id = EXCLUDED.selected_organization_id,
             selected_membership_id = EXCLUDED.selected_membership_id,
             selected_membership_version = EXCLUDED.selected_membership_version,
             revoked_at = NULL,
             revocation_reason = NULL`,
          [sid, globalUserId, revocationVersion, expiresAtDate,
            organizationContext && organizationContext.organizationId,
            organizationContext && organizationContext.membershipId,
            organizationContext && organizationContext.membershipVersion]
        );
        if (previousSid && previousSid !== sid) {
          await client.query(
            `UPDATE public.application_session
             SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = 'SESSION_ROTATED'
             WHERE sid = $1 AND status = 'ACTIVE'`,
            [previousSid]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await rollbackReleaseAndThrow(client, error, "Session rotation and transaction cleanup failed.");
      }
      client.release();
    },

    async validateSession({ sid, globalUserId, revocationVersion, now }) {
      const nowDate = epochMillisecondsToDate(now, "now");
      const result = await pool.query(
        `UPDATE public.application_session AS aps
         SET last_seen_at = $4
         FROM public.global_user AS gu
         WHERE aps.sid = $1
           AND aps.global_user_id = $2
           AND gu.id = aps.global_user_id
           AND aps.status = 'ACTIVE'
           AND gu.status = 'ACTIVE'
           AND aps.revocation_version = $3
           AND gu.session_revocation_version = $3
           AND aps.expires_at > $4
         RETURNING aps.sid`,
        [sid, globalUserId, revocationVersion, nowDate]
      );
      return result.rows.length === 1;
    },

    async resolveOrganizationContext({ sid, globalUserId, now }) {
      const nowDate = epochMillisecondsToDate(now, "now");
      const result = await pool.query(
        `SELECT aps.selected_organization_id, aps.selected_membership_id, aps.selected_membership_version,
                om.membership_version, om.base_role_code, om.status AS membership_status,
                om.valid_from, om.valid_until, org.status AS organization_status,
                org.display_name, org.slug, gu.status AS user_status, LEAST(aps.expires_at,ss.expire) AS session_expires_at
         FROM public.application_session aps
         INNER JOIN public.global_user gu ON gu.id = aps.global_user_id
         LEFT JOIN public.application_session_store ss ON ss.sid=aps.sid
         LEFT JOIN public.organization_membership om
           ON om.id = aps.selected_membership_id
          AND om.global_user_id = aps.global_user_id
          AND om.organization_id = aps.selected_organization_id
         LEFT JOIN public.organization org ON org.id = aps.selected_organization_id
         WHERE aps.sid = $1 AND aps.global_user_id = $2 AND aps.status = 'ACTIVE'`,
        [sid, globalUserId]
      );
      if (result.rows.length !== 1) return { state: "INVALID" };
      const row = result.rows[0];
      if (!row.selected_organization_id) return { state: "NONE" };
      const eligible = row.user_status === "ACTIVE" && row.organization_status === "ACTIVE"
        && row.membership_status === "ACTIVE"
        && Number(row.selected_membership_version) === Number(row.membership_version)
        && new Date(row.valid_from) <= nowDate
        && (row.valid_until === null || new Date(row.valid_until) > nowDate);
      if (!eligible) return { state: "INVALID" };
      return {
        state: "VALID",
        expiresAt:new Date(row.session_expires_at).getTime(),
        context: Object.freeze({
          organizationId: row.selected_organization_id,
          membershipId: row.selected_membership_id,
          membershipVersion: Number(row.membership_version),
          baseRoleCode: row.base_role_code,
          organization: Object.freeze({ id: row.selected_organization_id, displayName: row.display_name, slug: row.slug })
        })
      };
    },

    async revokeSession(sid, reason = "LOCAL_LOGOUT") {
      await pool.query(
        `UPDATE public.application_session
         SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = $2
         WHERE sid = $1 AND status = 'ACTIVE'`,
        [sid, reason]
      );
    },

    async expireSession(sid) {
      await pool.query(
        `UPDATE public.application_session
         SET status = 'EXPIRED'
         WHERE sid = $1 AND status = 'ACTIVE'`,
        [sid]
      );
    },

    async revokeUser(globalUserId, reason = "USER_REVOCATION") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const versionResult = await client.query(
          `UPDATE public.global_user
           SET session_revocation_version = session_revocation_version + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING session_revocation_version`,
          [globalUserId]
        );
        if (versionResult.rows.length !== 1) throw new Error("Global user not found for session revocation.");
        const sessions = await client.query(
          `UPDATE public.application_session
           SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = $2,
               revocation_version = $3
           WHERE global_user_id = $1 AND status = 'ACTIVE'
           RETURNING sid`,
          [globalUserId, reason, versionResult.rows[0].session_revocation_version]
        );
        const sessionIds = sessions.rows.map(row => row.sid);
        if (sessionIds.length > 0) {
          await client.query("DELETE FROM public.application_session_store WHERE sid = ANY($1::varchar[])", [sessionIds]);
        }
        await client.query("COMMIT");
        return { revokedSessionIds: sessionIds, revocationVersion: Number(versionResult.rows[0].session_revocation_version) };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async expireSessions(now = new Date()) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM public.oidc_transaction WHERE expires_at <= $1", [now]);
        const expired = await client.query(
          `UPDATE public.application_session
           SET status = 'EXPIRED'
           WHERE status = 'ACTIVE' AND expires_at <= $1
           RETURNING sid`,
          [now]
        );
        const sessionIds = expired.rows.map(row => row.sid);
        if (sessionIds.length > 0) {
          await client.query("DELETE FROM public.application_session_store WHERE sid = ANY($1::varchar[])", [sessionIds]);
        }
        await client.query("COMMIT");
        return sessionIds;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
  if (authorityCoordinator) {
    for (const method of ['bindSession','rotateSession','revokeSession','expireSession','revokeUser','expireSessions']) {
      const original = registry[method];
      registry[method] = async (...args) => {
        let keys;
        if (method==='revokeUser') {
          const sessions = await pool.query('SELECT sid FROM public.application_session WHERE global_user_id=$1', [args[0]]);
          keys = [`SUBJECT:${args[0]}`, ...sessions.rows.map(row => authorityCoordinator.sessionKey(row.sid))];
        } else if (method==='expireSessions') {
          const sessions = await pool.query('SELECT sid FROM public.application_session WHERE expires_at<=$1', [args[0]||new Date()]);
          keys = ['POLICY', ...sessions.rows.map(row => authorityCoordinator.sessionKey(row.sid))];
        } else if (method==='rotateSession' || method==='bindSession') {
          keys = [authorityCoordinator.sessionKey(args[0].sid),`SUBJECT:${args[0].globalUserId}`];
          if (args[0].previousSid) keys.push(authorityCoordinator.sessionKey(args[0].previousSid));
        } else keys = [authorityCoordinator.sessionKey(args[0])];
        return authorityCoordinator.write(keys, () => original(...args));
      };
    }
  }
  return registry;
}

class InMemorySessionRegistry {
  constructor() {
    this.sessions = new Map();
    this.userVersions = new Map();
    this.oidcTransactions = new Map();
  }

  async registerOidcTransaction({ sid, state, expiresAt }) {
    const key = `${sid}:${state}`;
    if (this.oidcTransactions.has(key)) throw new Error("OIDC transaction already exists.");
    this.oidcTransactions.set(key, { expiresAt, consumed: false });
  }

  async consumeOidcTransaction({ sid, state, now }) {
    const record = this.oidcTransactions.get(`${sid}:${state}`);
    if (!record || record.consumed || record.expiresAt <= now) return false;
    record.consumed = true;
    return true;
  }

  async bindSession({ sid, globalUserId, revocationVersion = 1, expiresAt }) {
    const currentVersion = this.userVersions.get(globalUserId) || revocationVersion;
    this.userVersions.set(globalUserId, currentVersion);
    this.sessions.set(sid, { globalUserId, status: "ACTIVE", revocationVersion: currentVersion, expiresAt });
  }

  async rotateSession({ previousSid, sid, globalUserId, revocationVersion = 1, expiresAt, organizationContext = null }) {
    await this.bindSession({ sid, globalUserId, revocationVersion, expiresAt });
    this.sessions.get(sid).organizationContext = organizationContext;
    if (previousSid && previousSid !== sid) await this.revokeSession(previousSid);
  }

  async validateSession({ sid, globalUserId, revocationVersion, now }) {
    const record = this.sessions.get(sid);
    return Boolean(record && record.globalUserId === globalUserId && record.status === "ACTIVE"
      && record.revocationVersion === revocationVersion
      && this.userVersions.get(globalUserId) === revocationVersion
      && record.expiresAt > now);
  }

  async resolveOrganizationContext({ sid, globalUserId }) {
    const record = this.sessions.get(sid);
    if (!record || record.globalUserId !== globalUserId || record.status !== "ACTIVE") return { state: "INVALID" };
    return record.organizationContext ? { state: "VALID", context: record.organizationContext } : { state: "NONE" };
  }

  async revokeSession(sid) {
    const record = this.sessions.get(sid);
    if (record) record.status = "REVOKED";
  }

  async expireSession(sid) {
    const record = this.sessions.get(sid);
    if (record && record.status === "ACTIVE") record.status = "EXPIRED";
  }

  async revokeUser(globalUserId) {
    const version = (this.userVersions.get(globalUserId) || 1) + 1;
    this.userVersions.set(globalUserId, version);
    const revokedSessionIds = [];
    for (const [sid, record] of this.sessions) {
      if (record.globalUserId === globalUserId && record.status === "ACTIVE") {
        record.status = "REVOKED";
        record.revocationVersion = version;
        revokedSessionIds.push(sid);
      }
    }
    return { revokedSessionIds, revocationVersion: version };
  }

  async expireSessions(now) {
    for (const [key, transaction] of this.oidcTransactions) {
      if (transaction.expiresAt <= now) this.oidcTransactions.delete(key);
    }
    const expired = [];
    for (const [sid, record] of this.sessions) {
      if (record.status === "ACTIVE" && record.expiresAt <= now) {
        record.status = "EXPIRED";
        expired.push(sid);
      }
    }
    return expired;
  }
}

module.exports = { createPgSessionRegistry, InMemorySessionRegistry };
