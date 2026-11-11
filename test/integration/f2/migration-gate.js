const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require(path.resolve(__dirname, "../../../backend/node_modules/pg"));
const { applyCentralMigrations, rollbackF2Sessions } = require("../../../backend/scripts/runCentralMigrations");
const { requiredCentralMigrations } = require("../../../backend/src/security/centralMigrationManifest");

function pool(prefix) {
  return new Pool({
    host: process.env[`${prefix}_HOST`], port: Number(process.env[`${prefix}_PORT`]),
    database: process.env[`${prefix}_NAME`], user: process.env[`${prefix}_USER`], password: process.env[`${prefix}_PASSWORD`]
  });
}

async function snapshotIdentity(database) {
  const result = await database.query(`SELECT jsonb_build_object(
    'ledger', (SELECT to_jsonb(m) FROM public.c4g_schema_migration m WHERE version='000_central_identity_baseline'),
    'users', (SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY id), '[]'::jsonb) FROM public.global_user u),
    'identities', (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY id), '[]'::jsonb) FROM public.auth_identity_ref i),
    'admins', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id), '[]'::jsonb) FROM public.platform_admin_assignment a)
  ) AS snapshot`);
  return result.rows[0].snapshot;
}

async function main() {
  const central = pool("CENTRAL_DB");
  const legacy = pool("DB");
  try {
    await applyCentralMigrations(central);
    const existing = await central.query("SELECT COUNT(*)::int AS count FROM public.global_user");
    if (existing.rows[0].count === 0) {
      await central.query(fs.readFileSync(path.join(__dirname, "central-synthetic.sql"), "utf8"));
    }
    const expected = requiredCentralMigrations();
    for (const version of ["000_central_identity_baseline", "001_f2_oidc_sessions"]) {
      const record = expected.find(item => item.version === version);
      await central.query(
        "UPDATE public.c4g_schema_migration SET checksum_sha256 = $2 WHERE version = $1",
        [version, "divergent-checksum"]
      );
      await assert.rejects(() => rollbackF2Sessions(central), /metadata differs/);
      await central.query(
        "UPDATE public.c4g_schema_migration SET checksum_sha256 = $2, irreversible = $3 WHERE version = $1",
        [version, record.checksum, record.irreversible]
      );
    }
    const before = await snapshotIdentity(central);
    await rollbackF2Sessions(central);
    for (const table of ["application_session", "oidc_transaction", "application_session_store"]) {
      const result = await central.query("SELECT to_regclass($1) AS relation", [`public.${table}`]);
      assert.equal(result.rows[0].relation, null);
    }
    assert.deepEqual(await snapshotIdentity(central), before);
    await assert.rejects(() => rollbackF2Sessions(central, "000_central_identity_baseline"), /Only rollback/);
    await applyCentralMigrations(central);
    await assert.rejects(() => applyCentralMigrations(legacy), /marker|CENTRAL/i);
    const legacyLedger = await legacy.query("SELECT to_regclass($1) AS relation", ["public.c4g_schema_migration"]);
    assert.equal(legacyLedger.rows[0].relation, null);
    console.log("Central migration forward/rollback gate passed.");
  } finally {
    await Promise.allSettled([central.end(), legacy.end()]);
  }
}

main().catch(error => { console.error(`Central migration gate failed: ${error.message}`); process.exitCode = 1; });
