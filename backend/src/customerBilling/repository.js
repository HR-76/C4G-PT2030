'use strict';

const { projectionCte } = require('../platformBilling/projectionSql');
const { createPlatformBillingRepository } = require('../platformBilling/repository');
const { query, uuid, fail } = require('../platformBilling/contracts');
const PAGE_SIZE = 25;
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));

function filters(raw = {}) {
  if (!raw || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) fail();
  if (Object.keys(raw).some(key => !['q','from','to','paymentStatus','currency','page'].includes(key))) fail();
  return query('cycles', {...raw});
}
// Fiscal records only. An internal draft never becomes a customer receivable.
const visible = `organization_id=$1 AND document_id IS NOT NULL AND state NOT IN ('DRAFT','READY_TO_ISSUE')`;
const filtered = `${visible}
 AND ($2='' OR strpos(lower(document_number),lower($2))>0 OR strpos(lower(service_description),lower($2))>0)
 AND ($3::date IS NULL OR issue_date>=$3) AND ($4::date IS NULL OR issue_date<=$4)
 AND ($5::text IS NULL OR payment_state=$5) AND ($6::text IS NULL OR currency=$6)`;
const columns = `id AS "cycleId",document_number AS "number",service_description AS "serviceDescription",
 period_start AS "periodStart",period_end AS "periodEnd",issue_date AS "issueDate",
 document_due_date AS "dueDate",document_state AS "documentState",currency,
 adjusted_total::text AS "total",paid_amount::text AS "paidAmount",balance_amount::text AS "balanceAmount",
 payment_state AS "paymentState",(document_state='ISSUED' AND balance_amount>0 AND document_due_date<$7::date) AS overdue`;
const statements = Object.freeze({
  count: `${projectionCte} SELECT count(*)::int AS total FROM cycle_projection WHERE ${filtered}`,
  list: `${projectionCte} SELECT ${columns} FROM cycle_projection WHERE ${filtered} ORDER BY issue_date DESC,id DESC LIMIT 25 OFFSET $8`,
  summary: `${projectionCte} SELECT currency,sum(adjusted_total)::text AS "billedAmount",sum(paid_amount)::text AS "paidAmount",
   sum(balance_amount)::text AS "balanceAmount",COALESCE(sum(balance_amount) FILTER(WHERE document_state='ISSUED' AND document_due_date<$2::date),0)::text AS "overdueAmount"
   FROM cycle_projection WHERE ${visible} GROUP BY currency ORDER BY currency`,
  visible: `SELECT c.id FROM public.billing_cycle c JOIN public.billing_fiscal_document d ON d.billing_cycle_id=c.id AND d.organization_id=c.organization_id
   WHERE c.id=$1 AND c.organization_id=$2 AND c.state NOT IN ('DRAFT','READY_TO_ISSUE') AND d.document_type IN ('INVOICE','SIMPLIFIED_INVOICE','INVOICE_RECEIPT')`
});

function customerDetail(data) {
  return {
    ...pick(data,['cycleId','periodStart','periodEnd','serviceDescription','currency','adjustedTotal','creditAmount','debitAmount','paidAmount','balanceAmount','paymentState','overdue']),
    origin: 'MANUAL_C4G',
    account: pick(data.accountSnapshot,['legalName','taxCountry','taxIdentifier','addressLine1','addressLine2','postalCode','locality']),
    documents: data.documents.map(document => ({...pick(document,['id','type','number','issueDate','dueDate','currency','subtotal','taxTotal','total','correctsDocumentId','state'])})),
    payments: data.payments.map(payment => ({...pick(payment,['id','documentId','recordType','reversesPaymentId','amount','currency','effectiveOn','methodCode','createdAt']),origin:'MANUAL_C4G'}))
  };
}
function createCustomerBillingRepository({ billing = createPlatformBillingRepository() } = {}) {
  return {
    async list(client, organizationId, raw, today) {
      const f=filters(raw), values=[organizationId,f.q,f.from,f.to,f.paymentStatus,f.currency];
      const total=(await client.query(statements.count,values)).rows[0].total;
      const items=(await client.query(statements.list,[...values,today,(f.page-1)*PAGE_SIZE])).rows;
      return {items,total,page:f.page,pageSize:PAGE_SIZE,origin:'MANUAL_C4G'};
    },
    async summary(client, organizationId, today) {
      return {currencies:(await client.query(statements.summary,[organizationId,today])).rows,origin:'MANUAL_C4G'};
    },
    async detail(client, organizationId, id, today) {
      uuid(id);
      if (!(await client.query(statements.visible,[id,organizationId])).rows.length) fail('RESOURCE_NOT_AVAILABLE');
      const data=await billing.cycleDetail(client,{cycleId:id,today});
      if(data.organizationId!==organizationId) fail('RESOURCE_NOT_AVAILABLE');
      return customerDetail(data);
    }
  };
}
module.exports={createCustomerBillingRepository,customerDetail,filters,statements};
