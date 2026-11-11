'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parse, read } = require('../src/applications/organizationCalendar');

test('calendar accepts civil month and day, a candidate UUID and a bounded page', () => {
 const applicationId = randomUUID();
 assert.deepEqual(parse({ month: '2028-02', day: '2028-02-29', applicationId, applicationQ: '  Norte ', page: '2', status: 'IDENTIFIED' }),
  { month: '2028-02', day: '2028-02-29', applicationId, applicationQ: 'Norte', page: 2, status: 'IDENTIFIED' });
 assert.equal(parse({ month: '2028-02' }).status, null);
 for (const value of [
  { month: '0000-01' }, { month: '2026-13' }, { month: '2026-02', day: '2026-02-29' },
  { month: '2026-02', day: '2026-03-01' }, { month: '2026-02', applicationId: ['other'] },
  { month: '2026-02', page: '1001' }, { month: '2026-02', organizationId: randomUUID() },
  { month: '2026-02', status: 'APPROVED' }, { month: '2026-02', status: ['PREPARATION'] },
 ]) assert.throws(() => parse(value), { code: 'INVALID_INPUT' });
});

test('calendar scopes events and options before pagination and reports the full count for a crowded day', async () => {
 const organizationId = randomUUID(), applicationId = randomUUID(), taskId = randomUUID();
 const input = parse({ month: '2026-07', applicationId, page: '2', applicationQ: 'Norte', status: 'PREPARATION' });
 const permission = { all: false, ids: [applicationId] };
 const authority = { teamOnly: false, membershipId: randomUUID(), application: permission, opportunity: permission, evaluation: permission, work: permission };
 const task = {
  event_key: 'task:' + taskId, task_id: taskId, due_date: '2026-07-01',
  application_id: applicationId, application_title: 'Projeto Norte', current_status: 'PREPARATION', event_title: 'Rever orçamento',
 };
 const client = { async query(sql, params) {
  assert.match(sql, /WHERE a.organization_id=\$1/);
  assert.match(sql, /WHERE current_status=ANY\(\$21::text\[\]\)/);
  assert.match(sql, /FROM active\s+WHERE \(\$15::uuid IS NULL OR application_id=\$15\)\s+AND \(\$22::text IS NULL OR current_status=\$22\)/);
  assert.match(sql, /t.organization_id=\$1 AND t.application_id=p.application_id/);
  assert.match(sql, /t.status='OPEN'.*\$13::boolean/);
  assert.match(sql, /AND t.deleted_at IS NULL/);
  assert.match(sql, /due_date >= \$16::date AND due_date < \(\$16::date \+ interval '1 month'\)::date/);
  assert.deepEqual(params.slice(12), [false, [applicationId], applicationId, '2026-07-01', '2026-07-01', null, 10, 'Norte',
   ['IDENTIFIED', 'PREPARATION', 'SUBMITTED'], 'PREPARATION']);
  return { rows: [{
   month_rows: [{ ...task, day_count: 3 }], agenda_rows: Array(11).fill(task), application_rows: [{ application_id: applicationId, title: 'Projeto Norte' }],
  }] };
 }};
 const result = await read(client, { organizationId, authority, clock: { now: () => new Date('2026-06-30T23:30:00Z') }, taskDetailsAvailable: true }, input);
 assert.equal(result.today, '2026-07-01');
 assert.equal(result.days[0].count, 3);
 assert.equal(result.days[0].previews[0].title, 'Rever orçamento');
 assert.equal(result.agenda.length, 10);
 assert.equal(result.agenda[0].status, 'PREPARATION');
 assert.equal(result.hasNextPage, true);
});

test('an unavailable application filter cannot reveal a candidate from another organization', async () => {
 const organizationId = randomUUID(), empty = { all: false, ids: [] };
 const authority = { teamOnly: false, membershipId: randomUUID(), application: empty, opportunity: empty, evaluation: empty, work: empty };
 const client = { async query() { return { rows: [{ month_rows: [], agenda_rows: [], application_rows: [] }] }; } };
 await assert.rejects(read(client, { organizationId, authority, clock: { now: () => new Date() } },
  parse({ month: '2026-11', applicationId: randomUUID() })), { code: 'RESOURCE_NOT_AVAILABLE' });
});
