'use strict';

// Trusted SQL expressions from application code only. Request values must be
// bound parameters. These aliases are local to one accepted-revision query.
// This mirrors temporal.js: civil bounds are comparison aids, not deadlines.
// ISO astronomical year 0000 is valid in S0. PostgreSQL represents that year as
// 1 BC: make_date accepts -1 for BC, whereas a direct '0000-...' cast rejects it.
function civilDateSql(value) {
  const year=`substring((${value}) from 1 for 4)::int`;
  return `make_date(CASE WHEN ${year}=0 THEN -1 ELSE ${year} END,substring((${value}) from 6 for 2)::int,substring((${value}) from 9 for 2)::int)`;
}
function instantSql(value) {
  // v2 instants have already been validated as canonical UTC with milliseconds.
  return `((${civilDateSql(value)} + substring((${value}) from 12 for 12)::time) AT TIME ZONE 'UTC')`;
}
function bounds(at) {
  const civil = key => `(${civilDateSql(`${at}->>'${key}'`)}::timestamp AT TIME ZONE 'UTC')`;
  return {
    start: `CASE ${at}->>'precision' WHEN 'INSTANT' THEN ${instantSql(`${at}->>'value'`)} WHEN 'DATE' THEN ${civil('value')} ELSE ${civil('start')} END`,
    // Elapsed hours retain UTC bounds even when the PostgreSQL session uses a
    // DST-observing zone. Adding one civil day to timestamptz can mean 23/25h.
    end: `CASE ${at}->>'precision' WHEN 'INSTANT' THEN ${instantSql(`${at}->>'value'`)} WHEN 'DATE' THEN ${civil('value')} + interval '24 hours' - interval '1 millisecond' ELSE ${civil('end')} + interval '24 hours' - interval '1 millisecond' END`
  };
}

function temporalV2Sql({ snapshot='r.snapshot', now='CURRENT_TIMESTAMP' }={}) {
  // JS Date and the canonical read DTO have millisecond precision. PostgreSQL
  // CURRENT_TIMESTAMP may carry microseconds, including at a civil-day boundary.
  const reference=`date_trunc('milliseconds',${now})`;
  const fact = path => `CASE WHEN ${snapshot}#>>'{${path},state}'='PRESENT' THEN ${snapshot}#>'{${path},value}' ELSE NULL::jsonb END`;
  const scalar = path => `CASE WHEN ${snapshot}#>>'{${path},state}'='PRESENT' THEN ${snapshot}#>>'{${path},value}' ELSE NULL::text END`;
  const deadlineBounds = bounds("deadline->'at'"), openingBounds = bounds('v2_calendar.opening');
  return `CROSS JOIN LATERAL (SELECT COALESCE(${snapshot}->>'schemaVersion'='2',false) AS is_v2,
    CASE WHEN ${snapshot}->>'schemaVersion'='2' THEN COALESCE(${fact('schedule,deadlines')},'[]'::jsonb) ELSE '[]'::jsonb END AS deadlines,
    CASE WHEN ${snapshot}->>'schemaVersion'='2' THEN ${fact('schedule,opening')} ELSE NULL::jsonb END AS opening,
    CASE WHEN ${snapshot}->>'schemaVersion'='2' THEN ${fact('schedule,plannedOpening')} ELSE NULL::jsonb END AS planned_opening,
    CASE WHEN ${snapshot}->>'schemaVersion'='2' THEN ${fact('schedule,plannedClosing')} ELSE NULL::jsonb END AS planned_closing,
    ${scalar('publication')} AS publication,${scalar('status,published')} AS published,${scalar('schedule,deadlineModel')} AS deadline_model,
    CASE WHEN ${snapshot}->>'schemaVersion'='2' THEN
      ${snapshot}#>>'{publication,state}'='CONFLICT'
      OR EXISTS(SELECT 1 FROM jsonb_each(${snapshot}->'schedule') AS schedule_field WHERE schedule_field.value->>'state'='CONFLICT')
      OR EXISTS(SELECT 1 FROM jsonb_each(${snapshot}->'status') AS status_field WHERE status_field.value->>'state'='CONFLICT')
      ELSE false END AS has_conflict) v2_calendar
  CROSS JOIN LATERAL (SELECT ${openingBounds.start} AS start_at,${openingBounds.end} AS end_at) v2_opening_bounds
  CROSS JOIN LATERAL (SELECT CASE WHEN v2_calendar.opening IS NULL THEN NULL::text
    WHEN v2_opening_bounds.start_at>${reference} THEN 'FUTURE'
    WHEN v2_calendar.opening->>'precision'='INSTANT' OR v2_opening_bounds.end_at<${reference} THEN 'PAST'
    ELSE 'UNCERTAIN' END AS relation) v2_opening
  CROSS JOIN LATERAL (
    WITH entries AS (
      SELECT value AS deadline,ordinality AS ordinal FROM jsonb_array_elements(v2_calendar.deadlines) WITH ORDINALITY
    ), identities AS (
      SELECT deadline,ordinal,jsonb_build_array(deadline#>'{at,precision}',deadline#>'{at,value}',deadline#>'{at,start}',deadline#>'{at,end}',deadline#>'{at,periodKind}',deadline#>'{at,label}',deadline->'phase') AS identity_key FROM entries
    ), unique_deadlines AS (
      SELECT DISTINCT ON(identity_key) deadline FROM identities ORDER BY identity_key,ordinal
    ), moments AS (
      SELECT deadline->'at' AS at,${deadlineBounds.start} AS start_at,${deadlineBounds.end} AS end_at FROM unique_deadlines
    ), relations AS (
      SELECT *,CASE WHEN start_at>${reference} THEN 'FUTURE' WHEN at->>'precision'='INSTANT' OR end_at<${reference} THEN 'PAST' ELSE 'UNCERTAIN' END AS relation FROM moments
    ), pending AS (
      SELECT * FROM relations WHERE relation<>'PAST'
    ), next_candidates AS (
      SELECT candidate.* FROM pending candidate WHERE NOT EXISTS(SELECT 1 FROM pending other WHERE other.end_at < candidate.start_at)
    ), final_candidates AS (
      SELECT candidate.* FROM relations candidate WHERE NOT EXISTS(SELECT 1 FROM relations other WHERE other.start_at > candidate.end_at)
    ) SELECT
      (SELECT count(*)::int FROM moments) AS deadline_count,
      (SELECT count(*)::int FROM pending) AS pending_count,
      (SELECT count(*)::int FROM next_candidates) AS next_candidate_count,
      (SELECT count(*)::int FROM pending WHERE relation='UNCERTAIN') AS uncertain_count,
      CASE WHEN (SELECT count(*) FROM next_candidates)=1 THEN (SELECT at->>'value' FROM next_candidates WHERE relation='FUTURE') ELSE NULL::text END AS next_deadline,
      CASE WHEN (SELECT count(*) FROM next_candidates)=1 THEN (SELECT at FROM next_candidates WHERE relation='FUTURE') ELSE NULL::jsonb END AS next_deadline_at,
      CASE WHEN (SELECT count(*) FROM final_candidates)=1 THEN (SELECT at->>'value' FROM final_candidates) ELSE NULL::text END AS final_deadline,
      CASE WHEN (SELECT count(*) FROM final_candidates)=1 THEN (SELECT at FROM final_candidates) ELSE NULL::jsonb END AS final_deadline_at
    ) v2_schedule
  CROSS JOIN LATERAL (SELECT CASE
    WHEN v2_calendar.has_conflict THEN 'UNKNOWN'
    WHEN v2_calendar.published IN ('CANCELLED','CLOSED') THEN v2_calendar.published
    WHEN v2_calendar.publication='PLANNED' THEN 'PLANNED'
    WHEN v2_calendar.publication IS DISTINCT FROM 'PUBLISHED' THEN 'UNKNOWN'
    WHEN v2_opening.relation='FUTURE' THEN 'UPCOMING'
    WHEN v2_schedule.uncertain_count>0 THEN 'UNKNOWN'
    WHEN v2_schedule.deadline_count>0 AND v2_schedule.pending_count=0 AND v2_calendar.deadline_model IS DISTINCT FROM 'CONTINUOUS' THEN 'CLOSED'
    WHEN v2_opening.relation='PAST' AND v2_schedule.pending_count>0 THEN 'OPEN'
    WHEN v2_calendar.published='OPEN' THEN 'OPEN'
    ELSE 'UNKNOWN' END AS temporal_state) v2_state`;
}

