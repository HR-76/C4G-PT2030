const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { main } = require("../scripts/preflightCentral");
const {
  SUPPORTED_POSTGRES_MAJOR, assertSupportedPostgresMajor, preflightCentral
} = require("../src/security/centralMigrationPreflight");
const { manifest, registeredManifest, knownManifest, allKnownMigrations, receiptManifest, migrationSql } = require("../src/security/centralMigrationManifest");
const {
  EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION, schemaFingerprintsForManifest
} = require("../src/security/centralSchemaManifest");

test("Central preflight has a fingerprint for every supported ledger state", () => {
  assert.deepEqual(Object.keys(EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION), allKnownMigrations.filter(entry => entry.runtimeAdmissible!==false).map(entry => entry.version));
  for (const fingerprint of Object.values(EXPECTED_CENTRAL_SCHEMA_SHA256_BY_VERSION)) {
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
  }
});

test("Central F12 receipt ledger accepts its baseline and refuses a mixed migration branch", () => {
  const { validateAppliedMigrationLedger } = require('../scripts/runCentralMigrations');
  const row = entry => ({ version: entry.version, checksum_sha256: migrationSql(entry.version, 'up').checksum,
    irreversible: entry.irreversible });
  const rows = receiptManifest.map(row);
  assert.ok(validateAppliedMigrationLedger(rows).has(receiptManifest.at(-1).version));
  assert.throws(() => validateAppliedMigrationLedger([...rows, row(knownManifest[manifest.length])]), /Unknown applied migration/);
});

test("Central schema fingerprints reject a manifested migration without a fingerprint", () => {
  assert.throws(
    () => schemaFingerprintsForManifest([...manifest, { version: "003_synthetic_missing", irreversible: false }]),
    /003_synthetic_missing has no valid schema fingerprint/
  );
});

test("Central schema fingerprints reject duplicate versions and fingerprints before building the map", () => {
  const fingerprintA = "a".repeat(64);
  const fingerprintB = "b".repeat(64);
  assert.throws(
    () => schemaFingerprintsForManifest([
      { version: "000_synthetic", schemaFingerprint: fingerprintA },
      { version: "000_synthetic", schemaFingerprint: fingerprintB }
    ]),
    /Duplicate central migration version 000_synthetic/
  );
  assert.throws(
    () => schemaFingerprintsForManifest([
      { version: "000_synthetic", schemaFingerprint: fingerprintA },
      { version: "000_synthetic", schemaFingerprint: fingerprintA }
    ]),
    /Duplicate central migration version 000_synthetic/
  );
  assert.throws(
    () => schemaFingerprintsForManifest([
      { version: "000_synthetic", schemaFingerprint: fingerprintA },
      { version: "001_synthetic", schemaFingerprint: fingerprintA }
    ]),
    /Duplicate central schema fingerprint assigned to multiple migration versions/
  );
  assert.deepEqual(schemaFingerprintsForManifest([
    { version: "000_synthetic", schemaFingerprint: fingerprintA },
    { version: "001_synthetic", schemaFingerprint: fingerprintB }
  ]), { "000_synthetic": fingerprintA, "001_synthetic": fingerprintB });
});

test("Central preflight accepts PostgreSQL 17/18 and rejects unverified majors", async () => {
  assert.equal(SUPPORTED_POSTGRES_MAJOR, 17);
  assert.equal(await assertSupportedPostgresMajor({
    query: async () => ({ rows: [{ server_version_num: "170009" }] })
  }), 17);
  await assert.rejects(
    () => assertSupportedPostgresMajor({ query: async () => ({ rows: [{ server_version_num: "160010" }] }) }),
    /PostgreSQL major 16 is not supported.*expected majors 17, 18/
  );
  assert.equal(await assertSupportedPostgresMajor({ query: async () => ({ rows: [{ server_version_num: '180003' }] }) }), 18);
  await assert.rejects(() => assertSupportedPostgresMajor({ query: async () => ({ rows: [{ server_version_num: '190000' }] }) }), /not supported/);
});

