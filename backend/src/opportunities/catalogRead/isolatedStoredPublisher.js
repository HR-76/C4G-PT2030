'use strict';
const { randomUUID } = require('node:crypto');
const { buildStoredCatalog } = require('./storedEvidence');
const { buildProjection, emptyExtension, stableId, digest } = require('./model');
const fail = code => { throw Object.assign(new Error(code), { code }); };

// Deliberately not registered in the normal server/worker. Requires an owned local
// rehearsal database and a privileged provisioning connection. Reader grants stay unchanged.
async function publishStoredCatalog({ pool, target, isolated, controlledAdmission, corpus, asOf = new Date().toISOString() }) {
  if (!require('./controlledTarget').matchesTarget(controlledAdmission, target) && (isolated !== true || !['127.0.0.1', 'localhost'].includes(target?.host) || !Number.isInteger(target.port) || target.port < 1024 || target.port === 5432
    || !/^(?:gcni_catalog_[a-f0-9]{12}|c4g_f13_authority_synthetic_central)$/.test(target.database))) fail('STORED_CATALOG_ISOLATED_TARGET_REQUIRED');
  // Rebuild from pinned artifacts, so caller edits cannot bypass validation/conflict checks.
  const files = Object.fromEntries((corpus?.artifacts || []).map(a => [a.name, Buffer.from(a.base64, 'base64')]));
  const checked = buildStoredCatalog(files);
  if (digest(checked) !== digest(corpus)) fail('STORED_CATALOG_CORPUS_CHANGED');
  if (!Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf || Date.parse(asOf) > Date.now()) fail('STORED_CATALOG_ASOF_INVALID');
  const options = pool?.options || {};
  let actual = options;
  if (options.connectionString) {
    const url = new URL(options.connectionString);
    actual = { host:url.hostname, port:Number(url.port || 5432), database:decodeURIComponent(url.pathname.slice(1)) };
  }
  if (actual.host !== target.host || Number(actual.port || 5432) !== target.port || actual.database !== target.database) fail('STORED_CATALOG_POOL_TARGET_MISMATCH');
  const generationId = stableId('stored-generation', checked.corpusDigest, asOf), acceptance = digest({ scope: 'OFFLINE_TECHNICAL_MAPPING_ONLY', manifest: checked.manifestDigest });
  const rows = checked.records.map(r => {
    const extension = emptyExtension(r.snapshot, { opportunityId: r.opportunityId, revisionId: r.revisionId,
      extensionId: stableId('stored-extension', r.revisionId), acceptanceDigest: acceptance, recordedAt: manifestRecordedAt(r.snapshot) });
    return { ...r, extension, projection: buildProjection(r.snapshot, extension, { asOf }) };
  });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout='30s'");
    await c.query('SELECT pg_advisory_xact_lock($1)', [42420178]);
    if ((await c.query('SELECT current_database() AS name')).rows[0].name !== target.database) fail('STORED_CATALOG_TARGET_MISMATCH');
    const source = await c.query('SELECT state FROM opportunity_catalog.eu_source_control_v2 FOR SHARE');
    if (source.rows.length !== 1 || source.rows[0].state !== 'QUIESCED') fail('STORED_CATALOG_SOURCES_NOT_QUIESCED');
    const existing = (await c.query('SELECT o.opportunity_id,o.current_revision_id,o.content_digest,r.normalized_projection FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id FOR UPDATE OF o')).rows;
    for (const old of existing) {
      const incoming = rows.find(r => r.opportunityId === old.opportunity_id);
      if (!incoming || old.normalized_projection?.offlineCorpus !== checked.corpusDigest || old.content_digest !== incoming.contentDigest || old.current_revision_id !== incoming.revisionId) fail('STORED_CATALOG_EXISTING_CONTENT_REQUIRES_REVIEW');
    }
    const already = await c.query('SELECT generation_id FROM catalog_read.generation WHERE generation_id=$1', [generationId]);
    if (already.rowCount) {
      const active = await c.query('SELECT generation_id FROM catalog_read.active_generation WHERE singleton');
      if (active.rows[0]?.generation_id !== generationId) fail('STORED_CATALOG_REPLAY_NOT_ACTIVE');
      await c.query('COMMIT');
      return { generationId, count: rows.length, inserted: 0, replay: true, counts: checked.counts };
    }
    for (const r of rows) {
      if (existing.some(old => old.opportunity_id === r.opportunityId)) continue;
      await c.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,content_digest,normalization_version,quality_rule_version,current_schema_version) VALUES($1,$2,1,1,'ACTIVE','PENDING_REVIEW',$3,$4,'opportunity-normalization-v2','opportunity-quality-v2.0',2)", [r.opportunityId, r.revisionId, r.snapshot.description.title.value, r.contentDigest]);
      // The immutable revision retains the exact evidence, not just a filesystem pointer.
      const anchor = rows.find(candidate => candidate.snapshot.sourceRecords[0].namespace === r.snapshot.sourceRecords[0].namespace);
      const sourceArtifacts = checked.artifacts.filter(a => r.snapshot.sourceRecords[0].namespace === 'PORTUGAL2030_PLAN' ? a.name.startsWith('pt2030-') : a.name.startsWith('eu-'));
      await c.query('INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,$4,$5,$6)',
        [r.revisionId, r.opportunityId, r.snapshot, { offlineCorpus: checked.corpusDigest, manifestDigest: checked.manifestDigest, evidenceRevisionId: anchor.revisionId, artifactHashes: sourceArtifacts.map(a => a.sha256), artifacts: anchor.revisionId === r.revisionId ? sourceArtifacts : [] }, { reviewRequired: true, contentApproval: 'NOT_PERFORMED', issues: r.snapshot.quality.issues }, r.contentDigest]);
    }
    await c.query('SET LOCAL ROLE c4g_catalog_projection_writer');
    await c.query('INSERT INTO catalog_read.generation(generation_id,as_of,expected_count) VALUES($1,$2,$3)', [generationId, asOf, rows.length]);
    for (const { extension: e } of rows) await c.query('INSERT INTO catalog_read.revision_extension(extension_id,opportunity_id,revision_id,source_digest,acceptance_digest,recorded_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(extension_id) DO NOTHING', [e.extensionId,e.opportunityId,e.revisionId,e.sourceDigest,e.acceptanceDigest,e.recordedAt,e]);
    await c.query('SET LOCAL ROLE c4g_catalog_projection_approver');
    for (const { projection: p } of rows) await c.query("INSERT INTO catalog_read.projection_approval(approval_id,projection_id,extension_id,acceptance_digest,payload_digest,expires_at,reason) VALUES($1,$2,$3,$4,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),clock_timestamp()+interval '30 minutes','Offline technical mapping; content remains pending review')", [randomUUID(), p.projectionId, p.extensionId, acceptance, p]);
    await c.query('SET LOCAL ROLE c4g_catalog_projection_writer');
    for (const { projection: p } of rows) {
      await c.query('INSERT INTO catalog_read.revision_projection(projection_id,opportunity_id,revision_id,extension_id,mapping_version,as_of,payload) VALUES($1,$2,$3,$4,$5,$6,$7)', [p.projectionId,p.opportunityId,p.revisionId,p.extensionId,p.version,p.asOf,p]);
      await c.query('INSERT INTO catalog_read.generation_item VALUES($1,$2,$3,$4)', [generationId,p.opportunityId,p.revisionId,p.projectionId]);
    }
    await c.query("UPDATE catalog_read.generation SET state='PUBLISHED',published_at=clock_timestamp() WHERE generation_id=$1", [generationId]);
    await c.query('INSERT INTO catalog_read.active_generation VALUES(true,$1) ON CONFLICT(singleton) DO UPDATE SET generation_id=EXCLUDED.generation_id', [generationId]);
    await c.query('COMMIT');
    return { generationId, count: rows.length, inserted: rows.length-existing.length, replay: false, counts: checked.counts };
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}
function manifestRecordedAt(snapshot) { return snapshot.provenance.observations.map(o => o.observedAt).sort().at(-1); }
module.exports = { publishStoredCatalog };
