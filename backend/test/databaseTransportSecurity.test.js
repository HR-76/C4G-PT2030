'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databasePoolOptions } = require('../src/config/databaseConfig');

const url = (host, query = '') => `postgresql://synthetic_user:synthetic@${host}:5432/synthetic${query}`;
const options = (env) => databasePoolOptions(env, 'CENTRAL_DATABASE_URL', 'CENTRAL_DB');

test('production refuses remote PostgreSQL URLs without verified TLS', () => {
  for (const query of ['', '?sslmode=disable', '?sslmode=prefer', '?sslmode=no-verify', '?sslmode=allow',
    '?sslmode=require&uselibpqcompat=true', '?sslmode=verify-ca&uselibpqcompat=true']) {
    assert.throws(() => options({ NODE_ENV: 'production', CENTRAL_DATABASE_URL: url('db.example.test', query) }),
      /CENTRAL_DATABASE_URL must use verified TLS in production/);
  }
});

test('production accepts verified TLS and loopback URLs', () => {
  for (const query of ['?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full',
    '?sslmode=verify-full&uselibpqcompat=true']) {
    const value = url('db.example.test', query);
    assert.deepEqual(options({ NODE_ENV: 'production', CENTRAL_DATABASE_URL: value }), { connectionString: value });
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.deepEqual(options({ NODE_ENV: 'production', CENTRAL_DATABASE_URL: url(host) }), { connectionString: url(host) });
  }
});

test('development keeps accepting URLs without TLS parameters', () => {
  const value = url('db.example.test');
  assert.deepEqual(options({ NODE_ENV: 'development', CENTRAL_DATABASE_URL: value }), { connectionString: value });
});

test('discrete production settings enable verified TLS for remote hosts only', () => {
  const env = host => ({ NODE_ENV: 'production', CENTRAL_DB_HOST: host, CENTRAL_DB_PORT: '5432',
    CENTRAL_DB_NAME: 'synthetic', CENTRAL_DB_USER: 'synthetic_user', CENTRAL_DB_PASSWORD: 'synthetic' });
  assert.deepEqual(options(env('db.example.test')).ssl, { rejectUnauthorized: true });
  assert.equal('ssl' in options(env('127.0.0.1')), false);
  assert.equal('ssl' in options({ ...env('db.example.test'), NODE_ENV: 'development' }), false);
});
