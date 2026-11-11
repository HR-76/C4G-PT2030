const { Pool } = require("pg");
const { databasePoolOptions } = require("./databaseConfig");

module.exports = new Pool({
  ...databasePoolOptions(process.env, "CENTRAL_DATABASE_URL", "CENTRAL_DB"),
  max: Number(process.env.CENTRAL_DB_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.CENTRAL_DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.CENTRAL_DB_CONNECTION_TIMEOUT_MS || 5000)
});
