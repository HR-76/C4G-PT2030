'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalConstraints } = require('../src/security/postgresCatalogCompatibility');
const { schemaFingerprint } = require('../src/security/centralSchemaManifest');

test('PostgreSQL 18 duplicate NOT NULL catalog entries preserve the PostgreSQL 17 fingerprint', () => {
  const pk = { constraint_type: 'p', definition: 'PRIMARY KEY (id)' };
  const columns = [{ column_name: 'id', not_null: true }];
  const before = { columns, constraints: [pk] };
  const after = { columns, constraints: canonicalConstraints([pk, { constraint_type: 'n', definition: 'NOT NULL id' }]) };
  assert.equal(schemaFingerprint(before), schemaFingerprint(after));
  assert.notEqual(schemaFingerprint(before), schemaFingerprint({ ...after, columns: [{ column_name: 'id', not_null: false }] }));
});

test('NOT NULL validation/inheritance/enforcement drift remains a refusal', () => {
  for (const definition of ['UNSUPPORTED_NOT_NULL', 'NOT NULL id NOT VALID', 'NOT NULL id NO INHERIT', 'NOT NULL id NOT ENFORCED']) {
    assert.throws(() => canonicalConstraints([{ constraint_type: 'n', definition }]), /UNSUPPORTED_NOT_NULL/);
  }
  const fk = { constraint_type: 'f', definition: 'FOREIGN KEY (id) REFERENCES other(id) NOT VALID' };
  assert.deepEqual(canonicalConstraints([fk]), [fk]);
});
