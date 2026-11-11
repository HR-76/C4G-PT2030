const test = require('node:test');
const assert = require('node:assert/strict');
const {version, fingerprints, admits} = require('../src/security/memberEmailAdmission');
test('member email admission is restricted to the exact rehearsed schema and authority variant', () => {
  for (const kind of ['schema', 'authority']) {
    assert.equal(admits(version, kind, fingerprints[kind]), true);
    for (const invalid of [null, '', fingerprints[kind] + '0', '0'.repeat(64)]) assert.equal(admits(version, kind, invalid), false);
    for (const other of ['035_funding_source_resolution', '051_unregistered', null]) assert.equal(admits(other, kind, fingerprints[kind]), false);
  }
  assert.equal(admits(version, 'schema', fingerprints.authority), false);
  assert.equal(admits(version, 'authority', fingerprints.schema), false);
  assert.equal(admits(version, 'toString', fingerprints.schema), false);
});

test('later email variants admit only independently rehearsed exact fingerprints',()=>{
 assert.equal(admits('049_pt2030_document_upload','schema','767e49642e9976b8a8b99c20be1e8e43fadaf390efe8869192b30fc10f30b4b8'),true);
 assert.equal(admits('049_pt2030_document_upload','authority',fingerprints.authority),true);
 assert.equal(admits('050_billing_private_documents','schema','060c07f21a4cbee846e9a6b3a2737b5d176639337cbb8bf858ee093b11e1cd04'),true);
 assert.equal(admits('050_billing_private_documents','authority','0d27d56b2ec45f7970c07a46bb4cd8a3f32b1248af02c7e2fdb23d7f5a069e76'),true);
 assert.equal(admits('050_billing_private_documents','schema',fingerprints.schema),false);
 assert.equal(admits('050_billing_private_documents','authority',fingerprints.authority),false);
});
