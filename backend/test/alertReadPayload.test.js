'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, alert, notice, id, org } = require('./support/alertReadFixture');

test('limit one hydrates only the selected content while counts and authorization remain global', async () => {
  const f = fixture({ alerts: [alert(1), alert(2, { read_at: new Date('2026-10-28') })], notices: [notice(3)] });
  const value = await f.list({ limit: 1 });
  assert.equal(value.total, 3); assert.equal(value.unread_count, 2); assert.equal(value.truncated, true);
  assert.equal(value.notifications.length, 1); assert.equal(value.notifications[0].title, 'Comunicado 3');
  assert.equal(f.stats.contentRows, 1); assert.equal(f.stats.hydrationQueries, 1);
  assert.deepEqual(f.trace, [['protect', 'NOTIFICATION_READ'],
    ['authorize', 'APPLICATION_READ', id(2, 4)], ['authorize', 'OPPORTUNITY_READ', id(2, 5)],
    ['authorize', 'APPLICATION_READ', id(1, 4)], ['authorize', 'OPPORTUNITY_READ', id(1, 5)]]);
});

test('deadline filtering, denials, evaluation checks, ties and unread filtering retain public output', async () => {
  const sameTime = new Date('2026-10-27T12:00:00Z');
  const f = fixture({ alerts: [alert(1, { created_at: sameTime, evaluation_id: id(1, 9) }),
    alert(2, { created_at: sameTime, read_at: new Date('2026-10-28') }),
    alert(3, { type: 'DEADLINE_7_DAYS', deadline: '2026-10-30', current_deadline: '2026-10-31' }),
    alert(4), alert(5, { opportunity_id: null })], notices: [notice(6, { created_at: sameTime })],
    allowed: (operation, target) => !(operation === 'APPLICATION_READ' && target.id === id(4, 4)) });
  const value = await f.list({ unread: true });
  assert.deepEqual(value.notifications.map(row => row.id), [id(6, 6), id(1), id(5)]);
  assert.equal(value.total, 3); assert.equal(value.unread_count, 3); assert.equal(value.truncated, false);
  assert.equal(f.stats.contentRows, 3); assert.equal(f.stats.hydrationQueries, 2);
  assert.ok(f.trace.some(entry => entry[1] === 'F14_PREQUALIFICATION_READ'));
  assert.ok(f.trace.some(entry => entry[1] === 'OPPORTUNITY_READ' && entry[2] === org));
  assert.ok(!f.trace.some(entry => entry[2] === id(3, 4)));
  assert.ok(!f.trace.some(entry => entry[2] === id(4, 5)));
});

test('read acknowledgements load no content, retain update/audit order and remain idempotent', async () => {
  const f = fixture({ alerts: [alert(1)], notices: [notice(2)] });
  assert.deepEqual(await f.read(id(1)), { success: true });
  assert.equal(f.stats.contentRows, 0); assert.equal(f.stats.hydrationQueries, 0);
  assert.deepEqual(f.trace.slice(-2), [['update', 'ALERT', id(1)], ['audit', 'APPLICATION_ALERT_READ', id(1, 4), id(1)]]);
  const priorUpdates = f.trace.filter(row => row[0] === 'update').length;
  await f.read(id(1)); assert.equal(f.trace.filter(row => row[0] === 'update').length, priorUpdates);
  await f.readAll();
  assert.deepEqual(f.trace.slice(-2), [['update', 'BROADCAST', id(2, 6)], ['audit', 'ORGANIZATION_NOTICE_READ', id(2, 7), id(2, 6)]]);
  assert.equal(f.stats.contentRows, 0);
});

test('acknowledgement refuses unavailable resources and stops immediately on audit failure', async () => {
  const denied = fixture({ alerts: [alert(1)], allowed: () => false });
  await assert.rejects(denied.read(id(1)), { code: 'RESOURCE_NOT_AVAILABLE' });
  assert.ok(!denied.trace.some(row => row[0] === 'update'));
  const failed = fixture({ alerts: [alert(1), alert(2)], failAudit: true });
  await assert.rejects(failed.readAll(), /AUDIT_UNAVAILABLE/);
  assert.equal(failed.trace.filter(row => row[0] === 'update').length, 1);
  assert.equal(failed.stats.contentRows, 0);
});

