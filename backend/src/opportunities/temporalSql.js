'use strict';
const {temporalV2Sql}=require('./v2/temporalSql');
// Trusted SQL fragments only. Request values remain query parameters.
function temporalSql({snapshot='r.snapshot',corrections="'{}'::jsonb",sourceReview='NULL::text',now='CURRENT_TIMESTAMP',today='$1::date'}={}){
 const metadata=`${snapshot}->'sourceTemporal'`;
 const deadlines=`CASE WHEN NOT (${corrections} ? 'closingDate') AND jsonb_array_length(COALESCE(${metadata}->'deadlines','[]'::jsonb))>0 THEN ${metadata}->'deadlines' WHEN o.closing_date IS NOT NULL THEN jsonb_build_array(o.closing_date::text) ELSE '[]'::jsonb END`;
 const openings=`CASE WHEN NOT (${corrections} ? 'openingDate') AND jsonb_array_length(COALESCE(${metadata}->'openings','[]'::jsonb))>0 THEN ${metadata}->'openings' WHEN o.opening_date IS NOT NULL THEN jsonb_build_array(o.opening_date::text) ELSE '[]'::jsonb END`;
 return `CROSS JOIN LATERAL (SELECT ${deadlines} AS deadlines,${openings} AS openings,${metadata}->>'status' AS published) legacy_dates
 CROSS JOIN LATERAL (SELECT (SELECT value FROM jsonb_array_elements_text(legacy_dates.deadlines) WHERE CASE WHEN length(value)=10 THEN value::date>=${today} ELSE value::timestamptz>${now} END ORDER BY CASE WHEN length(value)=10 THEN value::date::timestamp AT TIME ZONE 'UTC' ELSE value::timestamptz END LIMIT 1) AS next_deadline,
 (SELECT value FROM jsonb_array_elements_text(legacy_dates.openings) ORDER BY CASE WHEN length(value)=10 THEN value::date::timestamp AT TIME ZONE 'UTC' ELSE value::timestamptz END LIMIT 1) AS opening) legacy_schedule
 CROSS JOIN LATERAL (SELECT CASE WHEN ${sourceReview} IS NOT NULL THEN 'UNKNOWN' WHEN legacy_dates.published IN ('CANCELLED','CLOSED') THEN legacy_dates.published
 WHEN jsonb_array_length(legacy_dates.deadlines)>0 AND legacy_schedule.next_deadline IS NULL THEN 'CLOSED'
 WHEN CASE WHEN length(legacy_schedule.opening)=10 THEN legacy_schedule.opening::date>${today} ELSE legacy_schedule.opening::timestamptz>${now} END THEN 'UPCOMING'
 WHEN legacy_dates.published='UPCOMING' AND legacy_schedule.opening IS NULL THEN 'UPCOMING'
 WHEN legacy_schedule.next_deadline IS NOT NULL THEN 'OPEN' ELSE 'UNKNOWN' END AS temporal_state) legacy_temporal
 ${temporalV2Sql({snapshot,now})}
 CROSS JOIN LATERAL (SELECT CASE WHEN v2_calendar.is_v2 THEN v2_calendar.deadlines ELSE legacy_dates.deadlines END AS deadlines,
   CASE WHEN v2_calendar.is_v2 THEN CASE WHEN v2_calendar.opening IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v2_calendar.opening) END ELSE legacy_dates.openings END AS openings,
   CASE WHEN v2_calendar.is_v2 THEN v2_calendar.published ELSE legacy_dates.published END AS published) dates
 CROSS JOIN LATERAL (SELECT CASE WHEN v2_calendar.is_v2 THEN v2_schedule.next_deadline ELSE legacy_schedule.next_deadline END AS next_deadline,
   CASE WHEN v2_calendar.is_v2 THEN v2_calendar.opening->>'value' ELSE legacy_schedule.opening END AS opening,
   v2_schedule.next_deadline_at,v2_schedule.final_deadline,v2_schedule.final_deadline_at,
   v2_calendar.planned_opening AS planned_opening_at,v2_calendar.planned_closing AS planned_closing_at) schedule
 CROSS JOIN LATERAL (SELECT CASE WHEN ${sourceReview} IS NOT NULL THEN 'UNKNOWN'
   WHEN v2_calendar.is_v2 THEN v2_state.temporal_state ELSE legacy_temporal.temporal_state END AS temporal_state) temporal`;
}
module.exports={temporalSql};
