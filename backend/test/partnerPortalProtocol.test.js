'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPartnersPortalRepository } = require('../prototypes/partnerSqlPortal');
const { tenantFailure } = require('../src/security/tenantRuntimeErrors');
const { ORGANIZATION, SUBJECT, id, partnerRow } = require('./support/partnerBrowseContract');

const error = code => Object.assign(new Error(code), { code });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const portalPattern = 'c4g_partner_browse_[a-f0-9]{32}';

// Protocol double, not a PostgreSQL executor. The outer rollback is deliberately
// absent here: tests can distinguish what the candidate leaves to its owner.
function fixture(options = {}) {
  const rows = structuredClone(options.rows || Array.from({ length: options.count ?? 1 }, (_, n) => partnerRow(n + 1)));
  const state = { rows, expired: false, portals: new Map(), attempted: [], physical: [], events: [], auth: [], concurrent: 0 };
  const client = { async query(sql, values) {
    const phase = sql.includes('to_regclass') ? 'schema' : sql.split(' ')[0];
    state.attempted.push(phase);
    if (state.expired) throw state.leaseError ||= tenantFailure('LEASE_TIMEOUT', 'TENANT_OPERATION_UNAVAILABLE');
    assert.equal(state.concurrent++, 0, 'queries on the prepared client must be sequential');
    try {
      state.physical.push({ phase, sql, values }); state.events.push(phase);
      await options.beforeQuery?.({ phase, sql, state });
      if (phase === options.failQuery) throw options.queryError || error('XX000');
      if (phase === 'schema') return { rows: [{ relation: options.schemaReady === false ? null : 'application_partner' }] };
      if (phase === 'DECLARE') {
        assert.match(sql, new RegExp(`^DECLARE (${portalPattern}) NO SCROLL CURSOR WITHOUT HOLD FOR`));
        assert.match(sql, /WHERE p\.organization_id=\$1 AND p\.active\s+ORDER BY p\.partner_id\s+LIMIT 10001\s*;?$/);
        assert.deepEqual(values, [ORGANIZATION]);
        const name = sql.split(' ')[1];
        assert.ok(!state.portals.has(name));
        const candidates = state.rows.filter(row => row.active && row.organization_id === ORGANIZATION && row.application_organization_id === ORGANIZATION);
        state.portals.set(name, { offset: 0, rows: structuredClone(candidates).sort((a, b) => a.partner_id < b.partner_id ? -1 : 1).slice(0, 10001) });
        await options.afterDeclare?.(state);
        return { rows: [] };
      }
      if (phase === 'FETCH') {
        const match = new RegExp(`^FETCH FORWARD (100|1) FROM (${portalPattern});?$`).exec(sql);
        assert.ok(match, 'bounded forward FETCH');
        const portal = state.portals.get(match[2]); assert.ok(portal, 'FETCH uses this request portal');
        const batch = portal.rows.slice(portal.offset, portal.offset + Number(match[1]));
        portal.offset += batch.length;
        return { rows: structuredClone(batch) };
      }
      if (phase === 'CLOSE') {
        const name = new RegExp(`^CLOSE (${portalPattern});?$`).exec(sql)?.[1];
        assert.ok(state.portals.delete(name), 'close the exact opened portal');
        return { rows: [] };
      }
      if (sql === 'SELECT team_permission') return { rows: [{ allowed: true }] };
      assert.fail(`Unexpected command ${phase}`);
    } finally { state.concurrent--; }
  } };
  const repository = createPartnersPortalRepository({ organizationId: ORGANIZATION, actor: { id: SUBJECT },
    protect: async target => { state.events.push('protect'); assert.equal(target.resource.organizationId, ORGANIZATION); if (options.protectError) throw options.protectError; },
    authorize: async (operation, resource) => {
      state.events.push('authorize'); state.auth.push([operation, resource.id]);
      return options.authorize ? options.authorize({ operation, resource, client, state }) : true;
    },
    cursor: { cursor: (position, bind) => options.issue ? options.issue(position, bind, state) : JSON.stringify({ position, bind }),
      openCursor: () => { throw options.cursorError || error('INVALID_CURSOR'); } }
  });
  return { state, client, browse: input => repository.partnersBrowse(client, null, { q: '', country: '', person_role: '', cursor: null, ...input }) };
}

