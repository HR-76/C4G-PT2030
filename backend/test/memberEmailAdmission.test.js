const test = require('node:test');
const assert = require('node:assert/strict');
const {version, fingerprints, admits} = require('../src/security/memberEmailAdmission');

test('053 member email variant admits exact rehearsed pins and rejects other versions and drift', () => {
 const pins = {schema:'5cf390a2ac1672f4d287f770011ba744f98edd8ad830ff9ee0977cf00a969c26',authority:'8d3e9f9b62b50e5ea5620e33f427ea5496a0ce3c210daad42ac5ad46bae7be21'};
 for (const [kind, pin] of Object.entries(pins)) {
  assert.equal(admits('053_opportunity_complement',kind,pin),true);
  assert.equal(admits('052_central_runtime_read',kind,pin),false);
  assert.equal(admits('054_unknown',kind,pin),false);
  assert.equal(admits('053_opportunity_complement',kind,pin.slice(0,-1)+'0'),false);
 }
 assert.equal(admits('053_opportunity_complement','schema',pins.authority),false);
 assert.equal(admits('053_opportunity_complement','authority',pins.schema),false);
});
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
