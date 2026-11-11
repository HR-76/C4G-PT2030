'use strict';

// Sort the civil day shown in the card. Periods and ambiguous cutoffs
// have no single day; the UI invites the user to consult those records.
const closingDay = `CASE
  WHEN v2_calendar.publication='PLANNED' THEN left(v2_calendar.planned_closing->>'value',10)
  WHEN v2_calendar.is_v2 AND v2_schedule.next_candidate_count>1 THEN NULL
  WHEN v2_calendar.is_v2 THEN left(coalesce(v2_schedule.next_deadline_at,v2_schedule.final_deadline_at)->>'value',10)
  ELSE (SELECT to_char(CASE WHEN length(value)=10 THEN value::date
         ELSE (value::timestamptz AT TIME ZONE 'UTC')::date END,'YYYY-MM-DD')
        FROM jsonb_array_elements_text(legacy_dates.deadlines)
        ORDER BY (value=legacy_schedule.next_deadline) DESC NULLS LAST,
                 value::timestamptz DESC LIMIT 1)
  END`;

// A range of support per beneficiary is not an allocation for the call.
// Keep currencies separate and leave composite or incomplete budgets last.
const allocationJoin = `CROSS JOIN LATERAL (SELECT CASE
  WHEN r.snapshot#>>'{financing,allocations,state}'='PRESENT'
    AND jsonb_array_length(r.snapshot#>'{financing,allocations,value}')=1
    THEN r.snapshot#>'{financing,allocations,value,0,money}'
  WHEN r.snapshot#>>'{sourceEnrichment,fields,budget,status}'='PUBLISHED'
    AND (r.snapshot#>>'{sourceEnrichment,fields,budget,truncated}') IS DISTINCT FROM 'true'
    AND jsonb_array_length(r.snapshot#>'{sourceEnrichment,fields,budget,items}')=1
    THEN r.snapshot#>'{sourceEnrichment,fields,budget,items,0,value}'
  END AS money) allocation`;

function catalogSortSql(sort) {
  const direction = sort.endsWith('_desc') ? 'DESC' : 'ASC';
  if (sort.startsWith('closing_')) return {order: `${closingDay} ${direction} NULLS LAST`, extraJoin:''};
  return {
    extraJoin: allocationJoin,
    order: `(allocation.money->>'amount' IS NULL),
      coalesce(allocation.money#>>'{currency,value}', CASE WHEN jsonb_typeof(allocation.money->'currency')='string' THEN allocation.money->>'currency' END) ASC NULLS LAST,
      (allocation.money->>'amount')::numeric ${direction} NULLS LAST`,
  };
}
module.exports = {catalogSortSql};
