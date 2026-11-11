const assert = require('node:assert/strict');
const test = require('node:test');
const { Pool } = require('pg');
const { load } = require('../src/documents/migrationManifest');
const { documentPreflight } = require('../src/documents/preflight');

const connectionString = process.env.F11_TENANT_DATABASE_URL;
if (!connectionString) {
  test('F11 PostgreSQL integration requires an explicit disposable target', () => assert.equal(connectionString, undefined));
} else {
  test('DOC-AC-03/05/12/13/14/20/21/23/25 PostgreSQL 17 migration, isolation and retention', async () => {
    const target = new URL(connectionString);
    assert.ok(!['5432', '5433'].includes(target.port));
    assert.match(target.pathname, /^\/f11_synthetic_/);
    const pool = new Pool({ connectionString, max: 3 });
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const otherOrganizationId = '22222222-2222-4222-8222-222222222222';
    const documentId = '33333333-3333-4333-8333-333333333333';
    const versionId = '44444444-4444-4444-8444-444444444444';
    const objectId = '55555555-5555-4555-8555-555555555555';
    const resourceId = '66666666-6666-4666-8666-666666666666';
    const correlationId = '77777777-7777-4777-8777-777777777777';
    const checksum = 'a'.repeat(64);
    try {
      const version = Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num);
      assert.equal(Math.floor(version / 10000), 17);
      await pool.query(load('up').sql);
      assert.equal((await documentPreflight(pool)).ready, true);
      await pool.query(`INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id)
        VALUES($1,$2,'SYNTHETIC_RESOURCE',$3,'synthetic-actor',$4)`, [documentId, organizationId, resourceId, correlationId]);
      await pool.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,created_by_actor_id)
        VALUES($1,$2,$3,1,$4,'QUARANTINE',32,'PDF',$5,'application/pdf','synthetic.pdf','PENDING','NOT_REQUESTED','synthetic-idempotency',$6,'synthetic-actor')`, [versionId, documentId, organizationId, objectId, checksum, correlationId]);
      await assert.rejects(pool.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,created_by_actor_id)
        VALUES(gen_random_uuid(),$1,$2,2,gen_random_uuid(),'DOCUMENTS',32,'PDF',$3,'application/pdf','bad.pdf','AVAILABLE','PENDING','synthetic-bad',$4,'actor')`, [documentId, organizationId, checksum, correlationId]), /check constraint/);
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query('SET LOCAL ROLE c4g_document_runtime');
        await client.query(`SELECT set_config('app.organization_id',$1,true)`, [otherOrganizationId]);
        assert.equal((await client.query('SELECT count(*) FROM document_storage.document')).rows[0].count, '0');
        await assert.rejects(client.query(`UPDATE document_storage.document_version SET state='AVAILABLE'`), /permission denied/);
        await client.query('ROLLBACK');
      } finally { client.release(); }
      const deleteClient = await pool.connect();
      try {
        await deleteClient.query('BEGIN'); await deleteClient.query('SET LOCAL ROLE c4g_document_runtime');
        await deleteClient.query(`SELECT set_config('app.organization_id',$1,true)`, [organizationId]);
        await assert.rejects(deleteClient.query('DELETE FROM document_storage.document_version'), /permission denied/);
        await deleteClient.query('ROLLBACK');
      } finally { deleteClient.release(); }
      assert.equal((await pool.query('SELECT count(*) FROM document_storage.document_version')).rows[0].count, '1');
    } finally { await pool.end(); }
  });
}
