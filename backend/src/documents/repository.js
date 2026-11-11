const crypto = require('node:crypto');
const { UUID } = require('./objectIdentity');

function createDocumentRepository(pool, { runtimeRole = 'c4g_document_runtime' } = {}) {
  if (!pool || typeof pool.connect !== 'function' || !/^c4g_[a-z0-9_]+$/.test(runtimeRole)) {
    throw new TypeError('Document repository requires a tenant pool and fixed runtime role.');
  }
  function validOrganization(organizationId) {
    if (!UUID.test(organizationId || '')) throw new TypeError('Document tenant context is invalid.');
  }
  function operations(client, organizationId) {
    return Object.freeze({
      async createIntent(input) {
        if (!input || input.organizationId !== organizationId) throw new TypeError('Document intent tenant is invalid.');
        await client.query(`INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(document_id) DO NOTHING`,[input.documentId,input.organizationId,input.resourceType,input.resourceId,input.actorId,input.correlationId]);
        const values=[input.versionId,input.documentId,input.organizationId,input.versionNumber,input.objectId,input.expectedSize,input.fileClass,input.checksum,input.declaredMime,input.displayFilename,input.idempotencyKey,input.correlationId,input.causationId,input.actorId];
        const result=await client.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,causation_id,created_by_actor_id) VALUES($1,$2,$3,$4,$5,'QUARANTINE',$6,$7,$8,$9,$10,'PENDING','NOT_REQUESTED',$11,$12,$13,$14) RETURNING version_id,state,lock_version`,values);
        await client.query(`INSERT INTO document_storage.upload_capability(capability_id,version_id,organization_id,capability_digest,expires_at) VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),input.versionId,input.organizationId,input.capabilityDigest,input.capabilityExpiresAt]);
        return result.rows[0];
      },
      async findIntent({organizationId: requested,idempotencyKey}) {
        if(requested!==organizationId)throw new TypeError('Document tenant context is invalid.');
        return (await client.query(`SELECT v.version_id,v.document_id,v.organization_id,v.version_number,v.object_id,v.expected_size,
          v.expected_file_class,v.expected_sha256,v.declared_mime,v.display_filename,v.state,v.scan_state,v.idempotency_key,
          d.resource_id,d.created_by_actor_id
          FROM document_storage.document_version v JOIN document_storage.document d
            ON d.organization_id=v.organization_id AND d.document_id=v.document_id
          WHERE v.organization_id=$1 AND v.idempotency_key=$2`,[organizationId,idempotencyKey])).rows[0]||null;
      },
      async addCapability(input) {
        if(input.organizationId!==organizationId)throw new TypeError('Document tenant context is invalid.');
        await client.query(`INSERT INTO document_storage.upload_capability(capability_id,version_id,organization_id,capability_digest,expires_at)
          VALUES($1,$2,$3,$4,$5)`,[crypto.randomUUID(),input.versionId,organizationId,input.capabilityDigest,input.capabilityExpiresAt]);
        return Object.freeze({status:'ISSUED'});
      },
      async loadCapability({digest,organizationId: requested}) { if(requested!==organizationId)throw new TypeError('Document tenant context is invalid.');return (await client.query(`SELECT c.capability_digest AS digest,c.expires_at AS "expiresAt",c.consumed_at AS "consumedAt",c.revoked_at AS "revokedAt",v.organization_id AS "organizationId",v.version_id AS "versionId",v.document_id AS "documentId",v.object_id AS "objectId",v.expected_size::int AS "expectedSize",v.expected_file_class AS "fileClass",v.expected_sha256 AS checksum,v.declared_mime AS "declaredMime",v.display_filename AS "displayFilename",d.resource_id AS "resourceId",v.created_by_actor_id AS "actorId" FROM document_storage.upload_capability c JOIN document_storage.document_version v ON v.version_id=c.version_id JOIN document_storage.document d ON d.document_id=v.document_id WHERE c.capability_digest=$1 AND c.organization_id=$2`,[digest,organizationId])).rows[0]||null; },
      async consumeCapability({digest,organizationId: requested,versionId,now}) { if(requested!==organizationId)throw new TypeError('Document tenant context is invalid.');return (await client.query('SELECT document_storage.consume_upload_capability($1,$2,$3,$4) AS consumed',[organizationId,versionId,digest,now])).rows[0]?.consumed===true; },
      async transition({organizationId: requested,versionId,fromState,toState,scanState,lockVersion,observedSize=null,detectedMime=null,sha256=null,scanResult=null}) {
        if(requested!==organizationId)throw new TypeError('Document tenant context is invalid.');
        if(scanResult && (fromState!=='SCANNING'||!['AVAILABLE','QUARANTINED'].includes(toState)||scanResult.result!==scanState||
          !/^[A-Z][A-Z0-9_]{0,63}$/.test(scanResult.code||'')||!/^[a-f0-9]{64}$/.test(scanResult.inputDigest||'')))throw new TypeError('Document scan result is invalid.');
        const result=await client.query('SELECT * FROM document_storage.transition_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',[organizationId,versionId,fromState,toState,scanState,lockVersion,observedSize,detectedMime,sha256]);
        if(result.rowCount!==1)throw new Error('DOCUMENT_OPTIMISTIC_LOCK_CONFLICT');
        if(scanResult){
          // transition_version holds the version lock until this transaction commits.
          const saved=await client.query(`INSERT INTO document_storage.scan_result(version_id,attempt,result,result_code,input_digest,observed_at)
            SELECT v.version_id,COALESCE((SELECT MAX(s.attempt) FROM document_storage.scan_result s WHERE s.version_id=v.version_id),0)+1,$3,$4,$5,clock_timestamp()
            FROM document_storage.document_version v WHERE v.organization_id=$1 AND v.version_id=$2 AND v.sha256=$5 RETURNING attempt`,
            [organizationId,versionId,scanResult.result,scanResult.code,scanResult.inputDigest]);
          if(saved.rowCount!==1)throw new Error('DOCUMENT_SCAN_CONTENT_MISMATCH');
        }
        return result.rows[0];
      },
      async findVersion({organizationId: requested,versionId}) { if(requested!==organizationId)throw new TypeError('Document tenant context is invalid.');if(!UUID.test(versionId||''))return null;return (await client.query('SELECT * FROM document_storage.document_version WHERE organization_id=$1 AND version_id=$2',[organizationId,versionId])).rows[0]||null; },
      async findConfirmation({organizationId: requested,versionId}) { if(requested!==organizationId)throw new TypeError('Document tenant context is invalid.');return (await client.query(`SELECT sha256,observed_size AS "observedSize",confirmed_at AS "confirmedAt" FROM document_storage.document_version WHERE organization_id=$1 AND version_id=$2 AND confirmed_at IS NOT NULL`,[organizationId,versionId])).rows[0]||null; },
      async confirm(input) { if(input.organizationId!==organizationId)throw new TypeError('Document tenant context is invalid.');const result=await client.query('SELECT * FROM document_storage.confirm_version($1,$2,$3,$4)',[organizationId,input.versionId,input.sha256,input.size]);if(result.rowCount!==1)throw new Error('DOCUMENT_CONFIRMATION_CONFLICT');return result.rows[0]; },
      async registerMultipart(input) { if(input.organizationId!==organizationId)throw new TypeError('Document tenant context is invalid.');await client.query('SELECT document_storage.register_multipart_upload($1,$2,$3,$4,$5)',[organizationId,input.versionId,input.objectId,input.providerUploadId,input.expiresAt]);return Object.freeze({status:'INITIATED'}); },
      async recordMultipartPart(input) { if(input.organizationId!==organizationId)throw new TypeError('Document tenant context is invalid.');await client.query('SELECT document_storage.record_multipart_part($1,$2,$3,$4,$5)',[organizationId,input.versionId,input.partNumber,input.size,input.sha256]);return Object.freeze({status:'RECORDED'}); },
      async completeMultipart(input) { if(input.organizationId!==organizationId)throw new TypeError('Document tenant context is invalid.');await client.query('SELECT document_storage.finish_multipart_upload($1,$2,$3,$4)',[organizationId,input.versionId,input.providerUploadId,'COMPLETED']);return Object.freeze({status:'COMPLETED'}); },
      async abortMultipart(input) { if(input.organizationId!==organizationId||!input.providerUploadId)return Object.freeze({status:'UNCHANGED'});await client.query('SELECT document_storage.finish_multipart_upload($1,$2,$3,$4)',[organizationId,input.versionId,input.providerUploadId,'ABORTED']);return Object.freeze({status:'ABORTED'}); },
      async claimExpiredMultipart({organizationId: requested,limit=25}) { if(requested!==organizationId||!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Document tenant context is invalid.');return (await client.query('SELECT * FROM document_storage.claim_expired_multipart_uploads($1,$2)',[organizationId,limit])).rows; },
      async claimTransportRecovery({organizationId: requested,limit=25}) { if(requested!==organizationId||!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Document tenant context is invalid.');return (await client.query('SELECT * FROM document_storage.claim_document_transport_recovery($1,$2)',[organizationId,limit])).rows; },
      async findCurrent({organizationId: requested,documentId}) { if(requested!==organizationId)throw new TypeError('Document tenant context is invalid.');return (await client.query(`SELECT v.version_id AS "versionId",v.version_number AS "versionNumber",d.lock_version AS "lockVersion" FROM document_storage.document d JOIN document_storage.document_version v ON v.version_id=d.current_version_id WHERE d.organization_id=$1 AND d.document_id=$2`,[organizationId,documentId])).rows[0]||null; }
    });
  }
  async function withClient(client, organizationId, work) {
    validOrganization(organizationId);
    if (!client || typeof client.query !== 'function' || typeof work !== 'function') throw new TypeError('Prepared document transaction is invalid.');
    await client.query(`SET LOCAL ROLE ${runtimeRole}`);
    await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
    return work(operations(client, organizationId));
  }
  async function standalone(organizationId, work) {
    validOrganization(organizationId);
    const client=await pool.connect();let began=false,broken;
    try { await client.query('BEGIN');began=true;const result=await withClient(client,organizationId,work);await client.query('COMMIT');began=false;return result; }
    // A connection whose ROLLBACK failed is in an unknown state: destroy it instead of pooling it.
    catch(error){if(began){try{await client.query('ROLLBACK');}catch(rollbackError){broken=rollbackError;}}throw error;}
    finally{client.release(broken);}
  }
  const api={withClient};
  for(const name of ['createIntent','findIntent','addCapability','loadCapability','consumeCapability','transition','findVersion','findConfirmation','confirm','registerMultipart','recordMultipartPart','completeMultipart','abortMultipart','claimExpiredMultipart','claimTransportRecovery','findCurrent']){
    api[name]=input=>standalone(input?.organizationId,repository=>repository[name](input));
  }
  return Object.freeze(api);
}
module.exports = { createDocumentRepository };
