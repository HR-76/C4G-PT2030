'use strict';
// Shared accepted writer, composed by the explicit activation runtime only.
// Production activation remains disabled by default.
const {randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../../organizationalProfile/canonicalization');
const {validateSnapshotV2}=require('./validation');
const {cloneData,deepFreeze}=require('./data');
const {contentDigestV2}=require('./digests');
const {projectPersistenceV2}=require('./persistence');
const {previewReconciliation}=require('./reconciliation');
const {namespaceForIdentity}=require('../../fundingTenders/sourceIdentity');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
const present=fact=>fact.state==='PRESENT'?fact.value:null;

function acceptanceIntent(input,context){
 // Preserve the S6 generic port's receipts. Operational requests additionally
 // bind the durable approval plan and actor, so another plan cannot inherit an
 // earlier result/audit merely because its candidate and preview are identical.
 if(!context||!Object.hasOwn(context,'planId'))return digest(input);
 const value=cloneData(context,{maxBytes:4096});
 if(!UUID.test(value.planId)||!Number.isSafeInteger(value.fence)||value.fence<1||value.actor?.type!=='HUMAN'||!UUID.test(value.actor.id))fail('OPPORTUNITY_V2_INVALID_COMMAND');
 if(Object.hasOwn(value,'sourceFence')&&(!Number.isSafeInteger(value.sourceFence)||value.sourceFence<1))fail('OPPORTUNITY_V2_INVALID_COMMAND');
 if(Object.hasOwn(value,'executor11145Digest')&&!SHA.test(value.executor11145Digest))fail('OPPORTUNITY_V2_INVALID_COMMAND');
 return digest({operation:'OPPORTUNITY_V2_ACTIVATION_ACCEPT',input,planId:value.planId,fence:value.fence,actorId:value.actor.id,...(Object.hasOwn(value,'sourceFence')?{sourceFence:value.sourceFence}:{}),...(Object.hasOwn(value,'executor11145Digest')?{executor11145Digest:value.executor11145Digest}:{})});
}

function command(input,{approval=false}={}){
 const value=cloneData(input,{maxBytes:300000});
 const keys=['requestId','candidateId','snapshot','mappingDigest','expected','approvalDigest'];
 if(!value||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||!['requestId','candidateId','snapshot','mappingDigest','expected'].every(key=>Object.hasOwn(value,key)))fail('OPPORTUNITY_V2_INVALID_COMMAND');
 if(typeof value.requestId!=='string'||value.requestId.length<8||value.requestId.length>128||typeof value.candidateId!=='string'||!value.candidateId||value.candidateId.length>128||!SHA.test(value.mappingDigest))fail('OPPORTUNITY_V2_INVALID_COMMAND');
 if(approval&&!SHA.test(value.approvalDigest))fail('OPPORTUNITY_V2_APPROVAL_REQUIRED');
 if(value.expected!==null){const e=value.expected;if(!e||Array.isArray(e)||Object.keys(e).length!==3||!UUID.test(e.opportunityId)||!UUID.test(e.revisionId)||!Number.isSafeInteger(e.rowVersion)||e.rowVersion<1)fail('OPPORTUNITY_V2_INVALID_COMMAND');}
 value.snapshot=validateSnapshotV2(value.snapshot);return deepFreeze(value);
}

function createAcceptedOpportunityV2Repository({pool,authorize,verifyApproval,audit}){
 if(!pool||typeof pool.connect!=='function'||typeof authorize!=='function'||typeof verifyApproval!=='function'||typeof audit!=='function')throw new TypeError('Central authority, approval and transactional audit ports are required');
 async function authority(client,context){if(await authorize(client,context)!==true)fail('OPPORTUNITY_V2_AUTHORITY_DENIED');}
 async function transaction(work,context){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');await authority(client,context);const result=await work(client);await authority(client,context);await client.query('COMMIT');return deepFreeze(result);}catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code?.startsWith('OPPORTUNITY_'))throw error;fail(['23505','40001','40P01'].includes(error.code)?'OPPORTUNITY_V2_PERSISTENCE_CONFLICT':'OPPORTUNITY_V2_PERSISTENCE_UNAVAILABLE');}finally{client.release();}}
 async function current(client,input,lock){
  const identities=input.snapshot.sourceRecords.filter(s=>s.role!=='PROGRAMME_METADATA').map(s=>({namespace:s.namespace,externalId:s.externalId}));
  if(lock)for(const key of identities.map(i=>i.namespace+'\0'+i.externalId).sort())await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,620061))',[key.replaceAll('\0',':')]);
  const ids=new Set();
  for(const identity of identities){
   const rows=(await client.query('SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace=$1 AND external_identifier=$2',[identity.namespace,identity.externalId])).rows;
   rows.forEach(row=>ids.add(row.opportunity_id));
   if(['EU_FUNDING_TENDERS','INTERREG_EUROPE','POCTEP'].includes(identity.namespace)){
    const legacy=(await client.query('SELECT opportunity_id,external_identifier FROM opportunity_catalog.funding_identity WHERE external_identifier=$1',[identity.externalId])).rows;
    for(const row of legacy)if(namespaceForIdentity(row.external_identifier)===identity.namespace)ids.add(row.opportunity_id);
   }
  }
  if(ids.size>1)fail('OPPORTUNITY_V2_IDENTITY_CONFLICT');
  const resolved=[...ids][0]||null;
  if(resolved!==(input.expected?.opportunityId||null))fail('OPPORTUNITY_V2_STALE_REVISION');
  if(!resolved)return {accepted:[],row:null};
  const row=(await client.query(`SELECT o.*,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1${lock?' FOR UPDATE OF o':''}`,[resolved])).rows[0];
  if(!row||row.current_revision_id!==input.expected.revisionId||Number(row.row_version)!==input.expected.rowVersion||row.lifecycle_state==='ARCHIVED')fail('OPPORTUNITY_V2_STALE_REVISION');
  const storedIdentities=(await client.query('SELECT source_namespace AS namespace,external_identifier AS "externalId" FROM opportunity_catalog.source_identity_v2 WHERE opportunity_id=$1',[resolved])).rows;
  const legacy=(await client.query('SELECT external_identifier,corrections FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1',[resolved])).rows;
  for(const record of legacy)if(!storedIdentities.some(i=>i.externalId===record.external_identifier&&i.namespace===namespaceForIdentity(record.external_identifier)))storedIdentities.push({namespace:namespaceForIdentity(record.external_identifier),externalId:record.external_identifier});
  const resolutions=(await client.query('SELECT resolution_id,decision_digest FROM opportunity_catalog.funding_resolution WHERE opportunity_id=$1 ORDER BY resolution_id',[resolved])).rows;
  const mapping=(await client.query('SELECT mapping_digest FROM opportunity_catalog.accepted_receipt_v2 WHERE revision_id=$1 ORDER BY recorded_at DESC,request_id DESC LIMIT 1',[row.current_revision_id])).rows[0];
  return {row,accepted:[{opportunityId:resolved,revisionId:row.current_revision_id,rowVersion:Number(row.row_version),snapshot:row.snapshot,identities:storedIdentities,mappingDigest:mapping?.mapping_digest||null,corrections:legacy[0]?.corrections||{},resolutions,privateReferences:[]}]};
 }
 function previewFor(input,accepted){return previewReconciliation({accepted,candidates:[{candidateId:input.candidateId,snapshot:input.snapshot,mappingDigest:input.mappingDigest}],aliases:[]});}
 async function preview(raw,context){const input=command(raw);return transaction(async client=>previewFor(input,(await current(client,input,false)).accepted),context);}
 async function observations(client,snapshot){
  const ids=new Map(),sources=new Map(snapshot.sourceRecords.map(s=>[s.key,s]));
  for(const observation of snapshot.provenance.observations){const id=randomUUID(),source=sources.get(observation.sourceRecordKey);ids.set(observation.id,id);await client.query('INSERT INTO opportunity_catalog.source_observation_v2(observation_id,source_namespace,external_identifier,observed_at,artifact_sha256,observation) VALUES($1,$2,$3,opportunity_catalog.v2_iso_instant($4),$5,$6)',[id,source.namespace,source.externalId,observation.observedAt,observation.artifactSha256,observation]);}
  return ids;
 }
 async function derived(client,p,observationIds){
  const {snapshot,opportunityId,revisionId}=p.revision;
  for(const e of snapshot.provenance.evidence)await client.query('INSERT INTO opportunity_catalog.revision_evidence_v2(opportunity_id,revision_id,local_evidence_id,observation_id,evidence) VALUES($1,$2,$3,$4,$5)',[opportunityId,revisionId,e.id,observationIds.get(e.observationId),e]);
  for(const collection of ['programmes','funds'])for(const item of present(snapshot[collection])||[])await client.query('INSERT INTO opportunity_catalog.revision_concept_v2(opportunity_id,revision_id,collection,concept_key,payload) VALUES($1,$2,$3,$4,$5)',[opportunityId,revisionId,collection,item.key,item]);
  for(const item of present(snapshot.financing.allocations)||[]){await client.query('INSERT INTO opportunity_catalog.revision_allocation_v2(opportunity_id,revision_id,allocation_key,payload,amount_canonical,currency_state,currency_code) VALUES($1,$2,$3,$4,$5,$6,$7)',[opportunityId,revisionId,item.key,item,item.money.amount,item.money.currency.state,item.money.currency.value]);
   for(const [collection,refs] of [['programmes',item.programmeRefs],['funds',item.fundRefs]])for(const key of refs)await client.query('INSERT INTO opportunity_catalog.revision_allocation_concept_v2(revision_id,allocation_key,collection,concept_key) VALUES($1,$2,$3,$4)',[revisionId,item.key,collection,key]);}
  for(const collection of ['support','rates','eligibleCosts'])for(const [ordinal,item] of (present(snapshot.financing[collection])||[]).entries())await client.query('INSERT INTO opportunity_catalog.revision_financial_detail_v2(opportunity_id,revision_id,collection,ordinal,payload,minimum_canonical,maximum_canonical) VALUES($1,$2,$3,$4,$5,$6,$7)',[opportunityId,revisionId,collection,ordinal,item,collection==='rates'?item.minimumPercent:item.minimum,collection==='rates'?item.maximumPercent:item.maximum]);
  for(const [ordinal,item] of (present(snapshot.schedule.deadlines)||[]).entries())await client.query('INSERT INTO opportunity_catalog.revision_deadline_v2(opportunity_id,revision_id,ordinal,payload) VALUES($1,$2,$3,$4)',[opportunityId,revisionId,ordinal,item]);
 }
 async function writeAccepted(client,input,context){
   const intentDigest=acceptanceIntent(input,context);
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,620060))',[input.requestId]);
   const receipt=(await client.query('SELECT * FROM opportunity_catalog.accepted_receipt_v2 WHERE request_id=$1',[input.requestId])).rows[0];
   if(receipt){if(receipt.intent_digest!==intentDigest)fail('OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT');if(await verifyApproval(client,{input,receipt,context})!==true)fail('OPPORTUNITY_V2_APPROVAL_REQUIRED');return receipt.result;}
   const {row,accepted}=await current(client,input,true),proposal=previewFor(input,accepted),item=proposal.items[0];
   if(!item||item.action==='BLOCKED')fail('OPPORTUNITY_V2_RECONCILIATION_BLOCKED');
   if(proposal.previewDigest!==input.approvalDigest)fail('OPPORTUNITY_V2_APPROVAL_STALE');
   if(await verifyApproval(client,{input,preview:proposal,item,context})!==true)fail('OPPORTUNITY_V2_APPROVAL_REQUIRED');
   const snapshot=input.snapshot,opportunityId=row?.opportunity_id||randomUUID(),unchanged=item.action==='UNCHANGED';
   const revisionId=unchanged?row.current_revision_id:randomUUID(),revisionNumber=Number(row?.revision_number||0)+(unchanged?0:1),rowVersion=Number(row?.row_version||0)+(unchanged?0:1),contentDigest=contentDigestV2(snapshot);
   const observationIds=await observations(client,snapshot);
   if(!unchanged){
    const p=projectPersistenceV2(snapshot,{opportunityId,revisionId,revisionNumber,rowVersion});
    if(!row)await client.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version,current_schema_version) VALUES($1,$2,1,1,'ACTIVE','PENDING_REVIEW',$3,NULL,NULL,NULL,$4,'opportunity-normalization-v2','opportunity-quality-v2.0',2)",[opportunityId,revisionId,snapshot.description.title.value,contentDigest]);
    await client.query('INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[revisionId,opportunityId,revisionNumber,rowVersion,snapshot,{schemaVersion:2,projectionVersion:p.projectionVersion,contentDigest},snapshot.quality,contentDigest]);
    await derived(client,p,observationIds);
    if(row){const updated=await client.query("UPDATE opportunity_catalog.opportunity SET current_revision_id=$1,revision_number=$2,row_version=$3,current_schema_version=2,title=$4,funder_name=NULL,programme_name=NULL,call_reference=NULL,official_url=NULL,opening_date=NULL,closing_date=NULL,quality_score=NULL,quality_bucket=NULL,content_digest=$5,normalization_version='opportunity-normalization-v2',quality_rule_version='opportunity-quality-v2.0',updated_at=transaction_timestamp() WHERE opportunity_id=$6 AND current_revision_id=$7 AND row_version=$8",[revisionId,revisionNumber,rowVersion,snapshot.description.title.value,contentDigest,opportunityId,input.expected.revisionId,input.expected.rowVersion]);if(updated.rowCount!==1)fail('OPPORTUNITY_V2_STALE_REVISION');}
   }
   for(const identity of snapshot.sourceRecords.filter(s=>s.role!=='PROGRAMME_METADATA')){
    await client.query('INSERT INTO opportunity_catalog.source_identity_v2(source_namespace,external_identifier,opportunity_id) VALUES($1,$2,$3) ON CONFLICT(source_namespace,external_identifier) DO NOTHING',[identity.namespace,identity.externalId,opportunityId]);
    const bound=(await client.query('SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace=$1 AND external_identifier=$2',[identity.namespace,identity.externalId])).rows[0];
    if(bound?.opportunity_id!==opportunityId)fail('OPPORTUNITY_V2_IDENTITY_CONFLICT');
   }
   // Operational freshness only advances from an approved, committed snapshot.
   // Candidate/staging observations and legacy funding metadata are not inputs.
   const observedAt=snapshot.provenance.observations.map(o=>o.observedAt).sort().at(-1);
   const refreshed=await client.query('UPDATE opportunity_catalog.opportunity SET last_v2_observed_at=CASE WHEN last_v2_observed_at IS NULL OR opportunity_catalog.v2_iso_instant(last_v2_observed_at)<opportunity_catalog.v2_iso_instant($1) THEN $1 ELSE last_v2_observed_at END WHERE opportunity_id=$2 AND current_revision_id=$3 AND row_version=$4',[observedAt,opportunityId,revisionId,rowVersion]);
   if(refreshed.rowCount!==1)fail('OPPORTUNITY_V2_STALE_REVISION');
   const result={opportunityId,revisionId,revisionNumber,rowVersion,action:unchanged?'UNCHANGED':row?'REVISION_CREATED':'CREATED',contentDigest,sourceVersion:2};
   await audit(client,{operation:'OPPORTUNITY_V2_ACCEPT',requestId:input.requestId,opportunityId,revisionId,approvalDigest:input.approvalDigest,action:result.action,result,context});
   // Recheck both ports at the commit boundary; every side effect rolls back on
   // loss of central authority or approval, including observations and receipts.
   if(await verifyApproval(client,{input,preview:proposal,item,context})!==true)fail('OPPORTUNITY_V2_APPROVAL_REQUIRED');
   await client.query('INSERT INTO opportunity_catalog.accepted_receipt_v2(request_id,intent_digest,opportunity_id,revision_id,mapping_digest,approval_digest,result) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.requestId,intentDigest,opportunityId,revisionId,input.mappingDigest,input.approvalDigest,result]);
   return result;
 }
 async function accept(raw,context){const input=command(raw,{approval:true});return transaction(client=>writeAccepted(client,input,context),context);}
 // The worker already owns the transaction and its live execution authority.
 // Use exactly that client: neither a nested checkout nor an early commit can
 // separate catalog effects from the item's receipt, audit and counters.
 async function acceptInTransaction(client,raw,context){const input=command(raw,{approval:true});await authority(client,context);const result=await writeAccepted(client,input,context);await authority(client,context);return deepFreeze(result);}
 // Internal composition port: the caller owns a central transaction. Authority
 // still runs on this client; this avoids a nested pool checkout during approval.
 async function previewInTransaction(client,raw,context){const input=command(raw);await authority(client,context);const result=previewFor(input,(await current(client,input,false)).accepted);await authority(client,context);return result;}
 return Object.freeze({preview,accept,previewInTransaction,acceptInTransaction});
}
module.exports={createAcceptedOpportunityV2Repository,command};
