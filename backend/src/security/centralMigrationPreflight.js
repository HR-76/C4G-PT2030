const { assertCentralMarker, validateAppliedMigrationLedger } = require("../../scripts/runCentralMigrations");
const { assertCentralSchema } = require("./centralSchemaManifest");
const { SUPPORTED_POSTGRES_MAJORS } = require('./postgresCatalogCompatibility');
const { manifest, registeredManifest, writerManifest, reconciliationManifest, prearchiveManifest, knownManifest, centralRuntimeReadManifest, centralImportManifest, billingPdfManifest, catalogReadManifest, receiptManifest, replayCapacityManifest, failureCapacityManifest } = require('./centralMigrationManifest');

const SUPPORTED_POSTGRES_MAJOR = 17;

async function assertSupportedPostgresMajor(client) {
  const result = await client.query("SELECT current_setting('server_version_num') AS server_version_num");
  const rawVersion = result.rows[0] && String(result.rows[0].server_version_num || "");
  if (!/^\d+$/.test(rawVersion)) throw new Error("PostgreSQL server version was not observable; preflight refused.");
  const major = Math.trunc(Number(rawVersion) / 10000);
  if (!SUPPORTED_POSTGRES_MAJORS.includes(major)) {
    throw new Error(`PostgreSQL major ${major} is not supported by the Central schema fingerprints; expected majors ${SUPPORTED_POSTGRES_MAJORS.join(', ')}.`);
  }
  return major;
}

async function preflightCentral(pool) {
  if (!pool || typeof pool.connect !== "function") throw new Error("Central database pool is unavailable.");
  const client = await pool.connect();
  let began = false;
  let released = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    began = true;
    const postgresMajor = await assertSupportedPostgresMajor(client);
    await assertCentralMarker(client);
    const ledger = await client.query(
      `SELECT version, checksum_sha256, irreversible
         FROM public.c4g_schema_migration
        ORDER BY version`
    );
    const records = validateAppliedMigrationLedger(ledger.rows, "preflight refused");
    if (records.size === 0) throw new Error("Central migration ledger is empty; preflight refused.");
    const currentVersion = ledger.rows.at(-1).version;
    // The package is atomic: intermediate schemas are known to its migrator,
    // but are not an admitted runtime state after an interrupted/manual install.
    if (!manifest.some(entry=>entry.version===currentVersion) && ![registeredManifest.at(-1).version,
      writerManifest.at(-1).version,reconciliationManifest.at(-1).version,prearchiveManifest.at(-1).version,catalogReadManifest.at(-1).version,centralImportManifest.at(-1).version,billingPdfManifest.at(-1).version,knownManifest.at(-1).version,centralRuntimeReadManifest.at(-1).version,receiptManifest.at(-1).version,replayCapacityManifest.at(-1).version,failureCapacityManifest.at(-1).version].includes(currentVersion)) {
      throw new Error('Central registered migration package is incomplete; preflight refused.');
    }
    const fingerprint = await assertCentralSchema(client, currentVersion);
    await client.query("COMMIT");
    began = false;
    return Object.freeze({
      postgresMajor, currentVersion,
      appliedVersions: Object.freeze(ledger.rows.map(row => row.version)),
      fingerprint
    });
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        released = true;
        try {
          client.release(rollbackError);
        } catch (releaseError) {
          throw new AggregateError(
            [error, rollbackError, releaseError],
            "Central preflight failed, rollback failed and the client could not be discarded.",
            { cause: error }
          );
        }
        throw new AggregateError(
          [error, rollbackError],
          "Central preflight failed and rollback failed; the client was discarded.",
          { cause: error }
        );
      }
    }
    throw error;
  } finally {
    if (!released) client.release();
  }
}

module.exports = { SUPPORTED_POSTGRES_MAJOR, assertSupportedPostgresMajor, preflightCentral };
