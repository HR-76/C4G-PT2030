'use strict';
const { randomUUID } = require('node:crypto');
const { createUuidV7 } = require('../audit/uuidV7');
const { CentralOpportunityRepository } = require('../opportunities/centralRepository');
const { createIdentityFactory } = require('../opportunities/identity');
const { validateEnvelope } = require('../async/envelope');
const { OutboxRepository } = require('../async/outboxRepository');
const { mergeSource, FIELDS, boundedSourceFields } = require('./merge');
const { SOURCE } = require('./source');
const { validateSelection } = require('./programmes');
const { namespaceForIdentity, validateSourceIdentity, OFFICIAL } = require('./sourceIdentity');
const { catalogQuery } = require('./catalogQuery');
const { catalogSortSql } = require('./catalogSort');
const {catalogueProgrammes,sourceNamespaces}=require('./catalogOptions');
const { createPlatformAudit } = require('./audit');
const { cascadeKeyFromUrl } = require('./identity');
const coverage = require('./coverage');
const discoveryDetails = require('./discoveryDetails');
const {createOpportunityReadModel,prepareOpportunitySnapshot,boundedCatalogPage,assertDetailSize}=require('../opportunities/v2/readModel');
const {titleExpression,programmeLabelsExpression,referenceValuesExpression,isV2}=require('../opportunities/v2/catalogSql');
const {civilDateSql}=require('../opportunities/v2/temporalSql');
const WORKER = 'FUNDING_TENDERS_CENTRAL';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function publicRun(row) {
  if(!row)return null;
  const value={...(row.known_refresh?{knownRefresh:row.known_refresh}:{}),runId:row.run_id,source:row.source_code||SOURCE,status:row.status,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at,received:row.result_count??null,created:row.created_count,updated:row.updated_count,failed:row.failed_count,unchanged:row.unchanged_count,limited:row.limited,errorCode:row.error_code};
  if(row.review_count!==undefined)value.reviewed=row.review_count;
  return row.cycle_status?{...value,...(row.cycle_reviewed==null?{}:{reviewed:row.cycle_reviewed+(row.known_refresh?.REVIEW||0)}),status:row.cycle_status,finishedAt:row.cycle_finished_at,received:row.cycle_received,created:row.cycle_created,updated:row.cycle_updated,unchanged:row.cycle_unchanged,failed:row.cycle_failed,limited:row.cycle_status!=='SUCCESS',errorCode:row.cycle_error,coverage:{pages:row.pages,unique:row.unique_count,duplicates:row.duplicate_count,excluded:row.excluded_count,invalid:row.invalid_count,remoteTotal:row.remote_total,totalChanged:row.total_changed,pending:Math.max(0,row.unique_count-row.cycle_created-row.cycle_updated-row.cycle_unchanged-row.cycle_failed-(row.cycle_reviewed||0)+row.invalid_count-(row.known_refresh?.DISCOVERY_DEFERRED||0))}}:value;
}
function createFundingRepository({ pool, audit = createPlatformAudit(), readRole = false, workerHealth, coverageEnabled = false, startCoverage = coverageEnabled, refreshEnabled = false, resolutionEnabled = false, enrichmentEnabled = false, candidateArchive = null, catalog: catalogOverride, clock=()=>new Date(), euSourceControlEnabled=false, euWriterV2=null }) {
  if(typeof euSourceControlEnabled!=='boolean')throw new TypeError('EU source control capability is invalid.');
  if (candidateArchive !== null && (!enrichmentEnabled || !refreshEnabled || !coverageEnabled || typeof candidateArchive.stage !== 'function' || typeof candidateArchive.verify !== 'function')) throw new TypeError('Canonical archive requires enriched durable coverage configuration');
  if(euWriterV2!==null&&(!euSourceControlEnabled||!coverageEnabled||!startCoverage||!refreshEnabled||!resolutionEnabled||!enrichmentEnabled||candidateArchive!==null))throw new TypeError('EU writer requires all durable capabilities and its concrete archive');
  const euWriter=euWriterV2===null?null:require('./euWriter').createEuWriterV2({pool,configuration:euWriterV2});
  function requireControlledEuWriter(source){
    if(euSourceControlEnabled&&!euWriter&&['EU_FUNDING_TENDERS','CORDIS','ERASMUS'].includes(source))fail('FUNDING_EU_V2_WRITER_REQUIRED');
  }
  function writerFor(row){
    if(row.eu_writer_mode==='CANONICAL_V2'){if(!euWriter)fail('OPPORTUNITY_V2_EU_WRITER_MODE_MISMATCH');euWriter.assertRun(row);return euWriter;}
    if(euWriter&&['EU_FUNDING_TENDERS','CORDIS','ERASMUS'].includes(row.source_code))fail('OPPORTUNITY_V2_EU_WRITER_MODE_MISMATCH');
    return null;
  }
  const history=refreshEnabled?`SELECT h.*,COALESCE(k.summary,'{}'::jsonb)||jsonb_build_object('DISCOVERY_DEFERRED',(SELECT count(*)::int FROM opportunity_catalog.funding_refresh_target t JOIN opportunity_catalog.funding_cycle_seen z USING(cycle_id,external_identifier) WHERE t.cycle_id=h.run_id)) AS known_refresh FROM (${coverage.history}) h LEFT JOIN LATERAL (SELECT jsonb_object_agg(state,n) AS summary FROM (SELECT state,count(*)::int AS n FROM opportunity_catalog.funding_refresh_target WHERE cycle_id=h.run_id GROUP BY state) counts) k ON true`:coverage.history;
  const catalog = catalogOverride || new CentralOpportunityRepository({ pool, identityFactory: createIdentityFactory() });
  const outbox = new OutboxRepository();
  async function transaction(work, readOnly = false) {
    const client = await pool.connect();
    try { if(readRole&&!readOnly)fail('CATALOG_WRITE_DENIED'); await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN'); if(readRole)await client.query('SET LOCAL ROLE c4g_catalog_reader'); await client.query("SET LOCAL statement_timeout='5s'"); if(euSourceControlEnabled&&!readOnly)await client.query('LOCK TABLE opportunity_catalog.funding_run IN ROW EXCLUSIVE MODE'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw euSourceControlEnabled?require('../opportunities/v2/euSourceControl').sourceControlError(error):error; }
    finally { client.release(); }
  }
  async function administrator(client, userId, lock = false) {
    const user = (await client.query(`SELECT id FROM public.global_user WHERE id=$1 AND status='ACTIVE'${lock ? ' FOR SHARE' : ''}`, [userId])).rows[0];
    const assignment = (await client.query(`SELECT id FROM public.platform_admin_assignment WHERE global_user_id=$1 AND role_code='C4G_ADMIN' AND status='ACTIVE'${lock ? ' FOR SHARE' : ''}`, [userId])).rows[0];
    if (!user || !assignment) fail('FUNDING_FORBIDDEN');
  }
  async function dispatch(client, runId) {
    const now=new Date();
    const envelope={envelopeVersion:3,authority:'CENTRAL',jobType:'funding_tenders.refresh',jobVersion:1,payloadVersion:1,organizationId:null,actor:{kind:'SERVICE',serviceActorCode:WORKER},operation:'opportunity.central.manage',correlationId:createUuidV7(),causationId:createUuidV7(),idempotencyKey:runId,executionId:runId,createdAt:now.toISOString(),deadlineAt:new Date(now.getTime()+300000).toISOString(),payload:{runId},observability:{version:1,traceparent:null,tracestate:null}};
    const validated=validateEnvelope(envelope,{supports:()=>true});
    await outbox.enqueueLineage(client,{organizationId:null,logicalId:`funding:${runId}`,envelope,lineage:{deliveryKind:'INITIAL',attempt:1,rootExecutionId:runId,previousExecutionId:null,contentDigest:validated.contentDigest,envelopeDigest:validated.envelopeDigest,replayRequestId:null}});
  }
  async function assertSourceActive(client,source){if(euSourceControlEnabled)await client.query('SELECT opportunity_catalog.assert_eu_active_v2($1::text)',[source]);}
  async function sourceExecutionAllowed(runId){if(!euSourceControlEnabled)return true;return transaction(async client=>(await client.query('SELECT opportunity_catalog.eu_source_execution_allowed_v2(source_code) AS allowed FROM opportunity_catalog.funding_run WHERE run_id=$1',[runId])).rows[0]?.allowed===true,true);}
  async function present(client,row) {
    if(!coverageEnabled)return publicRun(row);
    return publicRun((await client.query(`SELECT * FROM (${history}) h WHERE run_id=$1`,[row.run_id])).rows[0]);
  }
  async function enqueue(userId, requestId, source = SOURCE) {
    validateSelection(source);
    if (typeof requestId !== 'string' || !UUID.test(requestId)) fail('INVALID_INPUT');
    return transaction(async client => {
      await administrator(client, userId, true);
      await assertSourceActive(client,source);
      requireControlledEuWriter(source);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('EU_FUNDING_TENDERS',150001))");
      const existing = (await client.query('SELECT * FROM opportunity_catalog.funding_run WHERE request_id=$1', [requestId])).rows[0];
      if (existing) { if (existing.requested_by !== userId || existing.source_code !== source) fail('IDEMPOTENCY_CONFLICT'); return present(client,existing); }
      if (workerHealth) {
        let health;
        try { health = await workerHealth(); } catch { /* Unknown health cannot admit new work. */ }
        if (health?.ready !== true) fail('FUNDING_WORKER_UNAVAILABLE');
        if(refreshEnabled&&health.refreshSupported!==true)fail('FUNDING_WORKER_UPGRADE_REQUIRED');
        if(resolutionEnabled&&health.resolutionSupported!==true)fail('FUNDING_WORKER_UPGRADE_REQUIRED');
        if(enrichmentEnabled&&(health.enrichmentSupported!==true||health.discoveryDetailSupported!==true))fail('FUNDING_WORKER_UPGRADE_REQUIRED');
        if(coverageEnabled&&startCoverage&&['EU_FUNDING_TENDERS','CORDIS','ERASMUS'].includes(source)&&health.coverageSupported!==true)fail('FUNDING_WORKER_UPGRADE_REQUIRED');
        if(euWriter&&['EU_FUNDING_TENDERS','CORDIS','ERASMUS'].includes(source)&&(health.euWriterSupported!==true||health.euWriterPolicyVersion!==euWriter.configuration.policyVersion||health.euWriterMappingDigest!==euWriter.configuration.mappingDigest))fail('FUNDING_WORKER_UPGRADE_REQUIRED');
      }
      const active = (await client.query("SELECT * FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')"+(euSourceControlEnabled?' AND opportunity_catalog.eu_source_execution_allowed_v2(source_code)':''))).rows[0];
      // A different request must not be acknowledged without persisting its key:
      // an uncertain response could otherwise create another run on retry.
      if (active) fail('FUNDING_BUSY');
      const runId = randomUUID();
      const canonical=euWriter&&['EU_FUNDING_TENDERS','CORDIS','ERASMUS'].includes(source);
      const row = (await client.query(canonical?"INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code,eu_writer_mode,eu_writer_policy,eu_writer_mapping_digest) VALUES($1,$2,$3,'QUEUED',$4,'CANONICAL_V2',$5,$6) RETURNING *":"INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code) VALUES($1,$2,$3,'QUEUED',$4) RETURNING *", [runId, requestId, userId, source,...(canonical?[euWriter.configuration.policyVersion,euWriter.configuration.mappingDigest]:[])])).rows[0];
      if(coverageEnabled&&startCoverage&&['EU_FUNDING_TENDERS','CORDIS','ERASMUS'].includes(source)){
        await coverage.start(client,runId);
        if(refreshEnabled)await require('./refresh').start(client,runId,source,{canonicalV2:Boolean(canonical)});
      }
      await dispatch(client,runId);
      await audit(client, { actor: { type: 'HUMAN', id: userId }, eventCode: 'SERVICE_JOB_DISPATCHED', requestId: `funding:${runId}`, detailCode: 'FUNDING_REQUESTED' });
      return present(client,row);
    });
  }
  async function status(userId) { return transaction(async client => {
    await administrator(client, userId);
    if(coverageEnabled){
      const rows=(await client.query(`SELECT * FROM (${history}) h ORDER BY created_at DESC,run_id DESC LIMIT 101`)).rows;
      const latest=(await client.query(`SELECT DISTINCT ON (source_code) * FROM (${history}) h ORDER BY source_code,created_at DESC,run_id DESC`)).rows;
      const complete=(await client.query(`SELECT DISTINCT ON (source_code) * FROM (${history}) h WHERE cycle_status='SUCCESS' OR cycle_status IS NULL AND status='SUCCESS' AND limited=false ORDER BY source_code,COALESCE(cycle_finished_at,finished_at) DESC,run_id DESC`)).rows;
      return {source:SOURCE,lastRun:publicRun(rows[0]),lastRuns:latest.map(publicRun),lastCompleteRuns:complete.map(publicRun),runs:rows.slice(0,100).map(publicRun),runsLimited:rows.length>100};
    }
    const rows = (await client.query('SELECT * FROM opportunity_catalog.funding_run ORDER BY created_at DESC,run_id DESC LIMIT 101')).rows;
    const latest = (await client.query('SELECT DISTINCT ON (source_code) * FROM opportunity_catalog.funding_run ORDER BY source_code,created_at DESC,run_id DESC')).rows;
    const complete = (await client.query("SELECT DISTINCT ON (source_code) * FROM opportunity_catalog.funding_run WHERE status='SUCCESS' AND limited=false ORDER BY source_code,finished_at DESC,run_id DESC")).rows;
    return { source: SOURCE, lastRun: publicRun(rows[0]), lastRuns: latest.map(publicRun), lastCompleteRuns: complete.map(publicRun), runs: rows.slice(0, 100).map(publicRun), runsLimited: rows.length > 100 };
  }, true); }
  async function claim(runId, execution) {
    return transaction(async client => {
      const row = (await client.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1 FOR UPDATE', [runId])).rows[0];
      if (!row || ['SUCCESS', 'ERROR'].includes(row.status)) return null;
      await assertSourceActive(client,row.source_code);
      requireControlledEuWriter(row.source_code);
      const writer=writerFor(row);
      await administrator(client, row.requested_by, true);
      if (row.lease_until && new Date(row.lease_until).getTime() > Date.now()) fail('FUNDING_BUSY');
      const claimed=writer?await writer.claim(client,row,execution):(await client.query("UPDATE opportunity_catalog.funding_run SET status='RUNNING',started_at=COALESCE(started_at,clock_timestamp()),fence=fence+1,lease_until=clock_timestamp()+interval '150 seconds' WHERE run_id=$1 RETURNING *", [runId])).rows[0];
      if(coverageEnabled)claimed.checkpoint=await coverage.load(client,runId);
      if(refreshEnabled&&['POCTEP','INTERREG_EUROPE'].includes(row.source_code))claimed.knownIdentifiers=(await client.query("SELECT external_identifier FROM opportunity_catalog.funding_identity WHERE external_identifier LIKE $1 ORDER BY external_identifier",[row.source_code+':%'])).rows.map(r=>r.external_identifier);
      return claimed;
    });
  }
  async function locked(client, run, execution) {
    const row = (await client.query("SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1 AND fence=$2 AND status='RUNNING' AND lease_until>clock_timestamp() FOR UPDATE", [run.run_id, run.fence])).rows[0];
    if (!row) fail('FUNDING_FENCE_STALE'); await assertSourceActive(client,row.source_code); requireControlledEuWriter(row.source_code); const writer=writerFor(row); await administrator(client, row.requested_by, true);if(writer)await writer.assertExecution(client,row,execution); return row;
  }
  async function releaseRetry(client,envelope,workerId){
    const row=(await client.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1 FOR UPDATE',[envelope.payload.runId])).rows[0];
    if(!row)fail('FUNDING_FENCE_STALE');requireControlledEuWriter(row.source_code);const writer=writerFor(row);
    if(!writer)return client.query("UPDATE opportunity_catalog.funding_run SET lease_until=clock_timestamp() WHERE run_id=$1 AND status='RUNNING'",[row.run_id]);
    const inbox=(await client.query("SELECT fence FROM async_exec.inbox WHERE consumer='funding-central-v1' AND job_type='funding_tenders.refresh' AND job_version=1 AND organization_id IS NULL AND idempotency_key=$1 AND execution_id=$2 AND claim_owner=$3 AND state='UNCERTAIN' FOR UPDATE",[envelope.idempotencyKey,envelope.executionId,workerId])).rows[0];
    if(!inbox)fail('OPPORTUNITY_V2_EU_WRITER_AUTHORITY_DENIED');
    return writer.releaseRetry(client,row,{executionId:envelope.executionId,inboxFence:Number(inbox.fence),workerId,consumer:'funding-central-v1'});
  }
  async function stage(run, batch, execution) { return transaction(async client => {
    const row = await locked(client, run, execution); if (row.collected) return;
    const writer=writerFor(row),archive=writer?.archive||candidateArchive;
    if(run.checkpoint?.input_cursor?.phase===discoveryDetails.PHASE&&(!enrichmentEnabled||!refreshEnabled))fail('FUNDING_DISCOVERY_MODE_DISABLED');
    if(batch.canonicalSnapshot&&!archive)fail('FUNDING_V2_ARCHIVE_REQUIRED');
    const official=OFFICIAL.includes(row.source_code);
    const hasOfficialCanonical=batch.canonicalCandidates!==undefined||batch.canonicalEvidence!==undefined;
    if(hasOfficialCanonical&&!candidateArchive)fail('FUNDING_V2_ARCHIVE_REQUIRED');
    if(hasOfficialCanonical&&!official)fail('FUNDING_V2_CANDIDATE_INVALID');
    if(official&&candidateArchive){
      if(!Array.isArray(batch.canonicalCandidates)||!batch.canonicalEvidence)fail('FUNDING_V2_CANDIDATE_REQUIRED');
      require('./candidateRepositoryV2').validateOfficialBatchV2(row.source_code,batch,{knownIdentifiers:run.knownIdentifiers||[]});
      const candidates=batch.canonicalCandidates;
      if(!Array.isArray(batch.records)||candidates.length!==batch.records.length||candidates.length>100
        ||new Set(candidates.map(item=>item.externalIdentifier)).size!==candidates.length)fail('FUNDING_V2_CANDIDATE_INVALID');
      for(let index=0;index<candidates.length;index++){
        const candidate=candidates[index],record=batch.records[index];
        if(candidate.externalIdentifier!==record.externalIdentifier)fail('FUNDING_V2_CANDIDATE_INVALID');
        await candidateArchive.stage(client,{run:row,batch:{outcome:'FOUND',observedAt:batch.observedAt,
          received:batch.canonicalEvidence.documents?.length,record,canonicalSnapshot:candidate.canonicalSnapshot,
          evidence:{kind:'OFFICIAL_PROGRAMME',externalIdentifier:record.externalIdentifier,
            sourceEvidence:batch.canonicalEvidence,fingerprint:batch.canonicalEvidence.fingerprint}}});
      }
      // Official bulk collection has no funding_batch cursor. Its durable run
      // marker prevents a restarted worker from dropping the archive obligation.
      const marked=await client.query('UPDATE opportunity_catalog.funding_run SET canonical_v2_required=true WHERE run_id=$1 RETURNING run_id',[run.run_id]);
      if(marked.rowCount!==1)fail('FUNDING_V2_CANDIDATE_INVALID');
    }
    if(archive&&batch.outcome==='FOUND'&&!batch.canonicalSnapshot)fail('FUNDING_V2_CANDIDATE_REQUIRED');
    if(batch.canonicalSnapshot)await archive.stage(client,{run:row,batch});
    const maintenance=refreshEnabled&&discoveryDetails.isDetailCursor(run.checkpoint?.input_cursor);
    for (const record of maintenance?(batch.record?[batch.record]:[]):batch.records) validateSourceIdentity(row.source_code, record.externalIdentifier);
    let records=maintenance?await require('./refresh').stage(client,run,batch,{resolutionEnabled:resolutionEnabled&&!writer,enrichmentEnabled,canonicalV2:Boolean(writer)}):run.checkpoint?await coverage.stage(client,row,batch):batch.records;
    if(batch.canonicalSnapshot){
      // Persist this requirement for KNOWN and new-identity detail jobs alike.
      // A restarted worker cannot downgrade already staged canonical evidence.
      const marked=await client.query("UPDATE opportunity_catalog.funding_batch SET next_cursor=COALESCE(next_cursor,'{}'::jsonb)||jsonb_build_object('canonicalV2Required',true) WHERE run_id=$1 AND input_cursor->>'phase' IN ('KNOWN','DISCOVERY_DETAIL') RETURNING run_id",[run.run_id]);
      if(marked.rowCount!==1)fail('FUNDING_CHECKPOINT_INVALID');
      if(writer)await client.query('UPDATE opportunity_catalog.funding_run SET canonical_v2_required=true WHERE run_id=$1',[run.run_id]);
    }
    if(refreshEnabled&&run.checkpoint&&!maintenance)records=await require('./refresh').discovered(client,run.checkpoint,records,{enrichmentEnabled});
    for (const record of records) {
      const fields=boundedSourceFields(record.fields);
      if(resolutionEnabled)await client.query('INSERT INTO opportunity_catalog.funding_run_item(run_id,external_identifier,source_fields,source_resolution_id) VALUES($1,$2,$3,$4)',[run.run_id,record.externalIdentifier,fields,record.sourceResolutionId||null]);
      else await client.query('INSERT INTO opportunity_catalog.funding_run_item(run_id,external_identifier,source_fields) VALUES($1,$2,$3)', [run.run_id, record.externalIdentifier, fields]);
    }
    if(refreshEnabled&&run.knownIdentifiers&&!batch.limited){
      const present=new Set(records.map(record=>record.externalIdentifier)),missing=run.knownIdentifiers.filter(id=>!present.has(id));
      if(missing.length){
        await client.query("UPDATE opportunity_catalog.funding_identity SET source_review='ABSENT',source_reviewed_at=$2 WHERE external_identifier=ANY($1::text[])",[missing,batch.observedAt]);
        await client.query("UPDATE opportunity_catalog.funding_run SET error_code='SOURCE_KNOWN_REVIEW_REQUIRED' WHERE run_id=$1",[run.run_id]);
      }
    }
    await client.query('UPDATE opportunity_catalog.funding_run SET collected=true,observed_at=$2,result_count=$3,failed_count=$4,limited=$5 WHERE run_id=$1', [run.run_id, batch.observedAt, batch.received, maintenance?0:batch.failed, maintenance?false:batch.limited]);
    if(writer)await writer.assertExecution(client,{...row,collected:true,observed_at:batch.observedAt},execution);
  }); }
  async function pending(run,execution) { return transaction(async client => { await locked(client, run,execution); return (await client.query('SELECT * FROM opportunity_catalog.funding_run_item WHERE run_id=$1 AND result IS NULL ORDER BY external_identifier', [run.run_id])).rows; }); }
  async function apply(run, item, execution) { return transaction(async client => {
    const row = await locked(client, run, execution);
    const stored = (await client.query('SELECT * FROM opportunity_catalog.funding_run_item WHERE run_id=$1 AND external_identifier=$2 FOR UPDATE', [run.run_id, item.external_identifier])).rows[0];
    if (!stored || stored.result) return;
    const namespace = validateSourceIdentity(row.source_code, stored.external_identifier);
    const writer=writerFor(row);
    if(writer){
      const checkpoint=await coverage.load(client,run.run_id);
      if(!discoveryDetails.isDetailCursor(checkpoint?.input_cursor))fail('FUNDING_DISCOVERY_REQUIRES_LOOKUP');
      if(checkpoint.input_cursor.phase===discoveryDetails.PHASE)discoveryDetails.verifyStaged(checkpoint,stored,row.observed_at);
      return writer.apply(client,row,stored,execution);
    }
    const cascadeKey = namespace === SOURCE ? cascadeKeyFromUrl(stored.source_fields.officialUrl) : null;
    if (cascadeKey && cascadeKey !== stored.external_identifier) fail('FUNDING_RECONCILIATION_REQUIRED');
    // Do not create a second identity while the old topic-keyed record remains.
    if (cascadeKey) {
      const legacy = (await client.query('SELECT last_source_fields FROM opportunity_catalog.funding_identity WHERE external_identifier=$1', [stored.source_fields.callReference])).rows[0];
      if (legacy && cascadeKeyFromUrl(legacy.last_source_fields.officialUrl)) fail('FUNDING_RECONCILIATION_REQUIRED');
    }
    const identity = (await client.query('SELECT * FROM opportunity_catalog.funding_identity WHERE external_identifier=$1 FOR UPDATE', [stored.external_identifier])).rows[0];
    if (identity && cascadeKeyFromUrl(identity.last_source_fields.officialUrl) !== cascadeKey) fail('FUNDING_RECONCILIATION_REQUIRED');
    const previous = identity ? (await client.query('SELECT o.*,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id WHERE o.opportunity_id=$1 FOR UPDATE OF o', [identity.opportunity_id])).rows[0] : null;
    const checkpoint=coverageEnabled&&namespace===SOURCE?await coverage.load(client,run.run_id):run.checkpoint;
    if(checkpoint?.input_cursor?.phase===discoveryDetails.PHASE&&(!enrichmentEnabled||!refreshEnabled))fail('FUNDING_DISCOVERY_MODE_DISABLED');
    if((checkpoint?.next_cursor?.canonicalV2Required===true||row.canonical_v2_required===true)&&!candidateArchive)fail('FUNDING_V2_ARCHIVE_REQUIRED');
    let verifiedResolution=false;
    if(previous?.snapshot?.sourceResolution||stored.source_resolution_id){
      if(!previous?.snapshot?.sourceResolution||!resolutionEnabled||!discoveryDetails.isDetailCursor(checkpoint?.input_cursor)||stored.source_resolution_id!==previous.snapshot.sourceResolution.resolutionId||!await require('./resolutions').verifyResolvedFields(client,{identity,previous,stored,observedAt:row.observed_at,enrichmentEnabled,requireArchive:Boolean(candidateArchive)}))fail('FUNDING_RESOLUTION_REQUIRES_LOOKUP');
      verifiedResolution=true;
    }
    if(enrichmentEnabled&&namespace===SOURCE){
      if(!identity&&checkpoint?.input_cursor?.phase!==discoveryDetails.PHASE)fail('FUNDING_DISCOVERY_REQUIRES_LOOKUP');
      if(checkpoint?.input_cursor?.phase===discoveryDetails.PHASE)discoveryDetails.verifyStaged(checkpoint,stored,row.observed_at);
    }
    if(candidateArchive&&namespace===SOURCE)await candidateArchive.verify(client,{run:row,externalIdentifier:stored.external_identifier,required:checkpoint?.next_cursor?.canonicalV2Required===true||!verifiedResolution});
    if(candidateArchive&&OFFICIAL.includes(namespace)){
      const checked=await candidateArchive.verify(client,{run:row,externalIdentifier:stored.external_identifier,required:true});
      if(!checked?.sourceFields||!require('node:util').isDeepStrictEqual(checked.sourceFields,stored.source_fields))fail('FUNDING_V2_CANDIDATE_INVALID');
    }
    const current = previous ? Object.fromEntries(FIELDS.filter(k => Object.hasOwn(previous.snapshot, k)).map(k => [k, previous.snapshot[k]])) : null;
    let incoming=boundedSourceFields(stored.source_fields);
    let merged = mergeSource({ previousSource: identity?.last_source_fields || null, current, incoming, corrections: identity?.corrections || {} });
    let opportunityId = identity?.opportunity_id, revisionId = previous?.current_revision_id, result = 'UNCHANGED';
    if (!previous || merged.sourceChanged || merged.effectiveChanged) {
      const command = { schemaVersion: 1, requestId: `funding:${run.run_id}:${stored.external_identifier}`, snapshot: { ...(previous?.snapshot || {}), ...merged.fields, schemaVersion: 1, provenanceId: createUuidV7(), lifecycleState: previous?.lifecycle_state || 'ACTIVE', validationState: merged.conflicts.length ? 'CONFLICT' : previous?.validation_state || 'PENDING_REVIEW', normalizationVersion: 'opportunity-normalization-v1', qualityRuleVersion: 'opportunity-quality-v1' }, provenance: { schemaVersion: 1, sourceType: namespace === SOURCE ? 'EU_FUNDING_API' : 'OFFICIAL_PROGRAMME', sourceNamespace: namespace, externalIdentifier: stored.external_identifier, ...(stored.source_fields.officialUrl ? { sourceUrl: stored.source_fields.officialUrl } : {}), observedAt: new Date(row.observed_at).toISOString() } };
      for (const key of FIELDS) if (!Object.hasOwn(merged.fields, key)) delete command.snapshot[key];
      // Bounded opaque key, independent of provider identifier length.
      command.requestId = require('node:crypto').createHash('sha256').update(command.requestId).digest('hex');
      const {jsonbBytes,fitEnrichment,MAX_BYTES}=require('../opportunities/sourceEnrichment');
      if(jsonbBytes(command)>32768&&incoming.sourceEnrichment&&!Object.hasOwn(merged.corrections,'sourceEnrichment')){
        const available=Math.min(MAX_BYTES,jsonbBytes(incoming.sourceEnrichment)-(jsonbBytes(command)-32768));
        if(available<1500)fail('OPPORTUNITY_LIMIT_EXCEEDED');
        incoming={...incoming,sourceEnrichment:fitEnrichment(incoming.sourceEnrichment,available)};
        merged=mergeSource({previousSource:identity?.last_source_fields||null,current,incoming,corrections:identity?.corrections||{}});
        command.snapshot={...command.snapshot,...merged.fields,validationState:merged.conflicts.length?'CONFLICT':previous?.validation_state||'PENDING_REVIEW'};
      }
      if(jsonbBytes(command)>32768)fail('OPPORTUNITY_LIMIT_EXCEEDED');
      const context = { actor: { type: 'SERVICE', reference: WORKER } };
      // Fitting may restore the already persisted bounded representation.
      if(!previous||merged.sourceChanged||merged.effectiveChanged){
        const updated = await catalog.withTransactionClient(client, () => previous ? catalog.update({ ...command, opportunityId, expectedRowVersion: Number(previous.row_version) }, context) : catalog.create(command, context));
        opportunityId = updated.opportunityId; revisionId = updated.revisionId; result = previous ? 'UPDATED' : 'CREATED';
        await client.query('RESET ROLE');
        await audit(client, { actor: { type: 'SERVICE', id: WORKER }, eventCode: previous ? 'OPPORTUNITY_REVISION_CREATED' : 'OPPORTUNITY_CREATED', requestId: command.requestId, resourceId: opportunityId, detailCode: 'FUNDING_APPLIED' });
      }
    }
    await client.query(`INSERT INTO opportunity_catalog.funding_identity(external_identifier,opportunity_id,last_source_fields,corrections,conflicts,observed_at,last_run_id) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(external_identifier) DO UPDATE SET last_source_fields=EXCLUDED.last_source_fields,corrections=EXCLUDED.corrections,conflicts=EXCLUDED.conflicts,observed_at=EXCLUDED.observed_at,last_run_id=EXCLUDED.last_run_id`, [stored.external_identifier, opportunityId, merged.sourceFields, merged.corrections, JSON.stringify(merged.conflicts), row.observed_at, run.run_id]);
    await client.query('INSERT INTO opportunity_catalog.funding_observation VALUES($1,$2,$3,$4,$5,$6,$7)', [run.run_id, stored.external_identifier, opportunityId, revisionId, row.observed_at, merged.sourceFields, JSON.stringify(merged.conflicts)]);
    if(refreshEnabled&&!run.checkpoint)await client.query('UPDATE opportunity_catalog.funding_identity SET source_review=NULL,source_reviewed_at=$2 WHERE external_identifier=$1',[stored.external_identifier,row.observed_at]);
    await client.query('UPDATE opportunity_catalog.funding_run_item SET result=$3,opportunity_id=$4 WHERE run_id=$1 AND external_identifier=$2', [run.run_id, stored.external_identifier, result, opportunityId]);
    const counter = { CREATED: 'created_count', UPDATED: 'updated_count', UNCHANGED: 'unchanged_count' }[result];
    await client.query(`UPDATE opportunity_catalog.funding_run SET ${counter}=${counter}+1 WHERE run_id=$1`, [run.run_id]);
  }); }
  async function finish(run, code = null, execution) { return transaction(async client => {
    const row = (await client.query("SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1 AND fence=$2 AND status='RUNNING' FOR UPDATE", [run.run_id, run.fence])).rows[0]; if (!row) fail('FUNDING_FENCE_STALE');
    code ||= row.error_code;
    const writer=writerFor(row);if(writer)await locked(client,run,execution);
    if(!writer&&resolutionEnabled&&run.checkpoint?.input_cursor?.phase==='KNOWN'&&['SOURCE_TIMEOUT','SOURCE_UNAVAILABLE','SOURCE_RESPONSE_INVALID','SOURCE_RESPONSE_TOO_LARGE','SOURCE_REJECTED'].includes(code)){
      // Error cleanup alone conveys no authority to modify catalog data. Recheck
      // both current admin authority and the live fenced lease before signalling.
      let admitted=false;
      try{await locked(client,run);admitted=true;}catch(error){if(!['FUNDING_FORBIDDEN','FUNDING_FENCE_STALE'].includes(error.code))throw error;}
      if(admitted)await client.query("UPDATE opportunity_catalog.funding_identity SET source_review='ERROR',source_reviewed_at=clock_timestamp() WHERE external_identifier=$1",[run.checkpoint.input_cursor.externalIdentifier]);
    }
    if(!code){
      await locked(client,run,execution);
      if(!row.collected||(await client.query('SELECT 1 FROM opportunity_catalog.funding_run_item WHERE run_id=$1 AND result IS NULL LIMIT 1',[run.run_id])).rows.length)fail('FUNDING_CHECKPOINT_INVALID');
    }
    const status = code || row.failed_count ? 'ERROR' : 'SUCCESS';
    if (code) {
      const pending = await client.query("UPDATE opportunity_catalog.funding_run_item SET result='FAILED' WHERE run_id=$1 AND result IS NULL RETURNING external_identifier", [run.run_id]);
      await client.query('UPDATE opportunity_catalog.funding_run SET failed_count=failed_count+$2 WHERE run_id=$1', [run.run_id, pending.rowCount]);
    }
    await audit(client, { actor: { type: 'SERVICE', id: WORKER }, eventCode: 'SERVICE_JOB_COMPLETED', requestId: `funding-finish:${run.run_id}`, detailCode: status === 'SUCCESS' ? 'FUNDING_COMPLETED' : 'FUNDING_FAILED' });
    if(writer)await writer.assertExecution(client,row,execution);
    const finished=(await client.query('UPDATE opportunity_catalog.funding_run SET status=$2,error_code=$3,finished_at=clock_timestamp(),lease_until=NULL WHERE run_id=$1 RETURNING *', [run.run_id, status, code || (row.failed_count ? 'SOURCE_RECORDS_REJECTED' : null)])).rows[0];
    if(coverageEnabled)await coverage.finish(client,finished,async checkpoint=>{
      await administrator(client,row.requested_by,true);
      const nextId=randomUUID();
      await client.query(writer?"INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code,eu_writer_mode,eu_writer_policy,eu_writer_mapping_digest) VALUES($1,$2,$3,'QUEUED',$4,$5,$6,$7)":"INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,status,source_code) VALUES($1,$2,$3,'QUEUED',$4)",[nextId,randomUUID(),row.requested_by,row.source_code,...(writer?[row.eu_writer_mode,row.eu_writer_policy,row.eu_writer_mapping_digest]:[])]);
      await client.query('INSERT INTO opportunity_catalog.funding_batch(run_id,cycle_id,ordinal,input_cursor) VALUES($1,$2,$3,$4)',[nextId,checkpoint.cycle_id,checkpoint.ordinal+1,checkpoint.next_cursor]);
      await dispatch(client,nextId);
      await audit(client,{actor:{type:'SERVICE',id:WORKER},eventCode:'SERVICE_JOB_DISPATCHED',requestId:`funding:${nextId}`,detailCode:'FUNDING_REQUESTED'});
    },refreshEnabled,enrichmentEnabled);
  }); }
  let catalogPresentation;
  // Validation, presentation and classification depend only on the snapshot, so
  // they are computed once per revision and reused while the stored snapshot is
  // byte-identical. Facts that depend on the reading time, corrections or source
  // review are never cached.
  const revisionFacts=new Map(),REVISION_FACTS_LIMIT=500;
  function computeRevisionFacts(snapshot,detail){
    const prepared=prepareOpportunitySnapshot(snapshot);
    const presentation=prepared.sourceVersion===2?(catalogPresentation ||= require('../opportunities/catalogRead/presentation').loadPresentation()).presentSnapshot(snapshot,{detail}):require('../opportunities/manualClassification').manualPresentation(snapshot);
    return {prepared,presentation,interventionClassification:require('../opportunities/interventionAreas').classifyInterventionAreas(snapshot,presentation)};
  }
  function revisionFactsFor(row,snapshot,detail){
    if(detail||!row.revisionId)return computeRevisionFacts(snapshot,detail);
    const source=JSON.stringify(snapshot);
    let entry=revisionFacts.get(row.revisionId);
    if(entry)revisionFacts.delete(row.revisionId);
    if(entry?.source!==source){
      entry={source,facts:require('../opportunities/v2/data').deepFreeze(computeRevisionFacts(snapshot,false))};
      if(revisionFacts.size>=REVISION_FACTS_LIMIT)revisionFacts.delete(revisionFacts.keys().next().value);
    }
    revisionFacts.set(row.revisionId,entry);
    return entry.facts;
  }
  function readRow(row,snapshot,asOf,detail=false){
    const {corrections,temporalSnapshot,canonicalObservedAt,...value}=row;
    const observedAt=snapshot.schemaVersion===2?canonicalObservedAt||null:row.observedAt instanceof Date?row.observedAt.toISOString():row.observedAt;
    const {prepared,presentation,interventionClassification}=revisionFactsFor(row,snapshot,detail);
    const readModel=createOpportunityReadModel(snapshot,{revisionId:row.revisionId,asOf,observedAt,sourceReview:row.sourceReview||null,corrections:corrections||{},prepared});
    const v2=readModel.sourceVersion===2;
    const namespaces=[...new Set(readModel.sourceRecords.map(source=>source.namespace))];
    const temporal=v2?{state:readModel.temporal.effectiveState,publishedState:readModel.temporal.publishedState,nextDeadline:readModel.temporal.nextDeadline?.at?.value||null,
      precision:readModel.temporal.nextDeadline?.at?.precision||null,openingKnown:readModel.projection.schedule.opening.state==='PRESENT'}
      :require('../opportunities/temporal').temporalState(snapshot,asOf,corrections||{},row.sourceReview);
    const aliases=v2?{observedAt:readModel.freshness.observedAt,programmeName:readModel.projection.programmes.state==='PRESENT'&&readModel.projection.programmes.value.length===1?readModel.projection.programmes.value[0].label:null,
      funderName:null,callReference:null,openingDate:readModel.projection.schedule.opening.value?.value||null,closingDate:readModel.temporal.finalDeadline?.at?.value||null,funding:null}:{};
    return {...value,...aliases,interventionClassification,...(presentation?{catalogPresentation:presentation}:{}),title:readModel.projection.description.title.value,readModel,temporal,origin:'CENTRAL',
      source:v2?(namespaces.length===1?namespaces[0]:'MULTIPLE_SOURCES'):row.externalIdentifier?namespaceForIdentity(row.externalIdentifier):'C4G_MANUAL'};
  }
  async function list(input = null, platformUserId = null) { const query = catalogQuery(typeof input === 'string' ? { cursor: input } : input || {}); return transaction(async client => {
    if (platformUserId !== null) await administrator(client, platformUserId);
    const asOf=Date.prototype.toISOString.call(clock());
    const closing=`CASE WHEN ${isV2('r.snapshot')} THEN COALESCE(${civilDateSql('left(schedule.next_deadline,10)')},CASE WHEN schedule.final_deadline_at->>'precision' IN ('DATE','INSTANT') THEN ${civilDateSql("left(schedule.final_deadline_at->>'value',10)")} END) ELSE COALESCE(left(schedule.next_deadline,10)::date,o.closing_date) END`;
    const fields=`o.opportunity_id AS "opportunityId",o.current_revision_id AS "revisionId",o.row_version AS "rowVersion",o.title,o.programme_name AS "programmeName",o.funder_name AS "funderName",o.call_reference AS "callReference",o.opening_date::text AS "openingDate",o.closing_date::text AS "closingDate",o.lifecycle_state AS "lifecycleState",o.validation_state AS "validationState",f.external_identifier AS "externalIdentifier",f.observed_at AS "observedAt",to_jsonb(o)->>'last_v2_observed_at' AS "canonicalObservedAt",jsonb_build_object('fundingAmountMin',r.snapshot->'fundingAmountMin','fundingAmountMax',r.snapshot->'fundingAmountMax','currencyCode',r.snapshot->'currencyCode','summary',r.snapshot->'summary') AS funding,r.snapshot AS "temporalSnapshot",f.corrections,to_jsonb(f)->>'source_review' AS "sourceReview"`;
    const joins=`FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id LEFT JOIN opportunity_catalog.funding_identity f ON f.opportunity_id=o.opportunity_id`;
    const temporalJoin=require('../opportunities/temporalSql').temporalSql({corrections:'f.corrections',sourceReview:"to_jsonb(f)->>'source_review'",now:'$7::timestamptz',today:"($7::timestamptz AT TIME ZONE 'UTC')::date"});
    const filters=`($2::text IS NULL OR strpos(lower(${titleExpression()}),lower($2))>0 OR strpos(lower(f.external_identifier),lower($2))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${referenceValuesExpression()}) reference(value) WHERE strpos(lower(reference.value),lower($2))>0))
      AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${programmeLabelsExpression()}) programme(value) WHERE strpos(lower(programme.value),lower($3))>0))
      AND ($4::date IS NULL OR (${closing}) >= $4)
      AND ($5::date IS NULL OR (${closing}) <= $5)
      AND ($6::text IS NULL OR temporal.temporal_state=$6)
      AND ($8::text[] IS NULL OR CASE WHEN ${isV2('r.snapshot')}
        THEN EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot->'sourceRecords') source WHERE source->>'namespace'=ANY($8))
        ELSE (CASE WHEN f.external_identifier IS NULL THEN 'C4G_MANUAL'
          WHEN f.external_identifier ~ '^(INTERREG_EUROPE|POCTEP):2021-2027:CALL:[1-9][0-9]{0,2}$' THEN split_part(f.external_identifier,':',1)
          ELSE 'EU_FUNDING_TENDERS' END)=ANY($8) END)`;
    let pageSql=`SELECT ${fields} ${joins} ${temporalJoin}
      WHERE ($1::uuid IS NULL OR o.opportunity_id>$1) AND ${filters}
      ORDER BY o.opportunity_id LIMIT 26`;
    if (query.sort) {
      const { order, extraJoin } = catalogSortSql(query.sort);
      pageSql=`WITH ranked AS (
        SELECT o.opportunity_id, row_number() OVER (ORDER BY ${order}, o.opportunity_id) AS position
        ${joins} ${temporalJoin} ${extraJoin} WHERE ${filters}
      ), page_ids AS (
        SELECT opportunity_id, position FROM ranked
        WHERE $1::uuid IS NULL OR position > (SELECT position FROM ranked WHERE opportunity_id=$1)
        ORDER BY position LIMIT 26
      )
      SELECT ${fields} ${joins} JOIN page_ids ON page_ids.opportunity_id=o.opportunity_id ORDER BY page_ids.position`;
    }
    const candidates=[]; let scanCursor=query.cursor||null, scannedPages=0;
    for (;;) {
    const rows = (await client.query(pageSql, [scanCursor, query.q || null, query.programme || null, query.closingFrom || null, query.closingTo || null,query.temporalState||null,asOf,query.source?sourceNamespaces(query.source):null])).rows;
    for(const row of rows){
      const item=readRow(row,row.temporalSnapshot,asOf);
      const matchesSource=!query.source || (item.readModel.sourceVersion===2
        ? item.readModel.sourceRecords.some(source=>sourceNamespaces(query.source).includes(source.namespace))
        : sourceNamespaces(query.source).includes(item.source));
      const matchesArea=!query.interventionArea || (query.interventionArea==='UNCLASSIFIED'
        ? item.interventionClassification.status==='UNCLASSIFIED'
        : item.interventionClassification.areas.some(a=>a.code===query.interventionArea));
      if(matchesSource&&matchesArea)candidates.push(item);
    }
    if(!(query.interventionArea||query.source) || candidates.length>=26 || rows.length<26)break;
    const last=rows.at(-1).opportunityId; if(last===scanCursor || ++scannedPages>=400)fail('CATALOG_RESPONSE_TOO_LARGE'); scanCursor=last;
    }
    const programmes = (await client.query(`SELECT DISTINCT programme.value AS name FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id CROSS JOIN LATERAL jsonb_array_elements_text(${programmeLabelsExpression()}) programme(value) WHERE programme.value <> '' ORDER BY name`)).rows.map(r => r.name);
    return boundedCatalogPage(candidates,{programmes:catalogueProgrammes(programmes),asOf,opportunityTypes:require('../opportunities/manualClassification').OPPORTUNITY_TYPES,interventionAreas:require('../opportunities/interventionAreas').INTERVENTION_AREAS});
  }, true); }
  async function get(id, platformUserId = null) { if (!UUID.test(id)) fail('INVALID_INPUT'); return transaction(async client => {
    if (platformUserId !== null) await administrator(client, platformUserId);
    const row = (await client.query(`SELECT o.opportunity_id AS "opportunityId",o.current_revision_id AS "revisionId",o.row_version AS "rowVersion",o.lifecycle_state AS "lifecycleState",o.validation_state AS "validationState",o.created_at AS "createdAt",r.snapshot,f.external_identifier AS "externalIdentifier",f.observed_at AS "observedAt",to_jsonb(o)->>'last_v2_observed_at' AS "canonicalObservedAt",f.conflicts,f.corrections,to_jsonb(f)->>'source_review' AS "sourceReview" FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id LEFT JOIN opportunity_catalog.funding_identity f ON f.opportunity_id=o.opportunity_id WHERE o.opportunity_id=$1`, [id])).rows[0];
    if (!row) fail('RESOURCE_NOT_AVAILABLE'); return assertDetailSize(readRow(row,row.snapshot,Date.prototype.toISOString.call(clock()),true));
  }, true); }
  async function revision(id, revisionId) { if (!UUID.test(id) || !UUID.test(revisionId)) fail('INVALID_INPUT'); return transaction(async client => {
    const row = (await client.query(`SELECT r.snapshot FROM opportunity_catalog.revision r LEFT JOIN opportunity_catalog.funding_identity f USING(opportunity_id) JOIN opportunity_catalog.opportunity o USING(opportunity_id)
      WHERE r.opportunity_id=$1 AND r.revision_id=$2 AND o.lifecycle_state<>'ARCHIVED'`, [id, revisionId])).rows[0];
    if (!row) fail('RESOURCE_NOT_AVAILABLE'); require('../opportunities/v2/compatibility').readOpportunitySnapshot(row.snapshot); return row.snapshot;
  }, true); }
  function platformList(userId, input) { if (!UUID.test(userId)) fail('FUNDING_FORBIDDEN'); return list(input, userId); }
  function platformGet(userId, id) { if (!UUID.test(userId)) fail('FUNDING_FORBIDDEN'); return get(id, userId); }
  const dashboardSummary=(today,asOf)=>transaction(client=>require('../applications/opportunitySummary').opportunitySummary(client,{today,asOf,central:true}),true);
  return { euSourceControlEnabled,sourceExecutionAllowed,...(euWriter?{euWriterSupported:true,euWriterPolicyVersion:euWriter.configuration.policyVersion,euWriterMappingDigest:euWriter.configuration.mappingDigest}:{}),discoveryDetailSupported:enrichmentEnabled, enrichmentSupported:enrichmentEnabled, resolutionSupported:resolutionEnabled, refreshSupported:refreshEnabled, transaction, administrator, enqueue, status, claim, stage, pending, apply, finish, releaseRetry, list, get, revision, platformList, platformGet,dashboardSummary, reconcileCoverage:coverageEnabled?async client=>{await coverage.reconcile(client,Boolean(euWriter));if(refreshEnabled)await require('./refresh').reconcile(client);}:null };
}
module.exports = { createFundingRepository, publicRun, WORKER };