test("Central preflight rejects malformed PostgreSQL version responses before fingerprint comparison", async () => {
  const cases = [
    { rows: [] },
    { rows: [{ server_version_num: null }] },
    { rows: [{ server_version_num: "not-numeric" }] },
    { rows: [{ server_version_num: "17" }] }
  ];
  for (const response of cases) {
    const queries = [];
    const output = [];
    const client = {
      async query(sql) {
        queries.push(sql);
        if (sql === "BEGIN TRANSACTION READ ONLY") return { rows: [] };
        if (sql.includes("server_version_num")) return response;
        if (sql === "ROLLBACK") return { rows: [] };
        throw new Error("Fingerprint comparison must not start for an invalid PostgreSQL version response.");
      },
      release() {}
    };
    await assert.rejects(
      () => main({
        loadPool: () => ({ connect: async () => client, end: async () => {} }),
        output: message => output.push(message)
      }),
      /PostgreSQL (?:server version was not observable|major 0 is not supported)/
    );
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.equal(queries.some(sql => sql.includes("pg_catalog")), false);
    assert.deepEqual(output, []);
  }

  const cliPath = path.resolve(__dirname, "../scripts/preflightCentral.js");
  const child = spawnSync(process.execPath, ["-e", `
    const { main } = require(${JSON.stringify(cliPath)});
    const client = {
      query: async sql => {
        if (sql === "BEGIN TRANSACTION READ ONLY" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("server_version_num")) return { rows: [{ server_version_num: "not-numeric" }] };
        throw new Error("fingerprint comparison started");
      },
      release: () => {}
    };
    main({ loadPool: () => ({ connect: async () => client, end: async () => {} }) })
      .then(() => console.log("Central preflight passed"))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  `], { encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /PostgreSQL server version was not observable; preflight refused/);
  assert.doesNotMatch(child.stdout, /Central preflight passed/);
});

test("Central preflight runs in a read-only transaction", async () => {
  const queries = [];
  const rows = manifest.slice(0, 1).map(entry => ({
    version: entry.version,
    checksum_sha256: migrationSql(entry.version, "up").checksum,
    irreversible: entry.irreversible
  }));
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "BEGIN TRANSACTION READ ONLY") return { rows: [] };
      if (sql.includes("server_version_num")) return { rows: [{ server_version_num: "170009" }] };
      if (sql.startsWith('SELECT CASE WHEN EXISTS') && sql.includes('AS snapshot')) return { rows: [{ snapshot: null }] };
      if (sql.includes('json_agg(')) return { rows: [{ tables: [], columns: [], constraints: [], indexes: [],
        triggers: [], triggerFunctions: [], authoritySequence: [] }] };
      if (sql.includes('FROM pg_sequence')) return { rows: [] };
      if (sql.includes('FROM pg_namespace n,LATERAL aclexplode(n.nspacl)')) return { rows: [] };
      if (sql.includes("to_regclass")) return { rows: [{ marker_exists: true }] };
      if (sql.includes("SELECT EXISTS") && sql.includes("c4g_database_identity")) return { rows: [{ matches: true }] };
      if (sql.includes("FROM public.c4g_schema_migration")) return { rows };
      if (sql.includes("FROM pg_catalog.pg_class")) return { rows: [] };
      if (sql.includes("FROM pg_catalog.pg_attribute")) return { rows: [] };
      if (sql.includes("FROM pg_catalog.pg_constraint")) return { rows: [] };
      if (sql.includes("FROM pg_catalog.pg_indexes")) return { rows: [] };
      if (sql.includes("FROM pg_catalog.pg_trigger")) return { rows: [] };
      if (sql.includes("FROM pg_catalog.pg_proc")) return { rows: [] };
      if (sql === "ROLLBACK") return { rows: [] };
      throw new Error(`Unexpected query in preflight test: ${sql}`);
    },
    release() {}
  };
  await assert.rejects(() => preflightCentral({ connect: async () => client }), /schema drift/);
  assert.equal(queries[0], "BEGIN TRANSACTION READ ONLY");
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(queries.some(sql => /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)), false);
});

