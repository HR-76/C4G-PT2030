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
 CROSS JOIN LATERAL (
    WITH entries AS (
      SELECT value AS deadline,ordinality AS ordinal FROM jsonb_array_elements(CASE WHEN a.central_snapshot->>'schemaVersion'='2' AND a.central_snapshot#>>'{schedule,deadlines,state}'='PRESENT' THEN COALESCE(a.central_snapshot#>'{schedule,deadlines,value}','[]'::jsonb) ELSE '[]'::jsonb END) WITH ORDINALITY
    ), identities AS (
      SELECT deadline,ordinal,jsonb_build_array(deadline#>'{at,precision}',deadline#>'{at,value}',deadline#>'{at,start}',deadline#>'{at,end}',deadline#>'{at,periodKind}',deadline#>'{at,label}',deadline->'phase') AS identity_key FROM entries
    ), unique_deadlines AS (
      SELECT DISTINCT ON(identity_key) deadline FROM identities ORDER BY identity_key,ordinal
    ), moments AS (
      SELECT deadline->'at' AS at,CASE deadline->'at'->>'precision' WHEN 'INSTANT' THEN ((make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int) + substring((deadline->'at'->>'value') from 12 for 12)::time) AT TIME ZONE 'UTC') WHEN 'DATE' THEN (make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') ELSE (make_date(CASE WHEN substring((deadline->'at'->>'start') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'start') from 1 for 4)::int END,substring((deadline->'at'->>'start') from 6 for 2)::int,substring((deadline->'at'->>'start') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') END AS start_at,CASE deadline->'at'->>'precision' WHEN 'INSTANT' THEN ((make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int) + substring((deadline->'at'->>'value') from 12 for 12)::time) AT TIME ZONE 'UTC') WHEN 'DATE' THEN (make_date(CASE WHEN substring((deadline->'at'->>'value') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'value') from 1 for 4)::int END,substring((deadline->'at'->>'value') from 6 for 2)::int,substring((deadline->'at'->>'value') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') + interval '24 hours' - interval '1 millisecond' ELSE (make_date(CASE WHEN substring((deadline->'at'->>'end') from 1 for 4)::int=0 THEN -1 ELSE substring((deadline->'at'->>'end') from 1 for 4)::int END,substring((deadline->'at'->>'end') from 6 for 2)::int,substring((deadline->'at'->>'end') from 9 for 2)::int)::timestamp AT TIME ZONE 'UTC') + interval '24 hours' - interval '1 millisecond' END AS end_at FROM unique_deadlines
    ), final_candidates AS (
      SELECT candidate.* FROM moments candidate WHERE NOT EXISTS(SELECT 1 FROM moments other WHERE other.start_at > candidate.end_at)
    ) SELECT
      CASE WHEN (SELECT count(*) FROM final_candidates)=1 THEN (SELECT at->>'value' FROM final_candidates) ELSE NULL::text END AS final_deadline,
      CASE WHEN (SELECT count(*) FROM final_candidates)=1 THEN (SELECT at FROM final_candidates) ELSE NULL::jsonb END AS final_deadline_at
    ) v2_schedule
 WHERE a.organization_id=$1
 AND (NOT $2::boolean OR EXISTS(SELECT 1 FROM opportunity_catalog.application_participant p WHERE p.organization_id=a.organization_id AND p.application_id=a.application_id AND p.membership_id=$3 AND p.active))
 AND ($4::boolean OR a.application_id=ANY($5::uuid[]))
 AND ($6::boolean OR COALESCE(a.opportunity_id,a.organization_id)=ANY($7::uuid[]))
 AND (a.evaluation_id IS NULL OR $8::boolean OR a.evaluation_id=ANY($9::uuid[]))
 AND ($11::uuid IS NULL OR a.opportunity_id=$11 OR a.central_opportunity_id=$11) AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.application_unit au WHERE au.organization_id=a.organization_id AND au.application_id=a.application_id AND au.active)
 ), searched AS (SELECT * FROM visible WHERE $12='' OR strpos(lower(title),lower($12))>0 OR strpos(lower(opportunity_title),lower($12))>0 OR strpos(lower(responsible_name),lower($12))>0), filtered AS (SELECT * FROM searched WHERE $13::text IS NULL OR current_status=$13),
   page AS (SELECT * FROM filtered ORDER BY lower(title) ASC NULLS LAST,application_id LIMIT $14 OFFSET $15)
   SELECT (SELECT count(*)::int FROM filtered) AS total,
   (SELECT jsonb_object_agg(status,n) FROM (SELECT current_status AS status,count(*)::int AS n FROM searched GROUP BY current_status) counts) AS counts,
   (SELECT encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex'),'' ORDER BY application_id),''),'UTF8')),'hex') FROM filtered f) AS fingerprint,
   COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(title) ASC NULLS LAST,application_id) FROM page),'[]') AS items