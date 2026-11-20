'use strict';
// Disposable PostgreSQL proof: the creator of an application joins its team (Técnico).
// Real tenant schema (full registered baseline), real runtime login and RLS, the real application repository.
// Authorization and audit are stubbed: this proves the team rows, revisions, RLS and rollback only.
// Run (disposable local instance only):
//   $env:F13_S2_DISPOSABLE_PROOF='C4G_F13_S2_DISPOSABLE_V1'; $env:F13_S2_ADMIN_URL='postgresql://c4g_f12_admin:<password>@127.0.0.1:<port>/postgres'
//   node test/integration/application-creator-team/proof.js
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Pool } = require('../../../backend/node_modules/pg');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const { manifest } = require('../../../backend/src/security/tenantMigrationManifest');
const { createApplicationRepository } = require('../../../backend/src/applications/repository');
const { command } = require('../../../backend/src/applications/contracts');

async function main() {
  if (process.env.F13_S2_DISPOSABLE_PROOF !== 'C4G_F13_S2_DISPOSABLE_V1') throw new Error('Disposable proof required.');
  const url = new URL(process.env.F13_S2_ADMIN_URL);
  if (url.hostname !== '127.0.0.1' || ['5432', '5433'].includes(url.port)) throw new Error('Unsafe target.');
  const admin = new Pool({ connectionString: url.toString() }), checks = [];
  const check = (name, fn) => fn().then(() => checks.push(['PASS', name]), error => { checks.push(['FAIL', name, error.message]); throw error; });
  let tenantPool, limited;
  try {
    for (const role of ['c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime'])
      await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_import_worker_runtime') THEN CREATE ROLE c4g_import_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
    await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
    const org = randomUUID(), generation = randomUUID(), name = 'c4g_tenant_creator_team';
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
    const tenantUrl = new URL(url); tenantUrl.pathname = `/${name}`;
    tenantPool = new Pool({ connectionString: tenantUrl.toString(), max: 4 });
    await tenantPool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await tenantPool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
    await tenantPool.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
    await tenantPool.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
    await tenantPool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
    const input = { tenantId: org, databaseGenerationId: generation, expectedRevision: 1, correlationId: 'creator-team', idempotencyKey: 'creator-team' };
    await createTenantMigrationRunner({ pool: tenantPool, entries: manifest, observationPublisher: { async publish() {} }, timeoutMs: 60000, scheduler: { setTimeout, clearTimeout } }).migrate(input);
    const login = 'c4g_creator_team_api', password = randomBytes(32).toString('hex');
    const provisioner = await require('../../../backend/src/security/localTenantIdentityProvisioner').createLocalTenantIdentityProvisioner(admin);
    await provisioner.reconcile({ apiLogin: login, workerLogin: 'c4g_creator_team_worker', apiPassword: password, workerPassword: randomBytes(32).toString('hex'),
      apiRoles: ['c4g_opportunity_tenant_runtime'], workerRoles: ['c4g_opportunity_tenant_runtime'] });
    await tenantPool.query(`GRANT CONNECT ON DATABASE ${name} TO ${login}`);
    const limitedUrl = new URL(tenantUrl); limitedUrl.username = login; limitedUrl.password = password;
    limited = new Pool({ connectionString: limitedUrl.toString(), max: 4 });

    const technician = { id: randomUUID(), membershipId: randomUUID() }, manager = { id: randomUUID(), membershipId: randomUUID() }, other = randomUUID();
    const sources = new Map(), revisions = new Map();
    const source = () => { const opportunityId = randomUUID(), revisionId = randomUUID(), snapshot = { schemaVersion: 1, title: 'Fonte sintética', lifecycleState: 'ACTIVE', closingDate: '2099-12-31' };
      sources.set(opportunityId, { revisionId, snapshot }); revisions.set(revisionId, { opportunityId, snapshot }); return { opportunityId, centralRevisionId: revisionId }; };
    const origins = [source(), source(), source()];
    const inTransaction = async (organizationId, membershipId, fn) => {
      const client = await limited.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
        await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true),set_config('app.notice_admin','false',true)", [organizationId, membershipId]);
        const result = await fn(client); await client.query('COMMIT'); return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    };
    const repo = (actor, joins) => createApplicationRepository({ organizationId: org, actor, protect: async () => {}, authorize: async () => true,
      verifyResponsible: async () => true, cursor: { cursor: String, openCursor: value => /^\d+$/.test(value) ? Number(value) : value },
      centralOrigin: async (id, revision) => { const value = revisions.get(revision); if (!value || value.opportunityId !== id) throw Object.assign(Error(), { code: 'RESOURCE_NOT_AVAILABLE' }); return structuredClone(value.snapshot); },
      centralCurrent: async id => structuredClone(sources.get(id)), audit: async () => {}, creatorJoinsTeam: async () => joins });
    const body = (o, extra = {}) => command('create', { origin: 'CENTRAL', ...o, evaluationId: null, title: 'Projeto sintético', responsibleMembershipId: manager.membershipId, deadline: '2099-11-30', idempotencyKey: randomUUID(), ...extra });
    const team = async applicationId => ({
      participants: (await tenantPool.query('SELECT membership_id,active FROM opportunity_catalog.application_participant WHERE organization_id=$1 AND application_id=$2 ORDER BY added_at,membership_id', [org, applicationId])).rows,
      work: (await tenantPool.query('SELECT revision FROM opportunity_catalog.application_work WHERE organization_id=$1 AND application_id=$2', [org, applicationId])).rows.map(r => Number(r.revision)),
      changes: (await tenantPool.query('SELECT revision,kind,membership_id,actor_subject_id FROM opportunity_catalog.application_work_change WHERE organization_id=$1 AND application_id=$2 ORDER BY revision', [org, applicationId])).rows });

    let created;
    await check('technician creator joins the team of the new application (runtime login, RLS)', async () => {
      created = await inTransaction(org, technician.membershipId, client => repo(technician, true).create(client, body(origins[0])));
      const rows = await team(created.applicationId);
      assert.deepEqual(rows.participants.map(r => [r.membership_id, r.active]), [[technician.membershipId, true]]);
      assert.deepEqual(rows.work, [2]);
      assert.deepEqual(rows.changes.map(r => [Number(r.revision), r.kind, r.membership_id, r.actor_subject_id]), [[2, 'PARTICIPANT_ADDED', technician.membershipId, technician.id]]);
    });
    await check('explicit responsible plus creator join with consecutive revisions; same person only once', async () => {
      const both = await inTransaction(org, technician.membershipId, client => repo(technician, true).create(client, body(origins[1], { includeResponsibleInTeam: true })));
      const rows = await team(both.applicationId);
      assert.equal(rows.participants.length, 2); assert.deepEqual(rows.work, [3]); assert.deepEqual(rows.changes.map(r => Number(r.revision)), [2, 3]);
      const same = await inTransaction(org, technician.membershipId, client => repo(technician, true).create(client, body(origins[2], { responsibleMembershipId: technician.membershipId, includeResponsibleInTeam: true })));
      const sameRows = await team(same.applicationId);
      assert.equal(sameRows.participants.length, 1); assert.deepEqual(sameRows.work, [2]);
    });
    await check('a non-technician creator adds nobody to the team', async () => {
      const app = await inTransaction(org, manager.membershipId, client => repo(manager, false).create(client, body(origins[0])));
      const rows = await team(app.applicationId);
      assert.deepEqual([rows.participants.length, rows.work.length, rows.changes.length], [0, 0, 0]);
    });
    await check('another organization cannot see or touch the team rows (RLS)', async () => {
      const seen = await inTransaction(other, technician.membershipId, client => client.query('SELECT count(*)::int n FROM opportunity_catalog.application_participant'));
      assert.equal(seen.rows[0].n, 0);
      await assert.rejects(inTransaction(other, technician.membershipId, client => client.query('INSERT INTO opportunity_catalog.application_participant(organization_id,application_id,membership_id) VALUES($1,$2,$3)', [org, created.applicationId, randomUUID()])));
    });
    await check('a failure after the team rows rolls back the application and the team together', async () => {
      const before = Number((await tenantPool.query('SELECT count(*) n FROM opportunity_catalog.application_participant')).rows[0].n);
      const failing = createApplicationRepository({ organizationId: org, actor: technician, protect: async () => {}, authorize: async () => true, verifyResponsible: async () => true,
        cursor: { cursor: String, openCursor: String }, centralOrigin: async () => ({ schemaVersion: 1, title: 'x', lifecycleState: 'ACTIVE', closingDate: '2099-12-31' }),
        centralCurrent: async id => ({ revisionId: 'x', opportunityId: id }), audit: async () => { throw Error('SYNTHETIC_AUDIT_FAILURE'); }, creatorJoinsTeam: async () => true });
      await assert.rejects(inTransaction(org, technician.membershipId, client => failing.create(client, body(origins[0]))));
      assert.equal(Number((await tenantPool.query('SELECT count(*) n FROM opportunity_catalog.application_participant')).rows[0].n), before);
    });
  } finally {
    for (const line of checks) console.log(line.join(' | '));
    await limited?.end().catch(() => {}); await tenantPool?.end().catch(() => {}); await admin.end().catch(() => {});
  }
  if (checks.some(line => line[0] === 'FAIL')) process.exitCode = 1; else console.log('APPLICATION_CREATOR_TEAM_PASS');
}
main().catch(error => { console.error('APPLICATION_CREATOR_TEAM_FAILED', error.code || error.name, error.message, error.cause?.message || '', error.internalCode || '', JSON.stringify(error.details || error.evidence || '').slice(0, 400)); process.exitCode = 1; });
