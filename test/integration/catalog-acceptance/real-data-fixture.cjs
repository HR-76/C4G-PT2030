'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadStoredCatalog } = require('../../../backend/src/opportunities/catalogRead/storedEvidence');
const { publishStoredCatalog } = require('../../../backend/src/opportunities/catalogRead/isolatedStoredPublisher');
async function prepare({ db, catalog, check }) {
  const corpus = loadStoredCatalog(path.resolve(__dirname, '../../../context/references/opportunity-v2/evidence'));
  const args = { pool: db.central.pool, target: catalog.target, isolated: true, corpus, asOf: new Date().toISOString() };
  await db.central.pool.query('REVOKE INSERT ON catalog_read.generation FROM c4g_catalog_projection_writer');
  try {
    await assert.rejects(() => publishStoredCatalog(args));
    assert.equal((await db.central.pool.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity')).rows[0].n, 0);
    assert.equal((await db.central.pool.query('SELECT count(*)::int n FROM opportunity_catalog.revision')).rows[0].n, 0);
  } finally { await db.central.pool.query('GRANT INSERT ON catalog_read.generation TO c4g_catalog_projection_writer'); }
  check('FAILED_PUBLICATION_ROLLS_BACK_OPPORTUNITIES_AND_REVISIONS');
  const initial = await publishStoredCatalog(args);
  assert.equal(initial.count, 178);
  const replay = await publishStoredCatalog(args);
  assert(replay.replay); assert.equal(replay.inserted, 0);
  assert.equal((await db.central.pool.query('SELECT count(*)::int n FROM opportunity_catalog.revision')).rows[0].n, 178);
  assert.equal((await db.central.pool.query("SELECT count(*)::int n FROM opportunity_catalog.opportunity WHERE validation_state='PENDING_REVIEW'")).rows[0].n, 178);
  const archives = (await db.central.pool.query("SELECT normalized_projection FROM opportunity_catalog.revision WHERE jsonb_array_length(normalized_projection->'artifacts')>0")).rows;
  assert.equal(archives.length, 2);
  for (const row of archives) for (const artifact of row.normalized_projection.artifacts) assert.equal(createHash('sha256').update(Buffer.from(artifact.base64, 'base64')).digest('hex'), artifact.sha256);
  check('REAL_CORPUS_178_IDEMPOTENT_PRESERVED_PENDING_REVIEW');
  catalog.seed = () => publishStoredCatalog({ ...args, asOf: new Date().toISOString() });
  return { ...initial, persistedRevisions: 178, evidenceArchives: archives.length, realData: true };
}
module.exports = { prepare };
