const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyCentralMigrations, applyCentralMigrationsWithManifest, manifest, migrationSql, resolveRollbackTarget, rollbackF2Sessions,
  validateAppliedMigrationLedger
} = require("../scripts/runCentralMigrations");
const {
  canonicalizeMigrationSql, checksumSql, migrationChecksumPolicy
} = require("../src/security/centralMigrationManifest");

test("central migration manifest is ordered and baseline rollback is impossible", async () => {
  assert.deepEqual(manifest.map(item => [item.version, item.irreversible]), [
    ["000_central_identity_baseline", true],
    ["001_f2_oidc_sessions", false],
    ["002_f3_organization_memberships", false],
    ["003_f4_tenant_directory", false],
    ["004_f9_async_execution", false],
    ["005_f7_append_only_audit", false],
    ["006_f12_opportunity_catalog", false],
    ["007_f9_execution_lineage", false],
    ["008_f44_tenant_workload_identity", false],
    ["009_authority_commit_guard", false],
    ["010_editorial_intention_lookup", false], ["011_criteria_intention_lookup", false], ["012_pq1_intention_lookup", false], ["013_pq1_effective_lookup", false], ["014_pq1_decision_lookup", false], ["015_funding_tenders_central", true], ["016_membership_access", false], ["017_funding_programmes", false], ["018_official_programme_sources", false], ["019_internal_access_profiles", false], ["020_platform_onboarding", true], ["021_platform_members", true], ["022_entity_admission", true]
    , ["023_entity_registration_draft", true], ["024_organization_registration", true], ["025_entity_admission_completion", true], ["026_platform_logs", true], ["027_platform_billing", true], ["028_catalog_identity_authority", true], ["029_catalog_reader", true], ["030_application_responsibles", true], ["031_tenant_directory_resolution", true], ["032_single_organization_membership", true], ["033_funding_coverage", true], ["034_funding_temporal_refresh", true], ["035_funding_source_resolution", true]
  ]);
  assert.throws(() => migrationSql("000_central_identity_baseline", "down"), /irreversible/);
  assert.doesNotThrow(() => migrationSql("001_f2_oidc_sessions", "down"));
  assert.equal(resolveRollbackTarget("002").version, "002_f3_organization_memberships");
  assert.throws(() => resolveRollbackTarget("000"), /irreversible/);
  assert.throws(() => resolveRollbackTarget("015"), /irreversible/);
  assert.throws(() => resolveRollbackTarget("031"), /irreversible/);
  assert.throws(() => resolveRollbackTarget("032"), /irreversible/);
  assert.throws(() => resolveRollbackTarget("unknown"), /allowlisted/);
  await assert.rejects(() => rollbackF2Sessions({}, "000_central_identity_baseline"), /Only rollback/);
  await assert.rejects(() => rollbackF2Sessions({}, "../../database/migrations_v23.sql"), /Only rollback/);
});

test("central migration SQL is transaction-controlled by the allowlisted runner", () => {
  const root = path.resolve(__dirname, "../database/central/migrations");
  for (const file of fs.readdirSync(root).filter(name => /\.(?:up|down)\.sql$/.test(name))) {
    const sql = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(sql, /^\s*BEGIN\s*;/im);
    assert.doesNotMatch(sql, /^\s*COMMIT\s*;/im);
  }
  const runner = fs.readFileSync(path.resolve(__dirname, "../scripts/runCentralMigrations.js"), "utf8");
  assert.match(runner, /pg_advisory_xact_lock/);
  assert.match(runner, /checksum_sha256/);
  assert.match(runner, /rollback refused/);
  assert.match(runner, /Only rollback of 001_f2_oidc_sessions is permitted/);
  assert.match(
    fs.readFileSync(path.resolve(__dirname, "../../.gitattributes"), "utf8"),
    /^\*\.sql text eol=lf$/m
  );
});

