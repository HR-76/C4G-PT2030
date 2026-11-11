'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

async function verifyDagConcurrency({ pool, service, creator, author, organizationId, setAfterLock }) {
  async function blocked(pid = null) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND ($1::int IS NULL OR pid=$1) AND cardinality(pg_blocking_pids(pid))>0
        AND query LIKE '%F13-TAXONOMY-DAG%'`, [pid]);
      if (result.rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('F13_DAG_EXPECTED_LOCK_WAIT_ABSENT');
  }
  for (const sqlMode of ['INSERT', 'UPDATE']) for (const first of ['FUNCTIONAL', 'SQL']) {
    const releaseId = crypto.randomUUID(), schemeId = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID(), c = crypto.randomUUID();
    const provenance = { sourceType: 'ORGANIZATION_MANUAL', observedAt: new Date().toISOString() };
    await service.createRelease({ releaseId, thematicSchemeId: schemeId, prioritySchemeId: crypto.randomUUID(),
      releaseVersion: `${sqlMode}-${first}-${releaseId}`.toLowerCase(), semanticDigest: 'a'.repeat(64), defaultLocale: 'pt-PT',
      idempotencyKey: crypto.randomUUID(), provenance }, creator.handle).catch(error=>{process.stderr.write(`DAG_SETUP_RELEASE_${error.code}\n`);throw error;});
    for (const [conceptId, stableCode] of [[a, 'A'], [b, 'B'], [c, 'C']]) {
      await service.createConcept({ releaseId, schemeId, schemeCode: 'THEMATIC_AREA', conceptId, stableCode,
        labels: [{ locale: 'pt-PT', kind: 'PREFERRED', label: stableCode }], idempotencyKey: crypto.randomUUID(), provenance }, author.handle);
    }
    const sqlRelationId = crypto.randomUUID(), functional = { relationId: crypto.randomUUID(), releaseId, schemeId,
      sourceConceptId: a, targetConceptId: b, relationType: 'PARENT', idempotencyKey: crypto.randomUUID(), provenance };
    if (sqlMode === 'UPDATE') await service.createRelation({ ...functional, relationId: sqlRelationId,
      sourceConceptId: c, targetConceptId: b, idempotencyKey: crypto.randomUUID() }, author.handle);
    const direct = await pool.connect();
    let resume = () => {}, pendingFunctional, pendingSql;
    try {
      await direct.query('BEGIN'); await direct.query('SET LOCAL ROLE c4g_organization_profile_runtime');
      await direct.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
      const pid = (await direct.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const mutate = () => sqlMode === 'INSERT'
        ? direct.query(`INSERT INTO organization_profile.concept_relation(relation_id,release_id,scheme_id,
            source_concept_id,target_concept_id,relation_type,provenance) VALUES($1,$2,$3,$4,$5,'PARENT','{}')`, [sqlRelationId, releaseId, schemeId, b, c])
        : direct.query('UPDATE organization_profile.concept_relation SET source_concept_id=$2,target_concept_id=$3 WHERE relation_id=$1', [sqlRelationId, b, c]);
      if (first === 'FUNCTIONAL') {
        let acquired;
        const locked = new Promise(resolve => { acquired = resolve; });
        const barrier = new Promise(resolve => { resume = resolve; });
        setAfterLock(async () => { acquired(); await barrier; });
        pendingFunctional = service.createRelation(functional, author.handle);
        await locked;
        pendingSql = mutate().then(() => null, error => error);
        // Direct statement is blocked before any tuple lock.
        for (let n = 0; n < 200; n++) {
          if ((await pool.query('SELECT cardinality(pg_blocking_pids($1)) AS n', [pid])).rows[0].n > 0) break;
          if (n === 199) throw new Error('F13_DIRECT_DAG_LOCK_WAIT_ABSENT');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        resume(); await pendingFunctional;
        assert.equal(await pendingSql, null); await direct.query('COMMIT');
      } else {
        await mutate();
        pendingFunctional = service.createRelation(functional, author.handle);
        await blocked(); await direct.query('COMMIT'); await pendingFunctional;
      }
      await service.createRelation(functional, author.handle);
      const rows = (await pool.query('SELECT source_concept_id,target_concept_id FROM organization_profile.concept_relation WHERE release_id=$1', [releaseId])).rows;
      assert.equal(rows.length, 2);
      assert.ok(rows.some(row => row.source_concept_id === a && row.target_concept_id === b));
      assert.ok(rows.some(row => row.source_concept_id === b && row.target_concept_id === c));
      assert.equal((await pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='TAXONOMY_RELATION_CREATED' AND event_data#>>'{resource,id}'=$1", [functional.relationId])).rows[0].n, 1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM organization_profile.taxonomy_idempotency_record WHERE idempotency_key=$1', [functional.idempotencyKey])).rows[0].n, 1);
    } finally {
      resume(); setAfterLock(null); await direct.query('ROLLBACK').catch(() => {});
      await Promise.allSettled([pendingFunctional, pendingSql].filter(Boolean)); direct.release();
    }
  }
  return true;
}
module.exports = { verifyDagConcurrency };
