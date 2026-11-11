'use strict';

const { createF12ReceiptRuntime } = require('../opportunities/f12ReceiptRuntime');

const verifyLogin = `SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
    AND r.rolcanlogin AND NOT r.rolinherit AND current_user = session_user
    AND EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
      WHERE m.member=r.oid AND parent.rolname='c4g_f12_guard_recovery'
        AND m.inherit_option AND NOT m.admin_option AND NOT m.set_option)
    AND (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid) = 1
    AND NOT has_table_privilege(current_user, 'f12_service_authority.service_grant', 'INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_table_privilege(current_user, 'f12_service_authority.commit_guard', 'INSERT,DELETE,TRUNCATE')
    AND has_column_privilege(current_user, 'f12_service_authority.commit_guard', 'state', 'UPDATE')
    AS admitted FROM pg_roles r WHERE r.rolname=session_user`;

function createF12ReceiptRecoveryService({ central, tenantRuntimeDependencies, onUnavailable = () => {},
  intervalMs = 15000, scheduler = { setTimeout, clearTimeout } }) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000) {
    throw new TypeError('F12 receipt recovery interval is invalid.');
  }
  const runtime = createF12ReceiptRuntime({ central, tenantRuntimeDependencies });
  let stopped = false, ready, timer, running, after = null;
  function schedule() {
    if (stopped) return;
    timer = scheduler.setTimeout(() => {
      timer = null;
      running = (async () => {
        try {
          const batch = await runtime.recoverPending({ after });
          after = batch.next;
          if (batch.results.some(result => result.state === 'UNAVAILABLE')) onUnavailable();
        } catch {
          onUnavailable();
        }
      })().finally(() => {
        running = null;
        schedule();
      });
      running.catch(() => {});
    }, intervalMs);
    timer?.unref?.();
  }
  return Object.freeze({
    ready() {
      if (stopped) throw new Error('F12_RECEIPT_RECOVERY_STOPPED');
      ready ||= (async () => {
        const { rows } = await central.query(verifyLogin);
        if (rows[0]?.admitted !== true) throw new Error('F12_RECEIPT_RECOVERY_LOGIN_REQUIRED');
        await central.query('SELECT transaction_id FROM f12_service_authority.commit_guard LIMIT 0');
        schedule();
      })().catch(error => { ready = null; throw error; });
      return ready;
    },
    async close() {
      stopped = true;
      if (timer != null) scheduler.clearTimeout(timer);
      await running;
    }
  });
}

module.exports = { createF12ReceiptRecoveryService };
