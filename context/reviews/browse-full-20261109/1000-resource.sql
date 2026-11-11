WITH names AS (SELECT * FROM jsonb_to_recordset($10::jsonb) AS n(id uuid,name text)),
 visible AS (
 SELECT a.*,CASE WHEN a.status='INTENTION' THEN 'IDENTIFIED' ELSE a.status END AS current_status,n.name AS responsible_name,
 CASE WHEN a.central_opportunity_id IS NOT NULL THEN CASE WHEN (a.central_snapshot->>'schemaVersion'='2') THEN a.central_snapshot#>>'{description,title,value}' ELSE a.central_snapshot->>'title' END ELSE o.title END AS opportunity_title,
 CASE WHEN a.central_opportunity_id IS NOT NULL THEN CASE WHEN a.central_snapshot->>'schemaVersion'='2' THEN v2_schedule.final_deadline ELSE a.central_snapshot->>'closingDate' END ELSE o.closing_date::text END AS opportunity_closing_date,
 (SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind IN ('CREATE','TRANSITION') ORDER BY h.revision DESC LIMIT 1) AS status_changed_at,
 (SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind='TRANSITION' AND h.to_status='SUBMITTED' ORDER BY h.revision DESC LIMIT 1) AS last_submitted_at
 FROM opportunity_catalog.application a
 LEFT JOIN opportunity_catalog.opportunity o ON o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
 LEFT JOIN names n ON n.id=a.responsible_membership_id
 CROSS JOIN LATERAL (SELECT COALESCE(a.central_snapshot->>'schemaVersion'='2',false) AS is_v2,
    CASE WHEN a.central_snapshot->>'schemaVersion'='2' THEN COALESCE(CASE WHEN a.central_snapshot#>>'{schedule,deadlines,state}'='PRESENT' THEN a.central_snapshot#>'{schedule,deadlines,value}' ELSE NULL::jsonb END,'[]'::jsonb) ELSE '[]'::jsonb END AS deadlines,
    CASE WHEN a.central_snapshot->>'schemaVersion'='2' THEN CASE WHEN a.central_snapshot#>>'{schedule,opening,state}'='PRESENT' THEN a.central_snapshot#>'{schedule,opening,value}' ELSE NULL::jsonb END ELSE NULL::jsonb END AS opening,
    CASE WHEN a.central_snapshot->>'schemaVersion'='2' THEN CASE WHEN a.central_snapshot#>>'{schedule,plannedOpening,state}'='PRESENT' THEN a.central_snapshot#>'{schedule,plannedOpening,value}' ELSE NULL::jsonb END ELSE NULL::jsonb END AS planned_opening,
    CASE WHEN a.central_snapshot->>'schemaVersion'='2' THEN CASE WHEN a.central_snapshot#>>'{schedule,plannedClosing,state}'='PRESENT' THEN a.central_snapshot#>'{schedule,plannedClosing,value}' ELSE NULL::jsonb END ELSE NULL::jsonb END AS planned_closing,
    CASE WHEN a.central_snapshot#>>'{publication,state}'='PRESENT' THEN a.central_snapshot#>>'{publication,value}' ELSE NULL::text END AS publication,CASE WHEN a.central_snapshot#>>'{status,published,state}'='PRESENT' THEN a.central_snapshot#>>'{status,published,value}' ELSE NULL::text END AS published,CASE WHEN a.central_snapshot#>>'{schedule,deadlineModel,state}'='PRESENT' THEN a.central_snapshot#>>'{schedule,deadlineModel,value}' ELSE NULL::text END AS deadline_model,
    CASE WHEN a.central_snapshot->>'schemaVersion'='2' THEN
      a.central_snapshot#>>'{publication,state}'='CONFLICT'
      OR EXISTS(SELECT 1 FROM jsonb_each(a.central_snapshot->'schedule') AS schedule_field WHERE schedule_field.value->>'state'='CONFLICT')
      OR EXISTS(SELECT 1 FROM jsonb_each(a.central_snapshot->'status') AS status_field WHERE status_field.value->>'state'='CONFLICT')
      ELSE false END AS has_conflict) v2_calendar
  CROSS JOIN LATERAL (SELECT CASE v2_calendar.opening->>'precision' WHEN 'INSTANT' THEN ((make_date(CASE WHEN substring((v2_calendar.opening->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((v2_calendar.opening->>'value') from 1 for 4)::int END,substring((v2_calendar.opening->>'value') from 6 for 2)::int,substring((v2_calendar.opening->>'value') from 9 for 2)::int) + substring((v2_calendar.opening->>'value') from 12 for 12)::time) AT TIME ZONE 'UTC') WHEN 'DATE' THEN (make_date(CASE WHEN substring((v2_calendar.opening->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((v2_calendar.opening->>'value') from 1 for 4)::int END,substring((v2_calendar.opening->>'value') from 6 for 2)::int,substring((v2_calendar.opening->>'value') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') ELSE (make_date(CASE WHEN substring((v2_calendar.opening->>'start') from 1 for 4)::int=0 THEN -1 ELSE substring((v2_calendar.opening->>'start') from 1 for 4)::int END,substring((v2_calendar.opening->>'start') from 6 for 2)::int,substring((v2_calendar.opening->>'start') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') END AS start_at,CASE v2_calendar.opening->>'precision' WHEN 'INSTANT' THEN ((make_date(CASE WHEN substring((v2_calendar.opening->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((v2_calendar.opening->>'value') from 1 for 4)::int END,substring((v2_calendar.opening->>'value') from 6 for 2)::int,substring((v2_calendar.opening->>'value') from 9 for 2)::int) + substring((v2_calendar.opening->>'value') from 12 for 12)::time) AT TIME ZONE 'UTC') WHEN 'DATE' THEN (make_date(CASE WHEN substring((v2_calendar.opening->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((v2_calendar.opening->>'value') from 1 for 4)::int END,substring((v2_calendar.opening->>'value') from 6 for 2)::int,substring((v2_calendar.opening->>'value') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') + interval '24 hours' - interval '1 millisecond' ELSE (make_date(CASE WHEN substring((v2_calendar.opening->>'end') from 1 for 4)::int=0 THEN -1 ELSE substring((v2_calendar.opening->>'end') from 1 for 4)::int END,substring((v2_calendar.opening->>'end') from 6 for 2)::int,substring((v2_calendar.opening->>'end') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') + interval '24 hours' - interval '1 millisecond' END AS end_at) v2_opening_bounds
  CROSS JOIN LATERAL (SELECT CASE WHEN v2_calendar.opening IS NULL THEN NULL::text
    WHEN v2_opening_bounds.start_at>date_trunc('milliseconds',CURRENT_TIMESTAMP) THEN 'FUTURE'
    WHEN v2_calendar.opening->>'precision'='INSTANT' OR v2_opening_bounds.end_at<date_trunc('milliseconds',CURRENT_TIMESTAMP) THEN 'PAST'
    ELSE 'UNCERTAIN' END AS relation) v2_opening
  CROSS JOIN LATERAL (
    WITH entries AS (
      SELECT value AS deadline,ordinality AS ordinal FROM jsonb_array_elements(v2_calendar.deadlines) WITH ORDINALITY
    ), identities AS (
      SELECT deadline,ordinal,jsonb_build_array(deadline#>'{at,precision}',deadline#>'{at,value}',deadline#>'{at,start}',deadline#>'{at,end}',deadline#>'{at,periodKind}',deadline#>'{at,label}',deadline->'phase') AS identity_key FROM entries
    ), unique_deadlines AS (
      SELECT DISTINCT ON(identity_key) deadline FROM identities ORDER BY identity_key,ordinal
    ), moments AS (
      SELECT deadline->'at' AS at,CASE deadline->'at'->>'precision' WHEN 'INSTANT' THEN ((make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int) + substring((deadline->'at'->>'value') from 12 for 12)::time) AT TIME ZONE 'UTC') WHEN 'DATE' THEN (make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') ELSE (make_date(CASE WHEN substring((deadline->'at'->>'start') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'start') from 1 for 4)::int END,substring((deadline->'at'->>'start') from 6 for 2)::int,substring((deadline->'at'->>'start') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') END AS start_at,CASE deadline->'at'->>'precision' WHEN 'INSTANT' THEN ((make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int) + substring((deadline->'at'->>'value') from 12 for 12)::time) AT TIME ZONE 'UTC') WHEN 'DATE' THEN (make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') + interval '24 hours' - interval '1 millisecond' ELSE (make_date(CASE WHEN substring((deadline->'at'->>'end') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'end') from 1 for 4)::int END,substring((deadline->'at'->>'end') from 6 for 2)::int,substring((deadline->'at'->>'end') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') + interval '24 hours' - interval '1 millisecond' END AS end_at FROM unique_deadlines
    ), relations AS (
      SELECT *,CASE WHEN start_at>date_trunc('milliseconds',CURRENT_TIMESTAMP) THEN 'FUTURE' WHEN at->>'precision'='INSTANT' OR end_at<date_trunc('milliseconds',CURRENT_TIMESTAMP) THEN 'PAST' ELSE 'UNCERTAIN' END AS relation FROM moments
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
    ELSE 'UNKNOWN' END AS temporal_state) v2_state
 WHERE a.organization_id=$1
 AND (NOT $2::boolean OR EXISTS(SELECT 1 FROM opportunity_catalog.application_participant p WHERE p.organization_id=a.organization_id AND p.application_id=a.application_id AND p.membership_id=$3 AND p.active))
 AND ($4::boolean OR a.application_id=ANY($5::uuid[]))
 AND ($6::boolean OR COALESCE(a.opportunity_id,a.organization_id)=ANY($7::uuid[]))
 AND (a.evaluation_id IS NULL OR $8::boolean OR a.evaluation_id=ANY($9::uuid[]))
 AND ($11::uuid IS NULL OR a.opportunity_id=$11 OR a.central_opportunity_id=$11)
 ), searched AS (SELECT * FROM visible WHERE $12='' OR strpos(lower(title),lower($12))>0 OR strpos(lower(opportunity_title),lower($12))>0 OR strpos(lower(responsible_name),lower($12))>0), filtered AS (SELECT * FROM searched WHERE $13::text IS NULL OR current_status=$13),
   page AS (SELECT * FROM filtered ORDER BY total_budget ASC NULLS LAST,application_id LIMIT $14 OFFSET $15)
   SELECT (SELECT count(*)::int FROM filtered) AS total,
   (SELECT jsonb_object_agg(status,n) FROM (SELECT current_status AS status,count(*)::int AS n FROM searched GROUP BY current_status) counts) AS counts,
   (SELECT encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex'),'' ORDER BY application_id),''),'UTF8')),'hex') FROM filtered f) AS fingerprint,
   COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY total_budget ASC NULLS LAST,application_id) FROM page),'[]') AS items