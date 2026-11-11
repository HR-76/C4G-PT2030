'use strict';
// Local-only: creates the service account that requests the scheduled Funding & Tenders collection and enables
// the schedule in runtime.json. Dry-run by default; --apply writes. The account is an ACTIVE global_user with an
// ACTIVE C4G_ADMIN assignment and NO identity reference, so nobody can sign in as it. Nothing else changes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const cfg = require('./config');

const EMAIL = 'funding-scheduler@service.c4g.invalid';
const NAME = 'Agendador de recolha (serviço)';
const FILE = path.join(cfg.folder, 'funding-service-account.json');

async function digest(pool, table, where = '', values = []) {
  const rows = (await pool.query(`SELECT to_jsonb(t)::text AS row FROM public.${table} t ${where} ORDER BY to_jsonb(t)::text`, values)).rows;
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.every(value => value === '--apply'));
  const apply = args.includes('--apply');
  const config = cfg.readConfig();
  const state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json')));
  assert.equal(state.phase, 'READY');
  assert.equal(config.port, 5432);
  assert.equal(config.centralDatabase, 'c4g_central_dev');
  assert.equal(state.target?.centralDatabase, config.centralDatabase);
  assert.equal(state.funding?.source, 'live-local', 'LOCAL_FUNDING_NOT_CONFIGURED');
  const record = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  const pool = new Pool(cfg.connection(config, config.centralDatabase));
  try {
    const bound = (await pool.query('SELECT id FROM public.global_user WHERE lower(primary_email)=lower($1)', [EMAIL])).rows;
    if (bound.length && bound[0].id !== record?.globalUserId) throw Object.assign(new Error('ACCOUNT_EMAIL_ALREADY_BOUND'), { code: 'ACCOUNT_EMAIL_ALREADY_BOUND' });
    const existing = bound.length === 1;
    const scheduleOn = Boolean(state.funding?.schedule?.userId);
    if (!apply) {
      console.log(JSON.stringify({ status: 'READY', accountExists: existing, scheduleEnabled: scheduleOn, plannedRole: 'C4G_ADMIN', interactiveLogin: false, sources: ['EU_FUNDING_TENDERS'], at: '04:00' }));
      return;
    }
    const folder = path.join(cfg.folder, `funding-schedule-backup-${Date.now()}`);
    fs.mkdirSync(folder);
    const sid = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).stdout.match(/S-1-5-[0-9-]+/)?.[0];
    assert(sid);
    assert.equal(spawnSync('icacls', [folder, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true }).status, 0);
    cfg.saveState(state, path.join(folder, 'runtime-before.json'));
    const identity = record || { globalUserId: randomUUID(), assignmentId: randomUUID(), email: EMAIL, createdAt: new Date().toISOString() };
    const others = () => Promise.all([digest(pool, 'organization_membership'), digest(pool, 'authority_f5_state'), digest(pool, 'global_user', 'WHERE id<>$1', [identity.globalUserId]),
      digest(pool, 'platform_admin_assignment', 'WHERE global_user_id<>$1', [identity.globalUserId]), digest(pool, 'auth_identity_ref')]);
    const before = await others();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(43001306,1)');
      await client.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(id) DO NOTHING", [identity.globalUserId, NAME, EMAIL]);
      await client.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE') ON CONFLICT(id) DO NOTHING", [identity.assignmentId, identity.globalUserId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    // Same two conditions FundingRepository.administrator() enforces, plus: nobody can authenticate as this account.
    const user = (await pool.query("SELECT id FROM public.global_user WHERE id=$1 AND status='ACTIVE'", [identity.globalUserId])).rows[0];
    const role = (await pool.query("SELECT id FROM public.platform_admin_assignment WHERE global_user_id=$1 AND role_code='C4G_ADMIN' AND status='ACTIVE'", [identity.globalUserId])).rows[0];
    assert(user && role);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.auth_identity_ref WHERE global_user_id=$1', [identity.globalUserId])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.organization_membership WHERE global_user_id=$1', [identity.globalUserId])).rows[0].n, 0);
    assert.deepEqual(await others(), before);
    cfg.saveState({ ...identity, status: 'READY', verifiedAt: new Date().toISOString() }, FILE);
    state.funding = { ...state.funding, schedule: { userId: identity.globalUserId } };
    cfg.saveState(state);
    console.log(JSON.stringify({ status: 'READY', platformRole: 'C4G_ADMIN', interactiveLogin: false, privateMemberships: 0, otherAccountsAndGrantsPreserved: true, scheduleEnabled: true, backup: path.basename(folder) }));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.code || error.message || 'FUNDING_SERVICE_ACCOUNT_FAILED'); process.exitCode = 1; });
