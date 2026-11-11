'use strict';
async function dashboard(c,logs){
 const activity=logs?`(SELECT jsonb_build_object('logins30',count(*) FILTER(WHERE code='LOGIN'),
 'users30',count(DISTINCT global_user_id) FILTER(WHERE code='LOGIN'),
 'errors24',count(*) FILTER(WHERE code<>'LOGIN' AND occurred_at>=now()-interval '24 hours'))
 FROM public.platform_support_event WHERE occurred_at>=now()-interval '30 days' AND occurred_at<=now())`:'NULL';
 const coverage=logs?`(SELECT applied_at FROM public.c4g_schema_migration WHERE version='026_platform_logs')`:'NULL';
 const result=(await c.query(`SELECT now() AS "observedAt",
 (SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE status='ACTIVE')) FROM public.organization) AS entities,
 (SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE status='ACTIVE')) FROM public.global_user) AS users,
 (SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE lifecycle_state='ACTIVE'),
 'stale',count(*) FILTER(WHERE lifecycle_state='STALE'),'draft',count(*) FILTER(WHERE lifecycle_state='DRAFT'),
 'archived',count(*) FILTER(WHERE lifecycle_state='ARCHIVED')) FROM opportunity_catalog.opportunity) AS opportunities,
 ${activity} AS activity, ${coverage} AS "coverageStart",
 COALESCE((SELECT jsonb_agg(r) FROM (SELECT id,display_name AS name,status,created_at AS "createdAt"
 FROM public.organization ORDER BY created_at DESC,id DESC LIMIT 5) r),'[]') AS "recentEntities"`)).rows[0];
 return {...result,collection:logs?.status()||null};
}
module.exports={dashboard};
