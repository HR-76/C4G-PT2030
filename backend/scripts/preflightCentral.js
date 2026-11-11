const { preflightCentral } = require("../src/security/centralMigrationPreflight");

async function main({
  loadPool = () => require("../src/config/centralDb"),
  runPreflight = preflightCentral,
  output = console.log
} = {}) {
  const pool = loadPool();
  let primaryError;
  let result;
  try {
    result = await runPreflight(pool);
  } catch (error) {
    primaryError = error;
  }

  let cleanupError;
  try { await pool.end(); } catch (error) { cleanupError = error; }
  if (primaryError || cleanupError) {
    if (primaryError && cleanupError) {
      throw new AggregateError([primaryError, cleanupError], "Central preflight failed and connection cleanup also failed.");
    }
    throw primaryError || cleanupError;
  }
  output(`Central preflight passed for ${result.currentVersion}; ${result.appliedVersions.length} migration(s) verified.`);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Central preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
