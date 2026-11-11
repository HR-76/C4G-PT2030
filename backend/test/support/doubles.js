function createControllableDouble(operationNames, configured = {}) {
  const calls = [];
  const double = { calls };
  for (const operationName of operationNames) {
    double[operationName] = async (...args) => {
      calls.push({ operation: operationName, args });
      const outcome = configured[operationName];
      if (outcome instanceof Error) throw outcome;
      return typeof outcome === "function" ? outcome(...args) : outcome;
    };
  }
  return double;
}

function createIdentityDouble(configured) { return createControllableDouble(["resolveIdentity"], configured); }
function createCentralDatabaseDouble(configured) { return createControllableDouble(["findMembership"], configured); }
function createTenantDouble(configured) { return createControllableDouble(["query"], configured); }
function createR2Double(configured) { return createControllableDouble(["putObject", "getObject"], configured); }
function createResendDouble(configured) { return createControllableDouble(["sendEmail"], configured); }
function createClockDouble(instant = "2030-01-15T12:00:00.000Z") {
  const calls = [];
  return { calls, now() { calls.push({ operation: "now", args: [] }); return new Date(instant); } };
}

module.exports = {
  createIdentityDouble, createCentralDatabaseDouble, createTenantDouble,
  createR2Double, createResendDouble, createClockDouble
};
