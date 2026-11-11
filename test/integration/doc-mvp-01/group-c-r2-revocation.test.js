'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BASELINE, EXPIRY_MARGIN_MS, PROOF, REVOCATION_BYTES, REVOCATION_LIMITS, REVOCATION_PLAN,
  assertPlanFits, expiryDenial, requireRevokedAuthority } = require('./group-c-r2-revocation');

const tests = [];
const test = (name, callback) => tests.push({ name, callback });

test('resumes the exact closed journal baseline without resetting consumed counters', () => {
  assert.equal(PROOF, 'C4G_DOC_MVP01_R2_REVOCATION_V1');
  assert.equal(BASELINE.sequence, 601);
  assert.deepEqual(BASELINE.budget, { functionalRequests: 83, cleanupRequests: 28, applicationBytes: 58721562,
    objectIntentions: 11, completedObjects: 10, multipartIntentions: 3, unresolvedMultipart: 0 });
});

test('budgets one clean object and no repeated recovery, multipart or scanner-failure scenarios', () => {
  assert.deepEqual(REVOCATION_PLAN, { functionalRequests: 18, cleanupRequests: 3,
    applicationBytes: REVOCATION_BYTES.length * 4, objectIntentions: 1, completedObjects: 1,
    multipartIntentions: 0, unresolvedMultipart: 0 });
  assert.deepEqual(assertPlanFits(), { functionalRequests: 101, cleanupRequests: 31, totalRequests: 132,
    applicationBytes: BASELINE.budget.applicationBytes + REVOCATION_BYTES.length * 4,
    objectIntentions: 12, completedObjects: 11, multipartIntentions: 3, unresolvedMultipart: 0 });
  assert.equal(REVOCATION_LIMITS.functionalRequests + REVOCATION_LIMITS.cleanupRequests, 133);
});

test('preserves cleanup reserve and rejects any smaller exhausted cardinality', () => {
  assert.equal(REVOCATION_LIMITS.cleanupRequests - (BASELINE.budget.cleanupRequests + REVOCATION_PLAN.cleanupRequests), 1);
  assert.throws(() => assertPlanFits(BASELINE.budget, { ...REVOCATION_LIMITS, objectIntentions: 11 }));
  assert.throws(() => assertPlanFits(BASELINE.budget, { ...REVOCATION_LIMITS, completedObjects: 10 }));
});

test('accepts only the exact internal authority denial caused by revoked membership', async () => {
  assert.deepEqual(await requireRevokedAuthority(async () => {
    throw Object.assign(new Error('Authenticated authority required.'), { code: 'AUTHORITY_REQUIRED' });
  }), { code: 'AUTHORITY_REQUIRED' });
  await assert.rejects(() => requireRevokedAuthority(async () => {
    throw Object.assign(new Error('Document missing.'), { code: 'DOCUMENT_NOT_AVAILABLE' });
  }), error => error.code === 'R2_REVOCATION_UNEXPECTED_AUTHORITY_ERROR'
    && error.cause?.code === 'DOCUMENT_NOT_AVAILABLE');
  await assert.rejects(() => requireRevokedAuthority(async () => {
    throw new Error('Unexpected storage failure.');
  }), error => error.code === 'R2_REVOCATION_UNEXPECTED_AUTHORITY_ERROR');
  await assert.rejects(() => requireRevokedAuthority(async () => undefined),
    error => error.code === 'R2_REVOCATION_NEW_ISSUE_NOT_DENIED');
});

test('accepts only an explicit provider expiry response', async () => {
  const expired = new Response('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>',
    { status: 403, headers: { 'x-amz-request-id': 'synthetic-request' } });
  assert.deepEqual(await expiryDenial(expired), { status: 403, providerCode: 'AccessDenied', requestId: 'synthetic-request',
    extendedRequestId: null, cfId: null, explicitlyExpired: true });
  assert.equal((await expiryDenial(new Response('<Error><Code>ExpiredRequest</Code><Message>Presigned request expired.</Message></Error>', { status: 403 }))).providerCode, 'ExpiredRequest');
  await assert.rejects(() => expiryDenial(new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 })),
    /R2_SIGNED_EXPIRY_NOT_PROVEN/);
  await assert.rejects(() => expiryDenial(new Response('<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>', { status: 403 })),
    /R2_SIGNED_EXPIRY_NOT_PROVEN/);
});

test('uses real time, records no signed URL, and repeats none of the completed remote scenarios', () => {
  const source = fs.readFileSync(path.join(__dirname, 'group-c-r2-revocation.js'), 'utf8');
  assert.equal(EXPIRY_MARGIN_MS, 3000);
  assert.match(source, /new Date\(\)\.toISOString\(\)/);
  assert.match(source, /setTimeout\(resolve, waitMs\)/);
  assert.doesNotMatch(source, /Date\.now\s*=/);
  assert.doesNotMatch(source, /clock:\s*\(\)\s*=>\s*new Date\([^)]*[-+]/);
  const resultBlock = source.slice(source.indexOf('const revocation = Object.freeze'), source.indexOf("phase = 'REMOTE_CLEANUP'"));
  assert.doesNotMatch(resultBlock, /capability\.url|X-Amz-Signature/);
  assert(source.indexOf('r2-revocation-proof-before-cleanup.json') < source.indexOf("phase = 'REMOTE_CLEANUP'"));
  assert.match(resultBlock, /signedUrlPersisted: false/);
  assert.doesNotMatch(source, /beginMultipart|writePart|SCANNER_TIMEOUT_RECOVERY|SCANNER_UNAVAILABLE_RECOVERY/);
});

