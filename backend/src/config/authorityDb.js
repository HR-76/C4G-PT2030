'use strict';
const { Pool } = require('pg');
const { databasePoolOptions } = require('./databaseConfig');
const { guardPool, runtimePoolTimeouts } = require('./poolResilience');
// Separate credentials and pool: never used by identity lookup, jobs or catalog.
module.exports = guardPool(new Pool({ ...databasePoolOptions(process.env,'AUTHORITY_DATABASE_URL','AUTHORITY_DB'),
  max:Number(process.env.AUTHORITY_DB_POOL_MAX||8),connectionTimeoutMillis:5000,idleTimeoutMillis:30000,
  ...runtimePoolTimeouts(process.env,'AUTHORITY_DB') }),'authority');
