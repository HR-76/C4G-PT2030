'use strict';
const { readRuntimeState } = require('../../scripts/start-local.cjs');
const { main: startDev, startupDiagnostic } = require('./startDev');

// Explicit source-free entry point for the habitual controlled catalog.
// Private stored source configuration is preserved, but never passed to startup.
function sourceFreeState(state) {
  if(state?.catalogRead?.mode!=='controlled'||state.catalogRead.firstAccess!=='organization-administrator')throw Error('CONTROLLED_CATALOG_START_REQUIRED');
  const result={...state};delete result.funding;delete result.opportunityEuWriter;
  return result;
}
async function main() {
  return startDev({ readState: () => sourceFreeState(readRuntimeState()) });
}
if (require.main === module) main().catch(error => {
  console.error(startupDiagnostic(error));
  process.exitCode = 1;
});
module.exports={sourceFreeState,main};