test("central migration checksums canonicalize only CRLF and preserve material changes", () => {
  const lf = "SELECT 1;\n-- synthetic comment\nSELECT 'two spaces  stay';\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  const canonical = migrationChecksumPolicy(lf, { acceptsHistoricalCrlfChecksum: true });
  const fromCrlf = migrationChecksumPolicy(crlf, { acceptsHistoricalCrlfChecksum: true });

  assert.equal(canonicalizeMigrationSql(crlf), lf);
  assert.equal(fromCrlf.sql, lf);
  assert.equal(fromCrlf.checksum, canonical.checksum);
  assert.deepEqual(fromCrlf.acceptedChecksums, canonical.acceptedChecksums);
  assert.equal(canonicalizeMigrationSql("SELECT 1;\rSELECT 2;"), "SELECT 1;\rSELECT 2;");

  for (const changed of [
    "SELECT  1;\n-- synthetic comment\nSELECT 'two spaces  stay';\n",
    "SELECT 1;\n-- changed comment\nSELECT 'two spaces  stay';\n",
    "SELECT 2;\n-- synthetic comment\nSELECT 'two spaces  stay';\n",
    "SELECT 1;\n-- synthetic comment\nSELECT 'two spaces stay';\n"
  ]) {
    assert.equal(canonical.acceptedChecksums.includes(checksumSql(changed)), false);
  }
});

test("published migrations accept derived LF and CRLF checksums without rewriting metadata", () => {
  for (const entry of manifest) {
    const migration = migrationSql(entry.version, "up");
    assert.equal(migration.sql.includes("\r\n"), false);
    assert.equal(migration.checksum, checksumSql(migration.sql));
    assert.deepEqual(
      migration.acceptedChecksums,
      entry.acceptsHistoricalCrlfChecksum
        ? [...new Set([migration.checksum, checksumSql(migration.sql.replace(/\n/g, "\r\n"))])]
        : [migration.checksum]
    );
    for (const checksum of migration.acceptedChecksums) {
      const row = { version: entry.version, checksum_sha256: checksum, irreversible: entry.irreversible };
      const predecessors = manifest.slice(0, manifest.indexOf(entry)).map(previous => ({
        version: previous.version,
        checksum_sha256: migrationSql(previous.version, "up").checksum,
        irreversible: previous.irreversible
      }));
      const before = structuredClone([...predecessors, row]);
      validateAppliedMigrationLedger([...predecessors, row]);
      assert.deepEqual([...predecessors, row], before);
    }
  }
});

test("migration 002 observed LF and CRLF hashes are narrowly equivalent", () => {
  const migration = migrationSql("002_f3_organization_memberships", "up");
  assert.equal(migration.checksum, "784ad8f042d2a93a61537b338c2f7634c8130dada71b31f9d1572181d71c3d44");
  assert.deepEqual(migration.acceptedChecksums, [
    "784ad8f042d2a93a61537b338c2f7634c8130dada71b31f9d1572181d71c3d44",
    "650b23bdc8be5791f15cb61078498f87bcef8ce075261c0fd3aa5dfabade6455"
  ]);
  assert.throws(() => validateAppliedMigrationLedger(manifest.map(entry => ({
    version: entry.version,
    checksum_sha256: entry.version === migration.entry.version
      ? checksumSql(`${migration.sql} `)
      : migrationSql(entry.version, "up").checksum,
    irreversible: entry.irreversible
  }))), /metadata differs for 002_f3_organization_memberships/);
});

