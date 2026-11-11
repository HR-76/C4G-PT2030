const path = require("node:path");
const dotenv = require("dotenv");

function assertRuntimeEnvironment(env) {
  if (env.AUTH_MODE && env.AUTH_MODE !== 'oidc') throw new Error('AUTH_MODE must be oidc.');
}

function loadEnvironment({ env = process.env, backendRoot }) {
  dotenv.config({ path: path.join(backendRoot, ".env"), override: false });
  assertRuntimeEnvironment(env);
  return env;
}

module.exports = { assertRuntimeEnvironment, loadEnvironment };
