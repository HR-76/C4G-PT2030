'use strict';
const assert = require('node:assert/strict');

const org = '10000000-0000-4000-8000-000000000001';
const membership = '20000000-0000-4000-8000-000000000001';
const id = (number, kind = 3) => `${kind}0000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function alert(number, overrides = {}) {
  return { organization_id: org, recipient_membership_id: membership, alert_id: id(number),
    application_id: id(number, 4), opportunity_id: id(number, 5), evaluation_id: null,
    event_key: `STATUS:${id(number, 4)}:1`,
    type: 'APPLICATION_STATUS_CHANGED', title: `Alerta ${number}`, message: 'Mensagem da candidatura',
    application_title: `Candidatura ${number}`, status: 'PREPARATION', deadline: null, current_deadline: null,
    created_at: new Date(Date.UTC(2026, 9, 27, 0, 0, number)), read_at: null, ...overrides };
}
function notice(number, overrides = {}) {
  return { organization_id: org, recipient_membership_id: membership, alert_id: id(number, 6), notice_id: id(number, 7),
    type: 'BROADCAST', title: `Comunicado ${number}`, message: 'Mensagem administrativa',
    created_at: new Date(Date.UTC(2026, 9, 27, 0, 0, number)), read_at: null, ...overrides };
}
const order = (a, b) => new Date(b.created_at) - new Date(a.created_at) || b.alert_id.localeCompare(a.alert_id);
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));

function fixture({ alerts = [], notices = [], noticesReady = true, allowed = () => true,
  transformHydration = rows => rows, afterMetadata = () => {}, failAudit = false,
  createRepository = require('../../src/applications/alerts').createAlertsRepository } = {}) {
  const stats = { queries: 0, bytes: 0, contentRows: 0, hydratedRows: 0, hydrationQueries: 0 };
  const trace = [], sqlCalls = [];
  function result(rows, hydration = false) {
    stats.bytes += Buffer.byteLength(JSON.stringify(rows));
    stats.contentRows += rows.filter(row => row && Object.hasOwn(row, 'message')).length;
    if (hydration) stats.hydratedRows += rows.length;
    return { rows, rowCount: rows.length };
  }
  const client = { async query(sql, values) {
    stats.queries++; sqlCalls.push({ sql, values: structuredClone(values) });
    if (sql.includes('to_regclass')) return result([{ ready: sql.includes('organization_notice') ? noticesReady : true }]);
    assert.equal(values[0], org); assert.equal(values[1], membership);
    const broadcast = sql.includes('organization_notice');
    const source = broadcast ? notices : alerts;
    const records = source.filter(row => row.organization_id === org && row.recipient_membership_id === membership);
    if (sql.startsWith('UPDATE')) {
      assert.ok(sql.includes('read_at IS NULL'));
      const row = records.find(value => value.alert_id === values[2]);
      trace.push(['update', broadcast ? 'BROADCAST' : 'ALERT', values[2]]);
      if (row && !row.read_at) row.read_at = new Date('2026-10-28T00:00:00Z');
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    assert.ok(sql.includes(broadcast ? 'r.organization_id=$1' : 'n.organization_id=$1'));
    assert.ok(sql.includes(broadcast ? 'r.recipient_membership_id=$2' : 'n.recipient_membership_id=$2'));
    if (values.length === 3) {
      assert.ok(Array.isArray(values[2])); assert.ok(sql.includes('ANY($3::uuid[])'));
      stats.hydrationQueries++;
      const fields = broadcast ? ['alert_id', 'notice_id', 'title', 'message'] : ['alert_id', 'title', 'message'];
      const selected = records.filter(row => values[2].includes(row.alert_id)).map(row => pick(structuredClone(row), fields));
      return result(transformHydration(selected, broadcast ? 'BROADCAST' : 'ALERT'), true);
    }
    assert.ok(sql.includes('LIMIT 10001'));
    const includeContent = sql.includes('SELECT n.*') || sql.includes('n.title,n.message');
    const fields = broadcast ? ['alert_id', 'read_at', 'notice_id', 'created_at', 'type'] :
      ['alert_id', 'application_id', 'type', 'deadline', 'created_at', 'read_at', 'application_title', 'opportunity_id', 'evaluation_id', 'status', 'current_deadline'];
    if (sql.includes('SELECT n.*')) fields.push('organization_id', 'recipient_membership_id', 'event_key');
    const selected = records.slice().sort(order).slice(0, 10001).map(row =>
      pick(structuredClone(row), [...fields, ...(includeContent ? ['title', 'message'] : [])]));
    afterMetadata(broadcast ? 'BROADCAST' : 'ALERT', source);
    return result(selected);
  } };
  const repository = createRepository({ organizationId: org, actor: { id: id(1, 8), membershipId: membership },
    protect: async args => trace.push(['protect', args.operationCode]), activeRecipients: async () => [],
    authorize: async (operation, target) => { trace.push(['authorize', operation, target.id]); return allowed(operation, target); },
    audit: async (unused, event) => { trace.push(['audit', event.eventCode, event.resourceId, event.idempotencyKey]); if (failAudit) throw new Error('AUDIT_UNAVAILABLE'); }
  });
  return { stats, trace, sqlCalls, alerts, notices,
    list: (input = {}) => repository.alertsList(client, null, { unread: false, limit: 100, ...input }),
    read: target => repository.alertsRead(client, target), readAll: () => repository.alertsReadAll(client) };
}
module.exports = { fixture, alert, notice, id, org, membership };
