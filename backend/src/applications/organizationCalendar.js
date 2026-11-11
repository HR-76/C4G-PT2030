'use strict';
const { fail, uuid } = require('./contracts');
const { selection } = require('./browseSql');

const PAGE_SIZE = 10;
const APPLICATION_OPTIONS = 50;
const ACTIVE_STATUSES = ['IDENTIFIED', 'PREPARATION', 'SUBMITTED'];

function parse(value) {
 const keys = ['month', 'applicationId', 'applicationQ', 'status', 'day', 'page'];
 if (!value || Object.keys(value).some(key => !keys.includes(key))) fail();
 const { month, day, applicationId, applicationQ = '', status, page = '1' } = value;
 if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) fail();
 if (typeof applicationQ !== 'string' || applicationQ.length > 200 || applicationQ.includes('\0')) fail();
 if (status !== undefined && !ACTIVE_STATUSES.includes(status)) fail();
 if (typeof page !== 'string' || !/^[1-9]\d{0,3}$/.test(page) || Number(page) > 1000) fail();
 if (day !== undefined) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day.slice(0, 7) !== month) fail();
  const date = new Date(day + 'T12:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) fail();
 }
 return { month, day: day ?? null, applicationId: applicationId === undefined ? null : uuid(applicationId),
  applicationQ: applicationQ.trim(), page: Number(page), status: status ?? null };
}

function event(row) {
 return {
  id: row.event_key, date: row.due_date, title: row.event_title, taskId: row.task_id,
  applicationId: row.application_id, applicationTitle: row.application_title, status: row.current_status,
 };
}

async function read(client, { organizationId, authority, clock, taskDetailsAvailable }, input) {
 const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock.now());
 const { sql, params } = selection(organizationId, authority, new Map(), {});
 const offset = (input.page - 1) * PAGE_SIZE;
 const result = (await client.query(`${sql}, active AS (
  SELECT application_id,title,deadline,current_status FROM searched
  WHERE current_status=ANY($21::text[])
 ), projects AS (
  SELECT * FROM active
  WHERE ($15::uuid IS NULL OR application_id=$15)
   AND ($22::text IS NULL OR current_status=$22)
 ), events AS NOT MATERIALIZED (
  SELECT 'application:'||application_id AS event_key, deadline AS due_date, title AS event_title,
   NULL::uuid AS task_id, application_id, title AS application_title, current_status
  FROM projects WHERE deadline IS NOT NULL
  UNION ALL
  SELECT 'task:'||t.task_id, t.deadline, t.title, t.task_id, p.application_id, p.title, p.current_status
  FROM projects p JOIN opportunity_catalog.application_task t
   ON t.organization_id=$1 AND t.application_id=p.application_id
  WHERE t.status='OPEN' AND ($13::boolean OR p.application_id=ANY($14::uuid[]))
   ${taskDetailsAvailable ? 'AND t.deleted_at IS NULL' : ''}
 ), ranked AS (
  SELECT events.*, count(*) OVER (PARTITION BY due_date)::int AS day_count,
   row_number() OVER (PARTITION BY due_date ORDER BY event_key) AS position
  FROM events WHERE due_date >= $16::date AND due_date < ($16::date + interval '1 month')::date
 ), agenda AS (
  SELECT * FROM events
  WHERE CASE WHEN $18::date IS NULL THEN due_date >= $17::date ELSE due_date=$18::date END
  ORDER BY due_date,event_key LIMIT ${PAGE_SIZE + 1} OFFSET $19
 ), options AS (
  SELECT application_id,title,application_id=$15::uuid AS selected FROM active
  WHERE $20='' OR strpos(lower(title),lower($20))>0 OR application_id=$15::uuid
  ORDER BY selected DESC NULLS LAST,lower(title),application_id LIMIT ${APPLICATION_OPTIONS + 1}
 )
 SELECT COALESCE((SELECT jsonb_agg(to_jsonb(ranked) ORDER BY due_date,position) FROM ranked WHERE position<=2),'[]') AS month_rows,
  COALESCE((SELECT jsonb_agg(to_jsonb(agenda) ORDER BY due_date,event_key) FROM agenda),'[]') AS agenda_rows,
  COALESCE((SELECT jsonb_agg(to_jsonb(options) ORDER BY selected DESC NULLS LAST,lower(title),application_id) FROM options),'[]') AS application_rows`,
 [...params, authority.work.all, authority.work.ids, input.applicationId, input.month + '-01', today, input.day, offset,
  input.applicationQ, ACTIVE_STATUSES, input.status])).rows[0];

 if (!result || ![result.month_rows, result.agenda_rows, result.application_rows].every(Array.isArray)) fail('SERVICE_UNAVAILABLE');
 if (input.applicationId && !result.application_rows.some(row => row.application_id === input.applicationId)) fail('RESOURCE_NOT_AVAILABLE');
 const days = new Map();
 for (const row of result.month_rows) {
  if (!days.has(row.due_date)) days.set(row.due_date, { date: row.due_date, count: row.day_count, previews: [] });
  days.get(row.due_date).previews.push(event(row));
 }
 return {
  today, days: [...days.values()],
  agenda: result.agenda_rows.slice(0, PAGE_SIZE).map(event),
  hasNextPage: input.page < 1000 && result.agenda_rows.length > PAGE_SIZE,
  applications: result.application_rows.slice(0, APPLICATION_OPTIONS).map(row => ({ id: row.application_id, title: row.title })),
  hasMoreApplications: result.application_rows.length > APPLICATION_OPTIONS,
 };
}

module.exports = { parse, read };