for (const count of [0, 25, 26, 100, 101, 10000]) test(`portal protocol: ${count} candidates, bounded FETCH and CLOSE before return`, async () => {
  const h = fixture({ count }), result = await h.browse();
  assert.equal(result.total, count); assert.equal(result.items.length, Math.min(count, 25));
  assert.deepEqual(h.state.events.slice(0, 4), ['protect', 'schema', 'DECLARE', 'FETCH']);
  assert.equal(h.state.events.at(-1), 'CLOSE'); assert.equal(h.state.portals.size, 0);
  const fetches = h.state.physical.filter(query => query.phase === 'FETCH');
  assert.equal(fetches.length, Math.floor(count / 100) + 1);
  assert.ok(fetches.slice(0, -1).every(query => query.sql.startsWith('FETCH FORWARD 100 ')));
  assert.ok(fetches.at(-1).sql.startsWith(`FETCH FORWARD ${count === 10000 ? 1 : 100} `));
  assert.equal(h.state.auth.length, count * 2);
  assert.equal(h.state.physical.length, Math.floor(count / 100) + 4, 'schema + DECLARE + FETCHs + CLOSE');
});

test('portal overflow is detected after 10000 authorizations and closes without authorizing the sentinel', async () => {
  const h = fixture({ count: 10001 });
  await assert.rejects(h.browse({ cursor: 'bad' }), { code: 'LIMIT_EXCEEDED' });
  assert.equal(h.state.auth.length, 20000);
  assert.ok(!h.state.auth.some(([, target]) => target === id(10001, 4)));
  assert.match(h.state.physical.at(-2).sql, /^FETCH FORWARD 1 /);
  assert.equal(h.state.physical.at(-1).phase, 'CLOSE');
});

test('authority failure before overflow wins and delegates cleanup to the transaction owner', async () => {
  const primary = error('SERVICE_UNAVAILABLE');
  const h = fixture({ count: 10001, authorize: ({ resource }) => { if (resource.id === id(10000, 4)) throw primary; return true; } });
  await assert.rejects(h.browse({ cursor: 'bad' }), e => e === primary);
  assert.equal(h.state.physical.at(-1).phase, 'FETCH');
  assert.ok(!h.state.physical.some(query => /^FETCH FORWARD 1 /.test(query.sql)));
  assert.equal(h.state.portals.size, 1, 'outer ROLLBACK owns the failed request portal');
});

test('global guard failure performs no SQL; missing schema never opens a portal', async () => {
  const primary = error('SERVICE_UNAVAILABLE'), guard = fixture({ protectError: primary });
  await assert.rejects(guard.browse(), e => e === primary); assert.deepEqual(guard.state.attempted, []);
  const schema = fixture({ schemaReady: false });
  await assert.rejects(schema.browse(), { code: 'SCHEMA_UPGRADE_REQUIRED' });
  assert.deepEqual(schema.state.attempted, ['schema']);
});

for (const phase of ['schema', 'DECLARE', 'FETCH', 'CLOSE']) test(`portal ${phase} failure is sanitized and never retried`, async () => {
  const driver = Object.assign(new Error('SQL and private content must not escape'), { code: 'XX000', detail: 'private' });
  const h = fixture({ failQuery: phase, queryError: driver });
  await assert.rejects(h.browse(), e => e.code === 'SERVICE_UNAVAILABLE' && e.message === 'Application refused' && !e.cause && !e.detail);
  assert.equal(h.state.attempted.at(-1), phase);
  assert.equal(h.state.attempted.filter(value => value === phase).length, 1);
});

test('ambiguous DECLARE completion sends neither FETCH nor speculative CLOSE', async () => {
  const h = fixture({ afterDeclare: () => { throw error('ECONNRESET'); } });
  await assert.rejects(h.browse(), { code: 'SERVICE_UNAVAILABLE' });
  assert.deepEqual(h.state.attempted, ['schema', 'DECLARE']);
  assert.equal(h.state.portals.size, 1, 'outer rollback/discard must handle uncertain opening');
});

test('local cursor error remains primary when best-effort CLOSE also fails', async () => {
  const primary = error('INVALID_CURSOR');
  const h = fixture({ cursorError: primary, failQuery: 'CLOSE' });
  await assert.rejects(h.browse({ cursor: 'bad' }), e => e === primary);
  assert.equal(h.state.attempted.filter(value => value === 'CLOSE').length, 1);
});

test('local projection and canonicalization failures attempt CLOSE and return no partial page', async () => {
  for (const body of [{ people: null }, { entity_name: 'Cafe\u0301' }]) {
    const h = fixture({ rows: [partnerRow(1, body)] });
    await assert.rejects(h.browse());
    assert.equal(h.state.attempted.at(-1), 'CLOSE'); assert.equal(h.state.portals.size, 0);
  }
});

test('CLOSE is awaited before a successful result becomes observable', async () => {
  const entered = deferred(), release = deferred();
  const h = fixture({ beforeQuery: async ({ phase }) => { if (phase === 'CLOSE') { entered.resolve(); await release.promise; } } });
  let settled = false;
  const pending = h.browse().then(result => { settled = true; return result; });
  await entered.promise;
  try { assert.equal(settled, false); } finally { release.resolve(); }
  assert.equal((await pending).total, 1); assert.equal(settled, true);
});