test('snapshot read state and application title survive metadata changes before hydration', async () => {
  const f = fixture({ alerts: [alert(1)], afterMetadata: (source, rows) => {
    if (source === 'ALERT') { rows[0].read_at = new Date('2026-10-28'); rows[0].application_title = 'Changed later'; rows.push(alert(2)); }
  }, transformHydration: rows => rows.map(row => ({ ...row, read_at: new Date('2026-10-28'),
    application_title: 'Hydration must not replace the title', application_id: id(99, 4),
    created_at: new Date('2026-10-29'), type: 'BROADCAST' })) });
  const value = await f.list();
  assert.equal(value.total, 1); assert.equal(value.unread_count, 1);
  assert.equal(value.notifications[0].is_read, false); assert.equal(value.notifications[0].application_title, 'Candidatura 1');
  assert.equal(value.notifications[0].related_application_id, id(1, 4));
  assert.equal(value.notifications[0].type, 'APPLICATION_STATUS_CHANGED');
  assert.equal(value.notifications[0].created_at, '2026-10-27T00:00:01.000Z');
  assert.equal(f.stats.hydratedRows, 1);
});

test('colliding notification IDs from different sources retain separate content', async () => {
  const f = fixture({ alerts: [alert(1, { title: 'Application title' })], notices: [notice(2, { alert_id: id(1), title: 'Broadcast title' })] });
  const value = await f.list();
  assert.deepEqual(value.notifications.map(row => row.title), ['Broadcast title', 'Application title']);
  assert.equal(f.stats.hydrationQueries, 2);
});

test('hydration order and records belonging to other recipients or organizations cannot change the page', async () => {
  const f = fixture({ alerts: [alert(1), alert(2), alert(3, { organization_id: id(99, 1) }),
    alert(4, { recipient_membership_id: id(99, 2) })], transformHydration: rows => rows.reverse() });
  const value = await f.list();
  assert.deepEqual(value.notifications.map(row => [row.id, row.title]), [[id(2), 'Alerta 2'], [id(1), 'Alerta 1']]);
  assert.equal(value.total, 2); assert.equal(f.stats.contentRows, 2);
});

test('acknowledgement cannot change alerts or notices belonging to another recipient or organization', async () => {
  const otherOrg = id(99, 1), otherMember = id(99, 2);
  const foreign = [alert(2, { organization_id: otherOrg }), alert(3, { recipient_membership_id: otherMember })];
  const foreignNotices = [notice(4, { organization_id: otherOrg }), notice(5, { recipient_membership_id: otherMember })];
  const f = fixture({ alerts: [alert(1), ...foreign], notices: foreignNotices });
  for (const row of [...foreign, ...foreignNotices]) await assert.rejects(f.read(row.alert_id), { code: 'RESOURCE_NOT_AVAILABLE' });
  assert.ok(!f.trace.some(row => ['update', 'audit'].includes(row[0])));
  assert.ok([...foreign, ...foreignNotices].every(row => row.read_at === null));
  assert.equal(f.stats.contentRows, 0);
  assert.equal(f.stats.hydrationQueries, 0);
});

test('missing, duplicate, unexpected, malformed or mismatched hydration fails closed', async () => {
  const changes = [() => [], rows => [...rows, rows[0]], rows => [...rows, { ...rows[0], alert_id: id(99) }],
    rows => rows.map(row => ({ ...row, message: null })), rows => rows.map(row => ({ ...row, notice_id: id(99) })),
    () => [null]];
  for (const change of changes) {
    const f = fixture({ notices: [notice(1)], transformHydration: change });
    await assert.rejects(f.list(), { code: 'SERVICE_UNAVAILABLE' });
  }
});

test('empty or denied results do not hydrate and a tenant without notices remains supported', async () => {
  const empty = fixture(); assert.deepEqual(await empty.list(), { notifications: [], unread_count: 0, total: 0, truncated: false });
  assert.equal(empty.stats.hydrationQueries, 0);
  const denied = fixture({ alerts: [alert(1)], allowed: () => false, noticesReady: false });
  assert.equal((await denied.list()).total, 0); assert.equal(denied.stats.contentRows, 0);
  const legacy = fixture({ alerts: [alert(1)], noticesReady: false });
  assert.equal((await legacy.list()).total, 1); assert.equal(legacy.stats.hydrationQueries, 1);
});

test('candidate and combined visible limits retain exact failure boundaries', async () => {
  const overflow = fixture({ alerts: Array.from({ length: 10001 }, (_, n) => alert(n + 1)) });
  await assert.rejects(overflow.list({ limit: 1 }), { code: 'LIMIT_EXCEEDED' });
  assert.equal(overflow.trace.filter(row => row[0] === 'authorize').length, 0);
  const exact = fixture({ notices: Array.from({ length: 10000 }, (_, n) => notice(n + 1)) });
  assert.equal((await exact.list({ limit: 1 })).total, 10000); assert.equal(exact.stats.contentRows, 1);
  const combined = fixture({ alerts: [alert(1)], notices: Array.from({ length: 10000 }, (_, n) => notice(n + 1)) });
  await assert.rejects(combined.list(), { code: 'LIMIT_EXCEEDED' });
  assert.equal(combined.stats.hydrationQueries, 0);
});
