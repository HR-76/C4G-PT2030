'use strict';

const crypto = require('node:crypto');
const { requireTenantWorkload } = require('./tenantWorkload');

const REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

function canonicalBinding(fields) {
  const value = {
    credentialRef: fields.credentialRef,
    tenantId: fields.tenantId,
    workload: fields.workload,
    connectionVersion: fields.connectionVersion,
    database: fields.database,
    login: fields.login
  };
  if (!REF.test(value.credentialRef || '') || typeof value.tenantId !== 'string'
      || !Number.isSafeInteger(value.connectionVersion) || value.connectionVersion < 1
      || !IDENTIFIER.test(value.database || '') || !IDENTIFIER.test(value.login || '')) {
    throw new TypeError('Synthetic credential binding is invalid.');
  }
  requireTenantWorkload(value.workload);
  return JSON.stringify(value);
}

function bindingDigest(fields) {
  return crypto.createHash('sha256').update(canonicalBinding(fields)).digest('hex');
}

function tupleKey(fields) {
  if (!REF.test(fields?.credentialRef || '') || typeof fields?.tenantId !== 'string'
      || !Number.isSafeInteger(fields?.connectionVersion) || fields.connectionVersion < 1) {
    throw new TypeError('Synthetic credential tuple is invalid.');
  }
  requireTenantWorkload(fields.workload);
  return JSON.stringify({credentialRef:fields.credentialRef,tenantId:fields.tenantId,workload:fields.workload,connectionVersion:fields.connectionVersion});
}

function createLocalTenantCredentialAdapter({ entries, connect }) {
  if (!Array.isArray(entries) || !entries.length || typeof connect !== 'function') {
    throw new TypeError('Local credential adapter configuration is invalid.');
  }
  const byTuple = new Map();
  const refOwners = new Map();
  for (const entry of entries) {
    const key = tupleKey(entry);
    if (byTuple.has(key)) throw new TypeError('Synthetic credential tuple is duplicated.');
    const owner = `${entry.tenantId}:${entry.workload}`;
    if (refOwners.has(entry.credentialRef) && refOwners.get(entry.credentialRef) !== owner) {
      throw new TypeError('Synthetic credential reference is shared.');
    }
    refOwners.set(entry.credentialRef, owner);
    byTuple.set(key, Object.freeze({ ...entry, bindingDigest: bindingDigest(entry) }));
  }
  return Object.freeze({
    async resolve(request) {
      const match = byTuple.get(tupleKey(request));
      if (!match) throw new Error('LOCAL_CREDENTIAL_NOT_FOUND');
      const candidateConnection = await connect(Object.freeze({
        database: match.database, login: match.login, credentialRef: match.credentialRef
      }));
      if (!candidateConnection || typeof candidateConnection.query !== 'function'
          || typeof candidateConnection.end !== 'function') {
        throw new Error('LOCAL_CREDENTIAL_CONNECTION_INVALID');
      }
      return Object.freeze({
        material: Object.freeze({
          candidateConnection,
          openRuntimePool: () => connect(Object.freeze({
            database: match.database, login: match.login, credentialRef: match.credentialRef
          })),
          resolution: Object.freeze({
            credentialRef: match.credentialRef, tenantId: match.tenantId, workload: match.workload,
            connectionVersion: match.connectionVersion, database: match.database, login: match.login
          })
        }),
        async dispose() { await candidateConnection.end(); }
      });
    }
  });
}

module.exports = { bindingDigest, canonicalBinding, createLocalTenantCredentialAdapter };