test('lease failure on a later FETCH is preserved and causes no further physical SQL', async () => {
  const h = fixture({ count: 101, authorize: ({ resource, state }) => { if (resource.id === id(100, 5)) state.expired = true; return true; } });
  await assert.rejects(h.browse(), e => e === h.state.leaseError && e.internalCode === 'LEASE_TIMEOUT');
  assert.deepEqual(h.state.physical.map(q => q.phase), ['schema', 'DECLARE', 'FETCH']);
  assert.deepEqual(h.state.attempted, ['schema', 'DECLARE', 'FETCH', 'FETCH']);
});

test('lease expiry during local cleanup cannot bypass prepared client and cannot mask primary error', async () => {
  const primary = error('INVALID_INPUT');
  const h = fixture({ count: 26, issue: (_position, _bind, state) => { state.expired = true; throw primary; } });
  await assert.rejects(h.browse(), e => e === primary);
  assert.equal(h.state.attempted.at(-1), 'CLOSE');
  assert.equal(h.state.physical.at(-1).phase, 'FETCH');
});

test('authority/audit failures stop SQL even if a port hides an aborted transaction', async () => {
  for (const primary of [error('SERVICE_UNAVAILABLE'), tenantFailure('LEASE_TIMEOUT', 'TENANT_OPERATION_UNAVAILABLE')]) {
    const h = fixture({ authorize: ({ state }) => { state.expired = true; throw primary; } });
    await assert.rejects(h.browse(), e => e === primary);
    assert.deepEqual(h.state.attempted, ['schema', 'DECLARE', 'FETCH']);
  }
});

test('authority may issue sequential queries on the same client while the data portal is open', async () => {
  const h = fixture({ authorize: async ({ client }) => (await client.query('SELECT team_permission')).rows[0].allowed });
  assert.equal((await h.browse()).total, 1);
  assert.deepEqual(h.state.physical.map(query => query.phase), ['schema', 'DECLARE', 'FETCH', 'SELECT', 'SELECT', 'CLOSE']);
});

test('simulated portal capture is retained between FETCHs but authority is checked on each row', async () => {
  const h = fixture({ count: 101, afterDeclare: state => { state.rows[100].body.entity_name = 'Changed after open'; },
    authorize: ({ resource, state }) => {
      if (resource.id === id(100, 5)) state.rows[100].active = false;
      return resource.id !== id(101, 5);
    } });
  const page = await h.browse();
  assert.equal(page.total, 100); assert.equal(h.state.auth.at(-1)[1], id(101, 5));
  assert.equal(h.state.rows[100].active, false);
});

test('simulated changes after DECLARE and before first FETCH do not rehydrate projected fields', async () => {
  const h = fixture({ afterDeclare: state => {
    state.rows[0].body.entity_name = 'New name'; state.rows[0].application_title = 'New title'; state.rows[0].active = false;
  } });
  const first = await h.browse();
  assert.equal(first.total, 1); assert.equal(first.items[0].entity_name, 'Parceiro 00001');
  assert.equal(first.items[0].application_title, 'Candidatura');
  assert.equal((await h.browse()).total, 0, 'new request opens a new simulated snapshot');
});

test('simulated mutation between batches retains old content for digest/page and appears on next request', async () => {
  const h = fixture({ count: 101, authorize: ({ resource, state }) => {
    if (resource.id === id(100, 5)) { state.rows[100].body.entity_name = 'Changed'; state.rows[100].opportunity_title = 'New opportunity'; }
    return true;
  } });
  const first = await h.browse({ q: 'Parceiro 00101' });
  assert.equal(first.total, 1); assert.equal(first.items[0].entity_name, 'Parceiro 00101');
  assert.equal(first.items[0].opportunity_title, 'Oportunidade');
  assert.equal((await h.browse({ q: 'Parceiro 00101' })).total, 0);
});

test('server-generated portal names are safe and unique per request; values stay parameterized', async () => {
  const h = fixture();
  await h.browse({ q: "'; DROP TABLE x; --", country: '"', person_role: '' }); await h.browse();
  const declarations = h.state.physical.filter(query => query.phase === 'DECLARE');
  const names = declarations.map(query => query.sql.split(' ')[1]);
  assert.notEqual(names[0], names[1]); assert.ok(names.every(name => name.length < 63 && new RegExp(`^${portalPattern}$`).test(name)));
  for (const query of declarations) { assert.deepEqual(query.values, [ORGANIZATION]); assert.ok(!query.sql.includes('DROP TABLE')); }
  assert.ok(h.state.physical.every(query => !/^(BEGIN|COMMIT|ROLLBACK|SET|SAVEPOINT|RELEASE)\b/i.test(query.sql)));
});
