const { Pool } = require('pg');
const { auditPreflight } = require('../src/audit/preflight');
const { assertDisposableTarget } = require('../test/support/disposableTarget');

(async () => {
  const target = assertDisposableTarget(process.env.F7_RESTORE_DATABASE_URL, { exact: 'f7_synthetic_restore' });
  const pool = new Pool({ connectionString: target.toString() });
  try {
    const ready = await auditPreflight(pool);
    const evidence = (await pool.query(`SELECT
      (SELECT count(*) FROM audit.event) AS events,
      (SELECT count(*) FROM audit.checkpoint) AS checkpoints,
      (SELECT tableowner FROM pg_tables WHERE schemaname='audit' AND tablename='event') AS owner`)).rows[0];
    if (evidence.events !== '5' || evidence.checkpoints !== '1' || evidence.owner !== 'c4g_audit_owner') throw new Error('Restored audit evidence is incomplete.');
    console.log(JSON.stringify({ ready, evidence }));
  } finally { await pool.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