test("Central preflight discards the client and aggregates validation and rollback failures", async () => {
  const validationError = new Error("synthetic validation failure");
  const rollbackError = new Error("synthetic rollback failure");
  const releases = [];
  const client = {
    async query(sql) {
      if (sql === "BEGIN TRANSACTION READ ONLY") return { rows: [] };
      if (sql.includes("server_version_num")) return { rows: [{ server_version_num: "170009" }] };
      if (sql.includes("to_regclass")) throw validationError;
      if (sql === "ROLLBACK") throw rollbackError;
      throw new Error(`Unexpected query: ${sql}`);
    },
    release(error) { releases.push(error); }
  };
  await assert.rejects(
    () => preflightCentral({ connect: async () => client }),
    error => error instanceof AggregateError
      && error.cause === validationError
      && error.errors.length === 2
      && error.errors[0] === validationError
      && error.errors[1] === rollbackError
  );
  assert.deepEqual(releases, [rollbackError]);
});

test("Central preflight preserves validation, rollback and client discard failures", async () => {
  const validationError = new Error("synthetic validation failure");
  const rollbackError = new Error("synthetic rollback failure");
  const releaseError = new Error("synthetic release failure");
  const releases = [];
  const client = {
    async query(sql) {
      if (sql === "BEGIN TRANSACTION READ ONLY") return { rows: [] };
      if (sql.includes("server_version_num")) return { rows: [{ server_version_num: "170009" }] };
      if (sql.includes("to_regclass")) throw validationError;
      if (sql === "ROLLBACK") throw rollbackError;
      throw new Error(`Unexpected query: ${sql}`);
    },
    release(error) {
      releases.push(error);
      throw releaseError;
    }
  };
  await assert.rejects(
    () => preflightCentral({ connect: async () => client }),
    error => error instanceof AggregateError
      && error.cause === validationError
      && error.errors.length === 3
      && error.errors[0] === validationError
      && error.errors[1] === rollbackError
      && error.errors[2] === releaseError
  );
  assert.deepEqual(releases, [rollbackError]);

  const cliPath = path.resolve(__dirname, "../scripts/preflightCentral.js");
  const child = spawnSync(process.execPath, ["-e", `
    const { main } = require(${JSON.stringify(cliPath)});
    const primary = new Error("synthetic validation failure");
    const rollback = new Error("synthetic rollback failure");
    const release = new Error("synthetic release failure");
    let releaseCount = 0;
    const client = {
      query: async sql => {
        if (sql === "BEGIN TRANSACTION READ ONLY") return { rows: [] };
        if (sql.includes("server_version_num")) return { rows: [{ server_version_num: "170009" }] };
        if (sql.includes("to_regclass")) throw primary;
        if (sql === "ROLLBACK") throw rollback;
        throw new Error("unexpected query");
      },
      release: error => { releaseCount++; if (error !== rollback) throw new Error("healthy release"); throw release; }
    };
    main({ loadPool: () => ({ connect: async () => client, end: async () => {} }) })
      .then(() => console.log("Central preflight passed"))
      .catch(error => {
        console.error(error.name + ": " + error.message + "; count=" + releaseCount + "; errors=" + error.errors.map(item => item.message).join("|"));
        process.exitCode = 1;
      });
  `], { encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /count=1; errors=synthetic validation failure\|synthetic rollback failure\|synthetic release failure/);
  assert.doesNotMatch(child.stdout, /Central preflight passed/);
});

test("Central preflight CLI exits non-zero and suppresses success after validation and rollback failures", () => {
  const cliPath = path.resolve(__dirname, "../scripts/preflightCentral.js");
  const child = spawnSync(process.execPath, ["-e", `
    const { main } = require(${JSON.stringify(cliPath)});
    const validationError = new Error("synthetic validation failure");
    const rollbackError = new Error("synthetic rollback failure");
    const client = {
      query: async sql => {
        if (sql === "BEGIN TRANSACTION READ ONLY") return { rows: [] };
        if (sql.includes("server_version_num")) return { rows: [{ server_version_num: "170009" }] };
        if (sql.includes("to_regclass")) throw validationError;
        if (sql === "ROLLBACK") throw rollbackError;
        throw new Error("unexpected query");
      },
      release: error => { if (error !== rollbackError) throw new Error("client was released as healthy"); }
    };
    main({ loadPool: () => ({ connect: async () => client, end: async () => {} }) })
      .then(() => console.log("Central preflight passed"))
      .catch(error => {
        console.error(error.name + ": " + error.message + "; errors=" + error.errors.map(item => item.message).join("|"));
        process.exitCode = 1;
      });
  `], { encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /AggregateError: Central preflight failed and rollback failed; the client was discarded/);
  assert.match(child.stderr, /synthetic validation failure\|synthetic rollback failure/);
  assert.doesNotMatch(child.stdout, /Central preflight passed/);
});

test("Central preflight CLI preserves nested rollback and pool cleanup failures", async () => {
  const validationError = new Error("synthetic validation failure");
  const rollbackError = new Error("synthetic rollback failure");
  const poolCleanupError = new Error("synthetic pool cleanup failure");
  const client = {
    async query(sql) {
      if (sql === "BEGIN TRANSACTION READ ONLY") return { rows: [] };
      if (sql.includes("server_version_num")) return { rows: [{ server_version_num: "170009" }] };
      if (sql.includes("to_regclass")) throw validationError;
      if (sql === "ROLLBACK") throw rollbackError;
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
  await assert.rejects(
    () => main({
      loadPool: () => ({ connect: async () => client, end: async () => { throw poolCleanupError; } }),
      output: () => { throw new Error("success must not be emitted"); }
    }),
    error => error instanceof AggregateError
      && error.errors.length === 2
      && error.errors[0] instanceof AggregateError
      && error.errors[0].errors[0] === validationError
      && error.errors[0].errors[1] === rollbackError
      && error.errors[1] === poolCleanupError
  );
});

test("Central preflight CLI aggregates connection cleanup failure and suppresses success", async () => {
  const output = [];
  const validationFailure = new Error("synthetic validation failure");
  const pool = {
    connect: async () => { throw validationFailure; },
    end: async () => { throw new Error("synthetic cleanup failure"); }
  };
  await assert.rejects(
    () => main({ loadPool: () => pool, output: message => output.push(message) }),
    error => error instanceof AggregateError && error.errors.includes(validationFailure) && error.errors.length === 2
  );
  assert.deepEqual(output, []);
});

test("Central preflight CLI reports pool cleanup failure after successful validation without false success", () => {
  const cliPath = path.resolve(__dirname, "../scripts/preflightCentral.js");
  const child = spawnSync(process.execPath, ["-e", `
    const { main } = require(${JSON.stringify(cliPath)});
    let endCount = 0;
    main({
      loadPool: () => ({ end: async () => { endCount++; throw new Error("synthetic pool cleanup failure"); } }),
      runPreflight: async () => ({ currentVersion: "002_f3_organization_memberships", appliedVersions: ["000", "001", "002"] })
    }).then(() => console.log("Central preflight passed"))
      .catch(error => { console.error(error.message + "; endCount=" + endCount); process.exitCode = 1; });
  `], { encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /synthetic pool cleanup failure; endCount=1/);
  assert.doesNotMatch(child.stdout, /Central preflight passed/);
});

test("Central preflight disposable gate exits non-zero and suppresses success when cleanup fails", () => {
  const child = spawnSync(process.execPath, ["-e", `
    async function finalizeGate({ admin, created, primaryError, drop }) {
      const cleanupErrors = [];
      for (const name of [...created].reverse()) {
        try { await drop(admin, name); } catch (error) { cleanupErrors.push(error); }
      }
      try { await admin.end(); } catch (error) { cleanupErrors.push(error); }
      if (primaryError || cleanupErrors.length) {
        throw new AggregateError(
          [...(primaryError ? [primaryError] : []), ...cleanupErrors],
          primaryError
            ? \`Central preflight gate failed\${cleanupErrors.length ? \` and cleanup reported \${cleanupErrors.length} error(s)\` : ""}.\`
            : \`Central preflight gate cleanup reported \${cleanupErrors.length} error(s).\`
        );
      }
    }
    finalizeGate({
      admin: { end: async () => {} },
      created: ["c4g_f3_preflight_synthetic_cleanup"],
      drop: async () => { throw new Error("synthetic cleanup failure"); }
    }).then(() => console.log("Central preflight disposable gate passed"))
      .catch(error => { console.error(error.name + ": " + error.message); process.exitCode = 1; });
  `], { encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /AggregateError: Central preflight gate cleanup reported 1 error\(s\)\./);
  assert.doesNotMatch(child.stdout, /disposable gate passed/);
});