// Frozen application lists need only the final factual deadline. Keep the same
// identity/deduplication and interval ordering as temporalV2Sql; do not compile
// opening, pending/next deadlines or current publication state for this read.
function finalDeadlineV2Sql({snapshot='r.snapshot'}={}) {
  const deadlineBounds=bounds("deadline->'at'");
  const deadlines=`CASE WHEN ${snapshot}->>'schemaVersion'='2' AND ${snapshot}#>>'{schedule,deadlines,state}'='PRESENT' THEN COALESCE(${snapshot}#>'{schedule,deadlines,value}','[]'::jsonb) ELSE '[]'::jsonb END`;
  return `CROSS JOIN LATERAL (
    WITH entries AS (
      SELECT value AS deadline,ordinality AS ordinal FROM jsonb_array_elements(${deadlines}) WITH ORDINALITY
    ), identities AS (
      SELECT deadline,ordinal,jsonb_build_array(deadline#>'{at,precision}',deadline#>'{at,value}',deadline#>'{at,start}',deadline#>'{at,end}',deadline#>'{at,periodKind}',deadline#>'{at,label}',deadline->'phase') AS identity_key FROM entries
    ), unique_deadlines AS (
      SELECT DISTINCT ON(identity_key) deadline FROM identities ORDER BY identity_key,ordinal
    ), moments AS (
      SELECT deadline->'at' AS at,${deadlineBounds.start} AS start_at,${deadlineBounds.end} AS end_at FROM unique_deadlines
    ), final_candidates AS (
      SELECT candidate.* FROM moments candidate WHERE NOT EXISTS(SELECT 1 FROM moments other WHERE other.start_at > candidate.end_at)
    ) SELECT
      CASE WHEN (SELECT count(*) FROM final_candidates)=1 THEN (SELECT at->>'value' FROM final_candidates) ELSE NULL::text END AS final_deadline,
      CASE WHEN (SELECT count(*) FROM final_candidates)=1 THEN (SELECT at FROM final_candidates) ELSE NULL::jsonb END AS final_deadline_at
    ) v2_schedule`;
}

module.exports={temporalV2Sql,finalDeadlineV2Sql,civilDateSql,instantSql};
