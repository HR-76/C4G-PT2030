'use strict';
const { createHash } = require('node:crypto');
const PQ1_OPERATIONS=Object.freeze(['CREATE_DRAFT','EDIT_ITEMS','SET_COMPETENCIES','SET_EXPERIENCES','ATTACH_EVIDENCE','VERIFY','REVOKE_VERIFICATION','SUBMIT','APPROVE','PUBLISH']);
const pq1Operation=source=>PQ1_OPERATIONS.find(op=>source==='PQ1_UI_'+op)||null;
const DIRECTORY_OPERATIONS=Object.freeze({DIRECTORY_PERSONPROFILEEDIT:'PERSON_PROFILE_EDIT',DIRECTORY_PERSONLINKEDIT:'PERSON_LINK_EDIT',DIRECTORY_SELFEDIT:'SELF_EDIT',DIRECTORY_PROFILEEDIT:'PROFILE_EDIT',DIRECTORY_STRATEGYEDIT:'PROFILE_EDIT',DIRECTORY_PERSONCREATE:'PERSON_CREATE',DIRECTORY_PERSONEDIT:'PERSON_EDIT',DIRECTORY_UNITCREATE:'CREATE',DIRECTORY_UNITRENAME:'RENAME_LABEL',DIRECTORY_UNITMOVE:'REPARENT'});
const ports=new WeakSet();
const boundPorts=new WeakMap();
function isTenantAuthorityRecovery(port){return ports.has(port);}
function snapshotDigest(snapshot) {
  const keys=['organizationId','tenantId','workload','connectionVersion','connectionRevision','bindingDigest','databaseGenerationId',
    'databaseRef','credentialRef','observedSystemIdentifier','fence'];
  return createHash('sha256').update(JSON.stringify(keys.map(key=>[key,snapshot[key]]))).digest('hex');
}
// Operational root port, not a functional API. A nonce lock proves that the
// original PostgreSQL transaction has terminated before observing its result.
function createTenantAuthorityRecovery(dependencies) {
  if(boundPorts.has(dependencies))return boundPorts.get(dependencies);
  const port=async (row,{deadline=Date.now()+10000}={}) => {
    const snapshot=await dependencies.directoryRepository.resolveSnapshotByOrganization(row.organization_id,'API');
    if (!snapshot || snapshot.tenantId!==row.tenant_id || snapshotDigest(snapshot)!==row.source_binding.snapshotDigest) throw new Error('AUTHORITY_SOURCE_DRIFT');
    let allocation,secret,open=false,primary=null,deadlineTimer;
    function bounded(task,lateCleanup){
      let expired=false,timer;
      const work=Promise.resolve(task);
      work.then(value=>{if(expired)Promise.resolve(lateCleanup?.(value)).catch(()=>{});},()=>{});
      return Promise.race([work,new Promise((resolve,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error('AUTHORITY_RECOVERY_TIMEOUT'));},Math.max(1,deadline-Date.now()));})])
        .finally(()=>clearTimeout(timer));
    }
    try {
      secret=await bounded(dependencies.credentialProvider.resolve({credentialRef:snapshot.credentialRef,tenantId:snapshot.tenantId,
        workload:'API',connectionVersion:snapshot.connectionVersion,correlationId:row.correlation_id}),value=>value.dispose());
      const lease=secret;secret=null;
      allocation=await bounded(dependencies.poolManager.acquire({tenantId:snapshot.tenantId,workload:'API',connectionVersion:snapshot.connectionVersion,
        workloadClass:'OPERATIONAL',credentialLease:lease,correlationId:row.correlation_id}),value=>value.release({discard:true,cause:new Error('AUTHORITY_RECOVERY_TIMEOUT')}));
      deadlineTimer=setTimeout(()=>allocation.release({discard:true,cause:new Error('AUTHORITY_RECOVERY_TIMEOUT')}).catch(()=>{}),Math.max(1,deadline-Date.now()));
      const client=allocation.client;
      await client.query('BEGIN');open=true;
      await client.query("SELECT set_config('statement_timeout',$1,true)",[`${Math.max(1,Math.min(5000,deadline-Date.now()))}ms`]);
      await dependencies.bindingVerifier.verify({client,snapshot,requiredCapabilities:[
        row.source_binding.sourceOperation==='ORGANIZATION_NOTICE_SEND'?'ORGANIZATION_NOTICES':
        (row.source_binding.sourceOperation==='DIRECTORY_READ'||Object.hasOwn(DIRECTORY_OPERATIONS,row.source_binding.sourceOperation))?'ORGANIZATION_DIRECTORY':
        pq1Operation(row.source_binding.sourceOperation)?'F13_PQ1_PUBLICATION':
        ['PQ1_ACTIVATE','PQ1_EVALUATE','PQ1_EFFECTIVE_READ'].includes(row.source_binding.sourceOperation)?'F13_PQ1_ACTIVATION':
        row.source_binding.sourceOperation==='APPLICATION_WORK_EDIT'?'APPLICATION_TEAM_TASKS':
        row.source_binding.sourceOperation==='APPLICATION_CHAT_SEND'?'APPLICATION_TEAM_CHAT':
        ['APPLICATION_DOCUMENT_EDIT','APPLICATION_REVIEW_REQUEST','APPLICATION_REVIEW_DECIDE'].includes(row.source_binding.sourceOperation)?'APPLICATION_DOCUMENT_REVIEW':
        ['APPLICATION_CREATE','APPLICATION_EDIT','APPLICATION_TRANSITION'].includes(row.source_binding.sourceOperation)?'APPLICATION_FIRST_SLICE':
        ['CRITERIA_READ','CRITERIA_SAVE','CRITERIA_CONFIRM'].includes(row.source_binding.sourceOperation)?'OPPORTUNITY_EVIDENCED_CRITERIA':
        ['F12_READ','F12_UPDATE','F12_CREATE','F12_ARCHIVE'].includes(row.source_binding.sourceOperation)?'F12_PRIVATE_CATALOG_READ':
        ['EDITORIAL_SUBMIT','EDITORIAL_APPROVE','EDITORIAL_PUBLISH','EDITORIAL_READ'].includes(row.source_binding.sourceOperation)?'F13_EDITORIAL_BASELINE_PUBLICATION':
        ['POPULATION_CREATE','POPULATION_EDIT','POPULATION_READ','POPULATION_SUBMIT','POPULATION_VERIFY','POPULATION_REJECT','POPULATION_DISPUTE','POPULATION_REVOKE'].includes(row.source_binding.sourceOperation)?'F13_TERRITORIES_AND_POPULATIONS':
        ['OPERATIONAL_CREATE','OPERATIONAL_EDIT','OPERATIONAL_READ','OPERATIONAL_SUBMIT','OPERATIONAL_VERIFY','OPERATIONAL_REJECT','OPERATIONAL_DISPUTE','OPERATIONAL_REVOKE'].includes(row.source_binding.sourceOperation)?'F13_OPERATIONAL_CAPACITY':
        ['FINANCIAL_CREATE','FINANCIAL_EDIT','FINANCIAL_READ','FINANCIAL_SUBMIT','FINANCIAL_VERIFY','FINANCIAL_REJECT','FINANCIAL_DISPUTE','FINANCIAL_REVOKE'].includes(row.source_binding.sourceOperation)?'F13_FINANCIAL_CAPACITY':
        ['COMPETENCY_SET','EXPERIENCE_SET','EVIDENCE_ATTACH','COMPETENCY_VERIFY','EVIDENCE_LINK_READ'].includes(row.source_binding.sourceOperation)?'F13_COMPETENCIES_AND_EXPERIENCE':row.source_binding.sourceOperation?.startsWith('PROFILE_')?'F13_PROFILE_AUTHORING':'F13_PROFILE_CATALOG_FOUNDATION',
        'F7_AUDIT_LEDGER'],correlationId:row.correlation_id});
      const locked=(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,43001305)) AS locked',[row.transaction_id])).rows[0]?.locked;
      if (!locked) {
        if (Date.now()<new Date(row.deadline).getTime()) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43001305))',[row.transaction_id]);
        } else {
        // Terminate only our expired transaction, never an arbitrary backend:
        // pid AND backend_start AND database-local nonce lock must all match.
        const terminated=(await client.query(`SELECT pg_terminate_backend(a.pid) AS terminated FROM pg_stat_activity a
          WHERE a.pid=$1 AND a.backend_start=$2 AND a.datname=current_database() AND a.pid<>pg_backend_pid()
          AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory' AND l.granted
            AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.objsubid=1
            AND l.classid=((hashtextextended($3,43001305)>>32)&4294967295)::oid
            AND l.objid=(hashtextextended($3,43001305)&4294967295)::oid)`,
          [row.source_binding.backendPid,row.source_binding.backendStart,row.transaction_id])).rows;
        if (terminated.length && !terminated[0].terminated) throw new Error('AUTHORITY_SOURCE_STILL_ACTIVE');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43001305))',[row.transaction_id]);
        }
      }
      let outcome='READ_TERMINAL';
      if (row.idempotency_key) {
        const f12Operation={F12_UPDATE:'UPDATE',F12_CREATE:'CREATE',F12_ARCHIVE:'ARCHIVE'}[row.source_binding.sourceOperation];
        const f12=Boolean(f12Operation),notice=row.source_binding.sourceOperation==='ORGANIZATION_NOTICE_SEND';
        const chat=row.source_binding.sourceOperation==='APPLICATION_CHAT_SEND';
        const applicationOperation={APPLICATION_CREATE:'CREATE',APPLICATION_EDIT:'EDIT',APPLICATION_TRANSITION:'TRANSITION',APPLICATION_WORK_EDIT:'WORK',APPLICATION_DOCUMENT_EDIT:'DOCUMENT_REVIEW',APPLICATION_REVIEW_REQUEST:'DOCUMENT_REVIEW',APPLICATION_REVIEW_DECIDE:'DOCUMENT_REVIEW'}[row.source_binding.sourceOperation];
        const criteria=['CRITERIA_SAVE','CRITERIA_CONFIRM'].includes(row.source_binding.sourceOperation);
        const directoryOperation=DIRECTORY_OPERATIONS[row.source_binding.sourceOperation];
        await client.query(notice||chat||f12||criteria||applicationOperation||directoryOperation?'SET LOCAL ROLE c4g_opportunity_tenant_runtime':'SET LOCAL ROLE c4g_organization_profile_runtime');
        await client.query("SELECT set_config('app.organization_id',$1,true)",[row.organization_id]);
        if(notice)await client.query("SELECT set_config('app.membership_id',$1,true),set_config('app.notice_admin','true',true)",[row.membership_id]);
        const source=row.source_binding.sourceOperation, pq1=pq1Operation(source);
        const tables={PQ1_ACTIVATE:'pq1_effective_receipt',PQ1_EVALUATE:'pq1_effective_receipt',RELEASE_CREATE:'taxonomy_idempotency_record',CONCEPT_CREATE:'taxonomy_idempotency_record',CONCEPT_APPROVE:'taxonomy_idempotency_record',
          RELATION_CREATE:'taxonomy_idempotency_record',MAPPING_CREATE:'taxonomy_idempotency_record',RELEASE_PUBLISH:'taxonomy_idempotency_record',
          PROFILE_DRAFT_CREATE:'idempotency_record',PROFILE_DRAFT_EDIT:'idempotency_record',PROFILE_SUBMIT:'idempotency_record',
          EDITORIAL_SUBMIT:'editorial_idempotency_record',EDITORIAL_APPROVE:'editorial_idempotency_record',EDITORIAL_PUBLISH:'editorial_idempotency_record',
          COMPETENCY_SET:'competency_idempotency_record',EXPERIENCE_SET:'competency_idempotency_record',EVIDENCE_ATTACH:'competency_idempotency_record',COMPETENCY_VERIFY:'competency_idempotency_record',EVIDENCE_LINK_READ:'competency_idempotency_record',
          FINANCIAL_CREATE:'financial_idempotency_record',FINANCIAL_EDIT:'financial_idempotency_record',FINANCIAL_READ:'financial_idempotency_record',FINANCIAL_SUBMIT:'financial_idempotency_record',FINANCIAL_VERIFY:'financial_idempotency_record',FINANCIAL_REJECT:'financial_idempotency_record',FINANCIAL_DISPUTE:'financial_idempotency_record',FINANCIAL_REVOKE:'financial_idempotency_record',
          OPERATIONAL_CREATE:'operational_idempotency_record',OPERATIONAL_EDIT:'operational_idempotency_record',OPERATIONAL_READ:'operational_idempotency_record',OPERATIONAL_SUBMIT:'operational_idempotency_record',OPERATIONAL_VERIFY:'operational_idempotency_record',OPERATIONAL_REJECT:'operational_idempotency_record',OPERATIONAL_DISPUTE:'operational_idempotency_record',OPERATIONAL_REVOKE:'operational_idempotency_record',
          POPULATION_CREATE:'population_idempotency_record',POPULATION_EDIT:'population_idempotency_record',POPULATION_READ:'population_idempotency_record',POPULATION_SUBMIT:'population_idempotency_record',POPULATION_VERIFY:'population_idempotency_record',POPULATION_REJECT:'population_idempotency_record',POPULATION_DISPUTE:'population_idempotency_record',POPULATION_REVOKE:'population_idempotency_record'};
        const table=tables[source];if(!table&&!notice&&!chat&&!f12&&!criteria&&!pq1&&!applicationOperation&&!directoryOperation)throw new Error('AUTHORITY_SOURCE_OPERATION_INVALID');
        const stored=chat?(await client.query('SELECT intention_digest FROM opportunity_catalog.application_chat_receipt WHERE organization_id=$1 AND message_id=$2',[row.organization_id,row.idempotency_key])).rows[0]:notice?(await client.query('SELECT intention_digest FROM opportunity_catalog.organization_notice WHERE organization_id=$1 AND author_subject_id=$2 AND author_membership_id=$3 AND idempotency_key=$4',[row.organization_id,row.subject_id,row.membership_id,row.idempotency_key])).rows[0]:(await client.query(directoryOperation?`SELECT intention_digest FROM organizational_scope.${source.startsWith('DIRECTORY_UNIT')?'idempotency_record':'directory_receipt'} WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`:applicationOperation?`SELECT intention_digest FROM opportunity_catalog.${applicationOperation==='WORK'?'application_work_receipt':applicationOperation==='DOCUMENT_REVIEW'?'application_document_receipt':'application_receipt'} WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`:pq1?`SELECT intention_digest FROM organization_profile.pq1_ui_receipt WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`:criteria?`SELECT intention_digest FROM opportunity_catalog.criteria_receipt WHERE organization_id=$1 AND operation=$2 AND request_id=$3`:f12?`SELECT request_digest AS intention_digest FROM opportunity_catalog.idempotency_record
          WHERE organization_id=$1 AND operation=$2 AND request_id=$3`:`SELECT intention_digest FROM organization_profile.${table}
          WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3`,[row.organization_id,directoryOperation || applicationOperation || pq1 || (f12?f12Operation:source),row.idempotency_key])).rows[0];
        if (stored && stored.intention_digest!==row.intention_digest) throw new Error('AUTHORITY_INTENTION_CONFLICT');
        outcome=stored?'COMMITTED':'ROLLED_BACK';
      }
      await client.query('ROLLBACK');open=false;
      return Object.freeze({transactionId:row.transaction_id,terminal:true,outcome});
    } catch(error) { primary=error;throw error; }
    finally {
      clearTimeout(deadlineTimer);
      if (allocation) {
        if (open) await allocation.client.query('ROLLBACK').catch(()=>{});
        await allocation.release({discard:Boolean(primary),cause:primary});
      }
      if (secret) await secret.dispose();
    }
  };
  ports.add(port);boundPorts.set(dependencies,port);return port;
}
module.exports={createTenantAuthorityRecovery,isTenantAuthorityRecovery,snapshotDigest};