test('covers revocation and expiry locally without accepting unexpected failures', async () => {
  const request = Object.freeze({ sessionID: 'same-synthetic-session' });
  const object = Buffer.from(REVOCATION_BYTES);
  const journal = [];
  const effects = { capabilities: 0, signatures: 0, storageReads: 0, storageHeads: 0, cleanup: 0 };
  let revoked = false, expired = false, present = true;
  const issue = async currentRequest => {
    assert.strictEqual(currentRequest, request);
    if (revoked) throw Object.assign(new Error('Authenticated authority required.'), { code: 'AUTHORITY_REQUIRED' });
    effects.capabilities += 1; effects.signatures += 1;
    return Object.freeze({ url: 'https://synthetic.invalid/signed', expiresAt: '2026-10-24T16:00:00.000Z' });
  };
  const controlledRead = async capability => {
    assert(capability); effects.storageReads += 1;
    if (expired) return new Response('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>',
      { status: 403 });
    return new Response(object, { status: 200 });
  };
  const capability = await issue(request); journal.push('ISSUED');
  const first = await controlledRead(capability); assert.deepEqual(Buffer.from(await first.arrayBuffer()), object);
  revoked = true; journal.push('MEMBERSHIP_REVOKED');
  const beforeDenial = { ...effects };
  assert.deepEqual(await requireRevokedAuthority(() => issue(request)), { code: 'AUTHORITY_REQUIRED' });
  assert.deepEqual(effects, beforeDenial); journal.push('NEW_ISSUE_DENIED');
  const stillValid = await controlledRead(capability); assert.deepEqual(Buffer.from(await stillValid.arrayBuffer()), object);
  journal.push('PREVIOUS_URL_VALID');
  expired = true; const denied = await expiryDenial(await controlledRead(capability));
  assert.equal(denied.explicitlyExpired, true); journal.push('SIGNED_URL_EXPIRED');
  effects.storageHeads += 1; assert.equal(present, true); journal.push('AUTHENTICATED_HEAD_CONFIRMED');
  present = false; effects.cleanup += 1; journal.push('CLEANUP_COMPLETE', 'JOURNAL_CLOSED');
  assert.deepEqual(journal, ['ISSUED', 'MEMBERSHIP_REVOKED', 'NEW_ISSUE_DENIED', 'PREVIOUS_URL_VALID',
    'SIGNED_URL_EXPIRED', 'AUTHENTICATED_HEAD_CONFIRMED', 'CLEANUP_COMPLETE', 'JOURNAL_CLOSED']);
  assert.deepEqual(effects, { capabilities: 1, signatures: 1, storageReads: 3, storageHeads: 1, cleanup: 1 });
});

test('keeps internal revoked-session denial distinct from the public document contract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'group-c-r2-revocation.js'), 'utf8');
  const authority = fs.readFileSync(path.join(__dirname, '../../../backend/src/security/authenticatedAuthority.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../../../backend/src/routes/applicationSliceRoutes.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(__dirname, '../../../backend/src/applications/documentAuthorizationAdapter.js'), 'utf8');
  assert.match(authority, /membership\.status !== 'ACTIVE'.*denied\('MEMBERSHIP_INVALID'\)/s);
  assert.match(authority, /error\.code\s*=\s*'AUTHORITY_REQUIRED'/);
  assert.match(source, /changeStatus\([^]*status: 'REMOVED'[^]*requireRevokedAuthority\([^]*allowed\.request/s);
  const denialBlock = source.slice(source.indexOf('const revokedAuthority'), source.indexOf('const afterRevocationAt'));
  assert.doesNotMatch(denialBlock, /transport\.download|storage\.|controlledFetch/);
  assert.match(routes, /authorityFailure==='MEMBERSHIP_INVALID'\)code='NOT_AUTHORIZED'/);
  assert.match(adapter, /\['SESSION_REQUIRED','NOT_AUTHORIZED','AUTHORITY_REQUIRED','AUTHORITY_UNAVAILABLE'\]/);
});

(async () => {
  let passed = 0;
  for (const item of tests) {
    try { await item.callback(); passed += 1; process.stdout.write(`ok ${passed} - ${item.name}\n`); }
    catch (error) { process.stderr.write(`not ok ${passed + 1} - ${item.name}\n${error.stack}\n`); process.exitCode = 1; return; }
  }
  process.stdout.write(`1..${tests.length}\n`);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
