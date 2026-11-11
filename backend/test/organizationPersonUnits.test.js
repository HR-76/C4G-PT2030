'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parse } = require('../src/organizationDirectory/contracts');
const { createDirectoryRepository } = require('../src/organizationDirectory/repository');

// A person edit replaces the person's unit set. person_unit has no per-row history, so the
// replacement must be fixed-size (no statement per unit) and a no-op when nothing changed.
const org = '00000000-0000-4000-8000-000000000001';
const personId = '00000000-0000-4000-8000-0000000000aa';
const normalize = sql => sql.replace(/\s+/g, ' ').trim();

function setup({ current = [] } = {}) {
  const statements = [];
  const repository = createDirectoryRepository({
    organizationId: org, actor: { id: randomUUID() }, protect: async () => {}, audit: async () => {}, tokens: {}
  });
  const client = {
    async query(sql, values) {
      const text = normalize(sql);
      statements.push({ text, values });
      if (/FROM organizational_scope\.directory_receipt/.test(text)) return { rows: [] };
      if (/FROM organizational_scope\.person WHERE .* FOR UPDATE/.test(text)) {
        return { rows: [{ person_id: personId, organization_id: org, name: 'Ana', email: '', function_label: '', active: true, revision: 1 }] };
      }
      if (/FROM organizational_scope\.scope WHERE .* FOR SHARE/.test(text)) return { rows: values[1].map(scope_id => ({ scope_id })) };
      if (/^SELECT scope_id,is_primary FROM organizational_scope\.person_unit/.test(text)) return { rows: current };
      if (/^(UPDATE organizational_scope\.person |INSERT INTO organizational_scope\.person\()/.test(text)) {
        return { rows: [{ person_id: personId, organization_id: org, name: 'Ana', email: '', function_label: '', active: true, revision: 2 }] };
      }
      return { rows: [] };
    }
  };
  const unitStatements = () => statements.filter(s => /organizational_scope\.person_unit/.test(s.text));
  return { repository, client, unitStatements };
}

const edit = (unitIds, primaryUnitId) => parse('personEdit', {
  idempotencyKey: randomUUID(), name: 'Ana', email: '', functionLabel: '', active: true, unitIds, primaryUnitId, expectedRevision: 1
});

test('changed unit set costs a fixed number of statements regardless of the number of units', async () => {
  const units = Array.from({ length: 12 }, randomUUID);
  const { repository, client, unitStatements } = setup({ current: [{ scope_id: units[0], is_primary: true }] });
  const input = edit(units, units[0]);
  await repository.personWrite(client, 'personEdit', input, personId);
  const writes = unitStatements().filter(s => /^(INSERT|DELETE)/.test(s.text));
  assert.equal(writes.length, 2, writes.map(s => s.text).join('\n'));
  assert.match(writes[0].text, /^DELETE FROM organizational_scope\.person_unit WHERE organization_id=\$1 AND person_id=\$2$/);
  assert.match(writes[1].text, /^INSERT INTO organizational_scope\.person_unit\(organization_id,person_id,scope_id,is_primary\) SELECT \$1,\$2,u,\(u=\$4::uuid\) FROM unnest\(\$3::uuid\[\]\) AS u$/);
  assert.deepEqual(writes[1].values, [org, personId, input.unitIds, units[0]]);
});

test('unchanged unit set and primary unit write nothing to person_unit', async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const { repository, client, unitStatements } = setup({ current: [{ scope_id: b, is_primary: false }, { scope_id: a, is_primary: true }] });
  const result = await repository.personWrite(client, 'personEdit', edit([a, b], a), personId);
  assert.equal(unitStatements().some(s => /^(INSERT|DELETE|UPDATE)/.test(s.text)), false);
  assert.deepEqual([...result.unitIds].sort(), [a, b].sort());
  assert.equal(result.primaryUnitId, a);
});

test('changing only the primary unit rewrites the set', async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const { repository, client, unitStatements } = setup({ current: [{ scope_id: a, is_primary: true }, { scope_id: b, is_primary: false }] });
  await repository.personWrite(client, 'personEdit', edit([a, b], b), personId);
  assert.equal(unitStatements().filter(s => /^(INSERT|DELETE)/.test(s.text)).length, 2);
});

test('clearing every unit deletes without inserting', async () => {
  const a = randomUUID();
  const { repository, client, unitStatements } = setup({ current: [{ scope_id: a, is_primary: true }] });
  await repository.personWrite(client, 'personEdit', edit([], null), personId);
  const writes = unitStatements().filter(s => /^(INSERT|DELETE)/.test(s.text));
  assert.deepEqual(writes.map(s => s.text.split(' ')[0]), ['DELETE']);
});

test('creating a person inserts the unit set in one statement without reading current units', async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const { repository, client, unitStatements } = setup();
  await repository.personWrite(client, 'personCreate', parse('personCreate', {
    idempotencyKey: randomUUID(), name: 'Ana', email: '', functionLabel: '', active: true, unitIds: [a, b], primaryUnitId: a
  }), null);
  const unit = unitStatements();
  assert.equal(unit.some(s => /^SELECT/.test(s.text)), false);
  assert.equal(unit.filter(s => /^INSERT/.test(s.text)).length, 1);
});
