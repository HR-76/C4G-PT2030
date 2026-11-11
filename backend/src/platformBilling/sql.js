'use strict';

// These strings are an authority boundary. Keep values in parameters and keep
// every write in this module synchronized with migration 027's closed executor.
const normalize = statement => statement.replace(/\s+/g, ' ').trim();
const {projectionCte}=require('./projectionSql');

module.exports = Object.freeze({
  readAdmin: normalize(`SELECT u.id FROM public.application_session s
    JOIN public.global_user u ON u.id=s.global_user_id
    JOIN public.platform_admin_assignment a ON a.global_user_id=u.id
    WHERE s.sid=$1 AND u.id=$2 AND s.status='ACTIVE' AND s.expires_at>clock_timestamp()
    AND s.revocation_version=u.session_revocation_version AND u.status='ACTIVE'
    AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE'`),
  cycleOrganization: 'SELECT organization_id FROM public.billing_cycle WHERE id=$1',
  documentOrganization: 'SELECT organization_id FROM public.billing_fiscal_document WHERE id=$1',
  paymentOrganization: 'SELECT organization_id FROM public.billing_payment_record WHERE id=$1',
  organizationAvailable: "SELECT id FROM public.organization WHERE id=$1 AND status='ACTIVE' FOR SHARE",
  receiptByKey: 'SELECT intent_digest,result_projection FROM public.billing_command_receipt WHERE organization_id=$1 AND operation_code=$2 AND request_key=$3',
  accountByOrganizationForUpdate: 'SELECT * FROM public.billing_account WHERE organization_id=$1 FOR UPDATE',
  accountVersionById: 'SELECT * FROM public.billing_account_version WHERE id=$1 AND organization_id=$2',
  insertAccount: 'INSERT INTO public.billing_account(id,organization_id,current_version,revision) VALUES($1,$2,1,1) RETURNING *',
  insertAccountVersion: 'INSERT INTO public.billing_account_version(id,billing_account_id,organization_id,version,legal_name,tax_country,tax_identifier,address_line_1,address_line_2,postal_code,locality,region,billing_email,contact_name,external_source,external_customer_ref,payment_terms_days,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *',
  updateAccountHead: 'UPDATE public.billing_account SET current_version=$3,revision=$3,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$4 RETURNING *',
  insertCycle: 'INSERT INTO public.billing_cycle(id,organization_id,account_version_id,period_start,period_end,service_description,currency,amount,planned_issue_date,due_date,contract_reference,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *',
  cycleForUpdate: 'SELECT * FROM public.billing_cycle WHERE id=$1 AND organization_id=$2 FOR UPDATE',
  updateCycle: 'UPDATE public.billing_cycle SET account_version_id=$3,period_start=$4,period_end=$5,service_description=$6,currency=$7,amount=$8,planned_issue_date=$9,due_date=$10,contract_reference=$11,notes=$12,revision=revision+1,updated_by=$13,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$14 AND state=\'DRAFT\' RETURNING *',
  transitionCycle: 'UPDATE public.billing_cycle SET state=$3,revision=revision+1,updated_by=$4,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$5 RETURNING *',
  insertCycleRevision: 'INSERT INTO public.billing_cycle_revision(billing_cycle_id,organization_id,revision,account_version_id,period_start,period_end,service_description,currency,amount,planned_issue_date,due_date,contract_reference,notes,state,changed_by,change_reason) SELECT id,organization_id,revision,account_version_id,period_start,period_end,service_description,currency,amount,planned_issue_date,due_date,contract_reference,notes,state,$2,$3 FROM public.billing_cycle WHERE id=$1 RETURNING *',
  insertDocument: 'INSERT INTO public.billing_fiscal_document(id,billing_cycle_id,organization_id,source_code,issuer_reference,document_type,document_number,external_document_id,issue_date,due_date,currency,subtotal,tax_total,total,corrects_document_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *',
  documentById: 'SELECT * FROM public.billing_fiscal_document WHERE id=$1 AND organization_id=$2',
  documentForUpdate: 'SELECT * FROM public.billing_fiscal_document WHERE id=$1 AND organization_id=$2 FOR UPDATE',
  documentAdjustments: "SELECT COALESCE(sum(total) FILTER (WHERE document_type='CREDIT_NOTE' AND state<>'CANCELLED'),0)::text AS credit_amount,COALESCE(sum(total) FILTER (WHERE document_type='DEBIT_NOTE' AND state<>'CANCELLED'),0)::text AS debit_amount FROM public.billing_fiscal_document WHERE corrects_document_id=$1 AND organization_id=$2",
  transitionDocument: 'UPDATE public.billing_fiscal_document SET state=$3,revision=revision+1,updated_by=$4,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND revision=$5 RETURNING *',
  insertDocumentRevision: 'INSERT INTO public.billing_fiscal_document_revision(billing_document_id,organization_id,revision,state,reason,changed_by) SELECT id,organization_id,revision,state,$2,$3 FROM public.billing_fiscal_document WHERE id=$1 RETURNING *',
  insertPayment: 'INSERT INTO public.billing_payment_record(id,organization_id,billing_document_id,record_type,reverses_payment_id,amount,currency,effective_on,method_code,external_reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
  paymentById: 'SELECT p.*,d.billing_cycle_id,d.document_type,d.state AS document_state FROM public.billing_payment_record p JOIN public.billing_fiscal_document d ON d.id=p.billing_document_id AND d.organization_id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2',
  paymentForUpdate: 'SELECT * FROM public.billing_payment_record WHERE id=$1 AND organization_id=$2 FOR UPDATE',
  documentBalance: "SELECT (d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0))::text AS total,COALESCE(p.paid_amount,0)::text AS paid_amount,(d.total+COALESCE(a.debit_amount,0)-COALESCE(a.credit_amount,0)-COALESCE(p.paid_amount,0))::text AS balance_amount,COALESCE(p.payment_count,0)::text AS payment_count,COALESCE(p.reversal_count,0)::text AS reversal_count FROM public.billing_fiscal_document d LEFT JOIN (SELECT billing_document_id,sum(CASE record_type WHEN 'PAYMENT' THEN amount ELSE -amount END) AS paid_amount,count(*) FILTER (WHERE record_type='PAYMENT') AS payment_count,count(*) FILTER (WHERE record_type='REVERSAL') AS reversal_count FROM public.billing_payment_record GROUP BY billing_document_id) p ON p.billing_document_id=d.id LEFT JOIN (SELECT corrects_document_id,sum(total) FILTER (WHERE document_type='CREDIT_NOTE' AND state<>'CANCELLED') AS credit_amount,sum(total) FILTER (WHERE document_type='DEBIT_NOTE' AND state<>'CANCELLED') AS debit_amount FROM public.billing_fiscal_document GROUP BY corrects_document_id) a ON a.corrects_document_id=d.id WHERE d.id=$1 AND d.organization_id=$2",
  insertActivity: 'INSERT INTO public.billing_activity(organization_id,operation_code,actor_id,event_code,resource_type,resource_id,previous_revision,new_revision,detail_code,correlation_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,occurred_at',
  insertReceipt: 'INSERT INTO public.billing_command_receipt(organization_id,operation_code,request_key,actor_id,intent_digest,result_projection) VALUES($1,$2,$3,$4,$5,$6) RETURNING result_projection',
  summary: normalize(`${projectionCte}
    SELECT currency,
     COALESCE(sum(adjusted_total) FILTER (WHERE document_id IS NOT NULL),0)::text AS billed_amount,
     COALESCE(sum(paid_amount),0)::text AS received_amount,
     COALESCE(sum(balance_amount),0)::text AS outstanding_amount,
     COALESCE(sum(balance_amount) FILTER (WHERE document_state='ISSUED' AND document_due_date<$4::date),0)::text AS overdue_amount,
     count(document_id)::text AS document_count,
     count(DISTINCT organization_id) FILTER (WHERE balance_amount>0)::text AS organizations_with_balance
    FROM cycle_projection
    WHERE ($1::date IS NULL OR period_end>=$1) AND ($2::date IS NULL OR period_start<=$2)
     AND ($3::text IS NULL OR currency=$3)
    GROUP BY currency ORDER BY currency`),
  cyclesCount: normalize(`${projectionCte}
    SELECT count(*)::text AS total FROM cycle_projection
    WHERE ($1='' OR strpos(lower(organization_name),lower($1))>0
      OR strpos(lower(organization_legal_name),lower($1))>0
      OR strpos(lower(COALESCE(document_number,'')),lower($1))>0
      OR strpos(lower(COALESCE(contract_reference,'')),lower($1))>0)
     AND ($2::uuid IS NULL OR organization_id=$2)
     AND ($3::date IS NULL OR period_end>=$3) AND ($4::date IS NULL OR period_start<=$4)
     AND ($5::text IS NULL OR state=$5) AND ($6::text IS NULL OR payment_state=$6)
     AND ($7::boolean IS NULL OR (document_state='ISSUED' AND balance_amount>0 AND document_due_date<$9::date)=$7)
     AND ($8::text IS NULL OR currency=$8)`),
  cyclesList: normalize(`${projectionCte}
    SELECT id AS cycle_id,organization_id,organization_name,organization_legal_name,
     account_version_id,period_start,period_end,service_description,currency,amount::text AS cycle_amount,
     planned_issue_date,due_date,contract_reference,state AS cycle_state,revision AS cycle_revision,
     document_id,document_type,document_number,issue_date,document_due_date,document_state,document_revision,
     adjusted_total::text AS adjusted_total,credit_amount::text AS credit_amount,debit_amount::text AS debit_amount,
     paid_amount::text AS paid_amount,balance_amount::text AS balance_amount,payment_state,
     (document_state='ISSUED' AND balance_amount>0 AND document_due_date<$9::date) AS overdue
    FROM cycle_projection
    WHERE ($1='' OR strpos(lower(organization_name),lower($1))>0
      OR strpos(lower(organization_legal_name),lower($1))>0
      OR strpos(lower(COALESCE(document_number,'')),lower($1))>0
      OR strpos(lower(COALESCE(contract_reference,'')),lower($1))>0)
     AND ($2::uuid IS NULL OR organization_id=$2)
     AND ($3::date IS NULL OR period_end>=$3) AND ($4::date IS NULL OR period_start<=$4)
     AND ($5::text IS NULL OR state=$5) AND ($6::text IS NULL OR payment_state=$6)
     AND ($7::boolean IS NULL OR (document_state='ISSUED' AND balance_amount>0 AND document_due_date<$9::date)=$7)
     AND ($8::text IS NULL OR currency=$8)
    ORDER BY period_start DESC,id DESC LIMIT $10 OFFSET $11`),
  cycleDetail: normalize(`${projectionCte}
    SELECT p.id AS cycle_id,p.organization_id,p.organization_name,p.organization_legal_name,
     p.account_version_id,p.period_start,p.period_end,p.service_description,p.currency,
     p.amount::text AS cycle_amount,p.planned_issue_date,p.due_date,p.contract_reference,p.notes AS cycle_notes,
     p.state AS cycle_state,p.revision AS cycle_revision,p.created_at AS cycle_created_at,p.updated_at AS cycle_updated_at,
     v.legal_name,v.tax_country,v.tax_identifier,v.address_line_1,v.address_line_2,v.postal_code,v.locality,
     v.region,v.billing_email,v.contact_name,v.external_source,v.external_customer_ref,v.payment_terms_days,v.notes AS account_notes,
     p.document_id,p.document_type,p.document_number,p.issue_date,p.document_due_date,p.document_state,p.document_revision,
     p.adjusted_total::text AS adjusted_total,p.credit_amount::text AS credit_amount,p.debit_amount::text AS debit_amount,
     p.paid_amount::text AS paid_amount,p.balance_amount::text AS balance_amount,p.payment_state,
     (p.document_state='ISSUED' AND p.balance_amount>0 AND p.document_due_date<$2::date) AS overdue
    FROM cycle_projection p JOIN public.billing_account_version v ON v.id=p.account_version_id AND v.organization_id=p.organization_id
    WHERE p.id=$1`),
  cycleDocuments: normalize(`SELECT id,billing_cycle_id,organization_id,source_code,issuer_reference,document_type,
    document_number,external_document_id,issue_date,due_date,currency,subtotal::text AS subtotal,
    tax_total::text AS tax_total,total::text AS total,corrects_document_id,state,revision,created_at,updated_at
    FROM public.billing_fiscal_document WHERE billing_cycle_id=$1 ORDER BY issue_date,id`),
  cyclePayments: normalize(`SELECT p.id,p.billing_document_id,p.record_type,p.reverses_payment_id,p.amount::text AS amount,
    p.currency,p.effective_on,p.method_code,p.external_reference,p.note,p.created_by,p.created_at
    FROM public.billing_payment_record p JOIN public.billing_fiscal_document d ON d.id=p.billing_document_id
    WHERE d.billing_cycle_id=$1 ORDER BY p.effective_on,p.created_at,p.id`),
  cycleTimeline: normalize(`SELECT a.id,a.operation_code,a.occurred_at,a.actor_id,a.event_code,a.resource_type,a.resource_id,
    a.previous_revision,a.new_revision,a.detail_code,a.correlation_id
    FROM public.billing_activity a WHERE a.organization_id=$2 AND (
      (a.resource_type='BILLING_CYCLE' AND a.resource_id=$1)
      OR (a.resource_type='BILLING_DOCUMENT' AND EXISTS(
       SELECT 1 FROM public.billing_fiscal_document d WHERE d.id=a.resource_id AND d.billing_cycle_id=$1))
      OR (a.resource_type='BILLING_PAYMENT' AND EXISTS(
       SELECT 1 FROM public.billing_payment_record p JOIN public.billing_fiscal_document d ON d.id=p.billing_document_id
       WHERE p.id=a.resource_id AND d.billing_cycle_id=$1)))
    ORDER BY a.occurred_at,a.id`),
  accountDetail: normalize(`SELECT o.id AS organization_id,o.display_name AS organization_name,o.legal_name AS organization_legal_name,
    o.status AS organization_status,a.id AS account_id,a.current_version,a.revision AS account_revision,
    a.created_at AS account_created_at,a.updated_at AS account_updated_at,v.id AS account_version_id,
    v.version,v.legal_name,v.tax_country,v.tax_identifier,v.address_line_1,v.address_line_2,v.postal_code,
    v.locality,v.region,v.billing_email,v.contact_name,v.external_source,v.external_customer_ref,
    v.payment_terms_days,v.notes,v.created_by,v.created_at AS version_created_at
    FROM public.organization o LEFT JOIN public.billing_account a ON a.organization_id=o.id
    LEFT JOIN public.billing_account_version v ON v.billing_account_id=a.id AND v.organization_id=a.organization_id
     AND v.version=a.current_version WHERE o.id=$1`)
});
