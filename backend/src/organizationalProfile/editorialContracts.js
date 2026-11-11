'use strict';

const { canonicalClone } = require('./canonicalization');
const { OrganizationalProfileContractError } = require('./errors');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const DEFINITIONS = Object.freeze({
  submit: ['draftId', 'expectedRevision', 'idempotencyKey'],
  approve: ['candidateId', 'expectedCandidateDigest', 'idempotencyKey'],
  publish: ['versionId', 'expectedVersionDigest', 'idempotencyKey'],
  readCandidate: ['candidateId'],
  readVersion: ['versionId']
});
function validate(method, raw) {
  let value;
  try { value = canonicalClone(raw); } catch { throw new OrganizationalProfileContractError('F13_INVALID_INPUT'); }
  const keys = DEFINITIONS[method];
  const fail = () => { throw new OrganizationalProfileContractError('F13_INVALID_INPUT'); };
  if (!keys || !value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
  for (const key of keys) {
    if (key === 'expectedRevision') {
      if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] >= Number.MAX_SAFE_INTEGER) fail();
    } else if (key.endsWith('Digest')) {
      if (typeof value[key] !== 'string' || !HASH.test(value[key])) fail();
    } else if (typeof value[key] !== 'string' || !UUID.test(value[key])) fail();
  }
  return value;
}
module.exports = Object.freeze(Object.fromEntries(Object.keys(DEFINITIONS).map(method => [method, raw => validate(method, raw)])));
