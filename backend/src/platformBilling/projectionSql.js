'use strict';
const projectionCte = `
WITH payment_totals AS (
 SELECT billing_document_id,
  COALESCE(sum(CASE record_type WHEN 'PAYMENT' THEN amount ELSE -amount END),0) AS paid_amount,
  count(*) FILTER (WHERE record_type='PAYMENT') AS payment_count,
  count(*) FILTER (WHERE record_type='REVERSAL') AS reversal_count
 FROM public.billing_payment_record GROUP BY billing_document_id
), adjustment_totals AS (
 SELECT corrects_document_id AS billing_document_id,
  COALESCE(sum(total) FILTER (WHERE document_type='CREDIT_NOTE' AND state<>'CANCELLED'),0) AS credit_amount,
  COALESCE(sum(total) FILTER (WHERE document_type='DEBIT_NOTE' AND state<>'CANCELLED'),0) AS debit_amount
 FROM public.billing_fiscal_document WHERE corrects_document_id IS NOT NULL GROUP BY corrects_document_id
), cycle_financials AS (
 SELECT c.*,o.display_name AS organization_name,o.legal_name AS organization_legal_name,
  d.id AS document_id,d.document_type,d.document_number,d.issue_date,d.due_date AS document_due_date,
  d.state AS document_state,d.revision AS document_revision,
  CASE WHEN d.id IS NULL OR d.state='CANCELLED' THEN 0
   ELSE d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0) END AS adjusted_total,
  CASE WHEN d.id IS NULL OR d.state='CANCELLED' THEN 0 ELSE COALESCE(p.paid_amount,0) END AS paid_amount,
  COALESCE(a.credit_amount,0) AS credit_amount,COALESCE(a.debit_amount,0) AS debit_amount,
  COALESCE(p.payment_count,0) AS payment_count,COALESCE(p.reversal_count,0) AS reversal_count
 FROM public.billing_cycle c JOIN public.organization o ON o.id=c.organization_id
 LEFT JOIN public.billing_fiscal_document d ON d.billing_cycle_id=c.id
  AND d.document_type IN ('INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT')
 LEFT JOIN payment_totals p ON p.billing_document_id=d.id
 LEFT JOIN adjustment_totals a ON a.billing_document_id=d.id
), cycle_projection AS (
 SELECT f.*,GREATEST(f.adjusted_total-f.paid_amount,0) AS balance_amount,
  CASE WHEN f.paid_amount=0 AND f.payment_count>0 AND f.reversal_count>0 THEN 'REVERSED'
   WHEN f.paid_amount=0 THEN 'UNPAID'
   WHEN GREATEST(f.adjusted_total-f.paid_amount,0)=0 THEN 'PAID'
   ELSE 'PARTIALLY_PAID' END AS payment_state
 FROM cycle_financials f
)
`;
module.exports={projectionCte};