test("new applications execute canonical SQL and record one checksum for LF or CRLF sources", async () => {
  const sourceLf = "CREATE TABLE synthetic_eol_test(id integer);\n";
  const executions = [];
  const inserted = [];
  const client = {
    async query(sql, parameters) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("to_regclass")) return { rows: [{ marker_exists: true }] };
      if (sql.includes("SELECT EXISTS") && sql.includes("c4g_database_identity")) return { rows: [{ matches: true }] };
      if (sql.includes("CREATE TABLE IF NOT EXISTS public.c4g_schema_migration")) return { rows: [] };
      if (sql.includes("FROM public.c4g_schema_migration")) return { rows: [] };
      if (sql.includes("INSERT INTO public.c4g_schema_migration")) {
        inserted.push(parameters);
        return { rows: [] };
      }
      executions.push(sql);
      return { rows: [] };
    },
    release() {}
  };
  const pool = { connect: async () => client };
  // This EOL test executes synthetic SQL, not an attested physical schema.
  // The correction's mandatory preflight is exercised separately against PG.
  const eolEntries = manifest.filter(entry => !entry.requiresPreflightVersion);

  for (const source of [sourceLf, sourceLf.replace(/\n/g, "\r\n")]) {
    executions.length = 0;
    inserted.length = 0;
    await applyCentralMigrationsWithManifest(pool, eolEntries, version => ({
        entry: manifest.find(item => item.version === version),
        ...migrationChecksumPolicy(source)
      }));
    assert.deepEqual(executions, eolEntries.map(() => sourceLf));
    assert.deepEqual(inserted.map(parameters => parameters[1]), eolEntries.map(() => checksumSql(sourceLf)));
  }
});

test("production migration entrypoint cannot receive an arbitrary manifest or loader", async () => {
  assert.equal(applyCentralMigrations.length, 1);
  const source = fs.readFileSync(path.resolve(__dirname, "../scripts/runCentralMigrations.js"), "utf8");
  assert.match(source, /applyCentralMigrationsWithManifest\(pool,manifest,migrationSql,\{ledgerEntries:knownManifest\}\)/);
  assert.doesNotMatch(source, /process\.env[^\n]*(?:manifest|migration)/i);
});

test("central migration up rejects an unknown ledger version before applying migrations", () => {
  const known = manifest.slice(0, 2).map(entry => ({
    version: entry.version,
    checksum_sha256: migrationSql(entry.version, "up").checksum,
    irreversible: entry.irreversible
  }));
  assert.throws(() => validateAppliedMigrationLedger([
    ...known,
    { version: "999_synthetic_unknown", checksum_sha256: "synthetic", irreversible: false }
  ]), /Unknown applied migration 999_synthetic_unknown; migration operation refused/);
});

test("central migration up rejects a known ledger sequence with a gap", () => {
  const rows = [manifest[0], manifest[2]].map(entry => ({
    version: entry.version,
    checksum_sha256: migrationSql(entry.version, "up").checksum,
    irreversible: entry.irreversible
  }));
  assert.throws(() => validateAppliedMigrationLedger(rows),
    /Applied migration sequence has a gap before 002_f3_organization_memberships; migration operation refused/);
});

test("disposable lifecycle never terminates a process selected only by port", () => {
  const integrationRoot = path.resolve(__dirname, "../../test/integration/f2");
  const down = fs.readFileSync(path.join(integrationRoot, "down.ps1"), "utf8");
  const lifecycle = fs.readFileSync(path.join(integrationRoot, "process-lifecycle.js"), "utf8");
  const compose = fs.readFileSync(path.join(integrationRoot, "compose.yaml"), "utf8");
  assert.doesNotMatch(down, /Get-NetTCPConnection[\s\S]*Stop-Process/i);
  assert.match(down, /Remove-F2SensitiveArtifacts[\s\S]*throw \(\$failures -join/);
  assert.match(down, /mkcert-rootCA\.pem/);
  assert.match(lifecycle, /validateMetadata\(name\)/);
  assert.match(lifecycle, /specificationHash/);
  assert.match(lifecycle, /listenerOwnedBy/);
  assert.match(lifecycle, /immutable process specification/);
  assert.match(lifecycle, /taskkill\.exe/);
  assert.match(lifecycle, /port remained occupied; no other process was terminated/);
  assert.doesNotMatch(compose, /database\/central\/migrations/);
});
