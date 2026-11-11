'use strict';
const {randomUUID}=require('node:crypto');
const {fail}=require('../platformBilling/contracts');
const publicFile=row=>row?{id:row.id,version:row.version,filename:row.filename,sizeBytes:row.size_bytes,createdAt:row.created_at}:null;
function createPdfRepository(pool) {
  return {
    async admin(request,documentId) {
      if(!request.sessionID||request.authContext?.sessionId!==request.sessionID||!request.user?.id)fail('C4G_ADMIN_REQUIRED');
      if(!(await pool.query('SELECT public.billing_pdf_admin($1,$2) allowed',[request.sessionID,request.user.id])).rows[0]?.allowed)fail('C4G_ADMIN_REQUIRED');
      const row=(await pool.query(`SELECT d.id,d.organization_id FROM public.billing_fiscal_document d JOIN public.organization o ON o.id=d.organization_id WHERE d.id=$1 AND o.status='ACTIVE'`,[documentId])).rows[0];
      if(!row)fail('RESOURCE_NOT_AVAILABLE');return row.organization_id;
    },
    async versions(organizationId,documentId) {
      return (await pool.query('SELECT * FROM public.billing_document_file WHERE organization_id=$1 AND document_id=$2 ORDER BY version DESC',[organizationId,documentId])).rows;
    },
    async save(request,documentId,entry) {
      try{return (await pool.query('SELECT * FROM public.billing_attach_pdf($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[request.sessionID,request.user.id,documentId,randomUUID(),entry.objectId,entry.filename,entry.size,entry.sha256,entry.requestId,entry.expectedVersion])).rows[0]}
      catch(error){if(error.code==='23505')fail('IDEMPOTENCY_CONFLICT');for(const code of ['C4G_ADMIN_REQUIRED','RESOURCE_NOT_AVAILABLE','IDEMPOTENCY_CONFLICT','STALE_REVISION'])if(error.message?.includes(code))fail(code);throw error}
    },
    async customerDocument(organizationId,documentId){
      const row=(await pool.query(`SELECT d.id FROM public.billing_fiscal_document d JOIN public.billing_cycle c ON c.id=d.billing_cycle_id AND c.organization_id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2 AND c.state NOT IN ('DRAFT','READY_TO_ISSUE')`,[documentId,organizationId])).rows[0];
      if(!row)fail('RESOURCE_NOT_AVAILABLE');
    }
  };
}
module.exports={createPdfRepository,publicFile};
