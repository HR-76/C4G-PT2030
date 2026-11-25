'use strict';
// Exercises the 051 write boundary as the runtime role, with synthetic rows only.
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('../../../backend/node_modules/pg');

const TYPE = 'MEMBER_INVITATION';
const sha = value => createHash('sha256').update(value).digest('hex');
const raised = message => error => error.message === message;

async function fixtures(pool) {
  const ids = {
    admin: randomUUID(), outsider: randomUUID(), orgAdminA: randomUUID(), contributorA: randomUUID(), orgAdminB: randomUUID(),
    orgA: randomUUID(), orgB: randomUUID(), inactiveOrg: randomUUID(),
  };
  const sessions = {};
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL session_replication_role='replica'");
    for (const key of ['admin', 'outsider', 'orgAdminA', 'contributorA', 'orgAdminB']) {
      await c.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic email test',$2,'ACTIVE')", [ids[key], ids[key] + '@example.invalid']);
    }
    for (const [key, status] of [['orgA', 'ACTIVE'], ['orgB', 'ACTIVE'], ['inactiveOrg', 'SUSPENDED']]) {
      await c.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,$2,$2,$3,'COMPANY',$4,'EUR','OPTIONAL')",
        [ids[key], 'Email test ' + key, 'email-test-' + key.toLowerCase(), status]);
    }
    await c.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')", [randomUUID(), ids.admin]);
    const session = async (key, user, membership, interval = '1 hour') => {
      sessions[key] = randomUUID();
      await c.query(`INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at,
        selected_organization_id,selected_membership_id,selected_membership_version)
        VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+$3::interval,$4,$5,$6)`,
        [sessions[key], user, interval, membership?.organization || null, membership?.id || null, membership ? 1 : null]);
    };
    const member = async (user, organization, role) => {
      const id = randomUUID();
      await c.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,$4,'ACTIVE',clock_timestamp())", [id, user, organization, role]);
      return { id, organization };
    };
    await session('admin', ids.admin);
    await session('outsider', ids.outsider);
    await session('expiredAdmin', ids.admin, null, '-1 hour');
    await session('orgAdminA', ids.orgAdminA, await member(ids.orgAdminA, ids.orgA, 'ORG_ADMIN'));
    await session('contributorA', ids.contributorA, await member(ids.contributorA, ids.orgA, 'CONTRIBUTOR'));
    await session('orgAdminB', ids.orgAdminB, await member(ids.orgAdminB, ids.orgB, 'ORG_ADMIN'));
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
  return { ids, sessions };
}

async function verify({ pool, port }) {
  const { ids, sessions } = await fixtures(pool);
  const runtime = new Pool({ host: '127.0.0.1', port, user: 'c4g_f12_admin', database: 'postgres', options: '-c role=c4g_central_runtime' });
  const template = async (who, actor, { organization = null, action = 'SAVE', subject = 'Convite', html = '<p>{LigacaoAtivacao} {Validade}</p>', request = randomUUID(), expected, id = randomUUID() }) =>
    (await runtime.query('SELECT * FROM public.email_template_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [sessions[who], ids[actor], TYPE, organization, id, action, subject, html, action === 'SAVE' ? sha(subject + '\n' + html) : null, request, expected])).rows[0];
  const logo = async (who, actor, { organization = null, content = Buffer.from('synthetic image bytes'), mime = 'image/png', width = 600, height = 200, request = randomUUID(), expected, publicId = randomBytes(16).toString('hex') }) =>
    (await runtime.query('SELECT * FROM public.email_logo_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [sessions[who], ids[actor], organization, randomUUID(), publicId, mime, width, height, content, request, expected])).rows[0];
  const current = async organization => (await runtime.query(
    'SELECT version,action,subject FROM public.email_template_version WHERE template_type=$1 AND organization_id IS NOT DISTINCT FROM $2 ORDER BY version DESC LIMIT 1',
    [TYPE, organization])).rows[0];

  try {
    // --- who is an administrator
    const admin = async (who, actor) => (await runtime.query('SELECT public.email_platform_admin($1,$2) AS ok', [sessions[who], ids[actor]])).rows[0].ok;
    assert.equal(await admin('admin', 'admin'), true);
    assert.equal(await admin('outsider', 'outsider'), false);
    assert.equal(await admin('expiredAdmin', 'admin'), false);
    assert.equal(await admin('admin', 'outsider'), false);
    const orgAdmin = async (who, actor, organization) => (await runtime.query('SELECT public.email_organization_admin($1,$2,$3) AS ok', [sessions[who], ids[actor], organization])).rows[0].ok;
    assert.equal(await orgAdmin('orgAdminA', 'orgAdminA', ids.orgA), true);
    assert.equal(await orgAdmin('orgAdminA', 'orgAdminA', ids.orgB), false);
    assert.equal(await orgAdmin('contributorA', 'contributorA', ids.orgA), false);
    assert.equal(await orgAdmin('admin', 'admin', ids.orgA), false);

    // --- templates: versions, idempotency, concurrency
    const first = { request: randomUUID(), expected: 0 };
    const v1 = await template('admin', 'admin', first);
    assert.equal(v1.version, 1);
    assert.equal(v1.organization_id, null);
    assert.equal(v1.created_by, ids.admin);
    assert.equal((await template('admin', 'admin', first)).id, v1.id, 'same request returns the same version');
    await assert.rejects(() => template('admin', 'admin', { ...first, subject: 'Outro' }), raised('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(() => template('admin', 'admin', { expected: 0 }), raised('STALE_REVISION'));
    await assert.rejects(() => template('admin', 'admin', { expected: null }), raised('STALE_REVISION'));
    const race = await Promise.allSettled([1, 2].map(() => template('admin', 'admin', { expected: 1, subject: 'Corrida' })));
    assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(race.find(item => item.status === 'rejected').reason.message, 'STALE_REVISION');

    // --- templates: authorization
    await assert.rejects(() => template('outsider', 'outsider', { expected: 2 }), raised('C4G_ADMIN_REQUIRED'));
    await assert.rejects(() => template('expiredAdmin', 'admin', { expected: 2 }), raised('C4G_ADMIN_REQUIRED'));
    await assert.rejects(() => template('orgAdminA', 'orgAdminA', { organization: ids.orgA, expected: 0 }), raised('C4G_ADMIN_REQUIRED'));
    await assert.rejects(() => template('admin', 'outsider', { expected: 2 }), raised('C4G_ADMIN_REQUIRED'));

    // --- templates: isolation between scopes
    const ownA = await template('admin', 'admin', { organization: ids.orgA, subject: 'Convite da A', expected: 0 });
    assert.equal(ownA.version, 1);
    assert.equal(ownA.organization_id, ids.orgA);
    assert.equal(await current(ids.orgB), undefined, 'entity B has no template of its own');
    assert.equal((await current(null)).version, 2, 'the global template is untouched by entity A');
    await assert.rejects(() => template('admin', 'admin', { organization: randomUUID(), expected: 0 }), raised('RESOURCE_NOT_AVAILABLE'));
    await assert.rejects(() => template('admin', 'admin', { organization: ids.inactiveOrg, expected: 0 }), raised('RESOURCE_NOT_AVAILABLE'));

    // --- templates: reset keeps history
    await assert.rejects(() => template('admin', 'admin', { organization: ids.orgB, action: 'RESET', expected: 0 }), raised('EMAIL_TEMPLATE_NOT_CUSTOMIZED'));
    const reset = await template('admin', 'admin', { organization: ids.orgA, action: 'RESET', expected: 1 });
    assert.deepEqual([reset.version, reset.action, reset.subject, reset.html, reset.content_sha256], [2, 'RESET', null, null, null]);
    await assert.rejects(() => template('admin', 'admin', { organization: ids.orgA, action: 'RESET', expected: 2 }), raised('EMAIL_TEMPLATE_NOT_CUSTOMIZED'));
    assert.equal((await runtime.query('SELECT count(*)::int AS n FROM public.email_template_version WHERE organization_id=$1', [ids.orgA])).rows[0].n, 2);
    assert.equal((await template('admin', 'admin', { organization: ids.orgA, subject: 'De novo', expected: 2 })).version, 3);

    // --- templates: stored content rules
    for (const bad of [{ subject: 'Linha\nBcc: x' }, { subject: ' espaço' }, { subject: 'x'.repeat(201) }, { subject: '' }, { html: '' }, { html: 'x'.repeat(20001) }]) {
      await assert.rejects(() => template('admin', 'admin', { ...bad, expected: 2 }), { code: '23514' });
    }
    await assert.rejects(() => runtime.query('SELECT * FROM public.email_template_write($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,2)',
      [sessions.admin, ids.admin, 'OUTRO_TIPO', randomUUID(), 'SAVE', 'Convite', '<p>x</p>', sha('x'), randomUUID()]), raised('STALE_REVISION'));
    await assert.rejects(() => runtime.query('SELECT * FROM public.email_template_write($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,0)',
      [sessions.admin, ids.admin, 'OUTRO_TIPO', randomUUID(), 'SAVE', 'Convite', '<p>x</p>', sha('x'), randomUUID()]), { code: '23514' });

    // --- logos: C4G logo
    const bytes = Buffer.from('synthetic png bytes');
    const c4g = await logo('admin', 'admin', { content: bytes, expected: 0 });
    assert.deepEqual([c4g.version, c4g.action, c4g.organization_id, c4g.size_bytes, c4g.sha256], [1, 'SET', null, bytes.length, sha(bytes)]);
    assert.match(c4g.public_id, /^[a-f0-9]{32}$/);
    await assert.rejects(() => logo('orgAdminA', 'orgAdminA', { expected: 1 }), raised('C4G_ADMIN_REQUIRED'));
    await assert.rejects(() => logo('admin', 'admin', { expected: 0 }), raised('STALE_REVISION'));
    await assert.rejects(() => logo('admin', 'admin', { expected: 1, publicId: c4g.public_id }), { code: '23505' });

    // --- logos: an entity's logo belongs to its own administrator
    const logoA = await logo('orgAdminA', 'orgAdminA', { organization: ids.orgA, expected: 0 });
    assert.deepEqual([logoA.version, logoA.organization_id, logoA.created_by], [1, ids.orgA, ids.orgAdminA]);
    await assert.rejects(() => logo('admin', 'admin', { organization: ids.orgA, expected: 1 }), raised('NOT_AUTHORIZED'));
    await assert.rejects(() => logo('orgAdminA', 'orgAdminA', { organization: ids.orgB, expected: 0 }), raised('NOT_AUTHORIZED'));
    await assert.rejects(() => logo('orgAdminB', 'orgAdminB', { organization: ids.orgA, expected: 1 }), raised('NOT_AUTHORIZED'));
    await assert.rejects(() => logo('contributorA', 'contributorA', { organization: ids.orgA, expected: 1 }), raised('NOT_AUTHORIZED'));
    await assert.rejects(() => logo('orgAdminA', 'orgAdminB', { organization: ids.orgA, expected: 1 }), raised('NOT_AUTHORIZED'));
    assert.equal((await runtime.query('SELECT count(*)::int AS n FROM public.email_logo_version WHERE organization_id=$1', [ids.orgB])).rows[0].n, 0);

    // --- logos: stored content rules
    for (const bad of [{ mime: 'image/svg+xml' }, { mime: 'image/gif' }, { width: 1201 }, { height: 601 }, { width: 0 }, { content: Buffer.alloc(524289) }, { content: Buffer.alloc(0) }, { publicId: 'not-hex' }]) {
      await assert.rejects(() => logo('orgAdminA', 'orgAdminA', { organization: ids.orgA, ...bad, expected: 1 }), { code: '23514' });
    }

    // --- logos: idempotency and removal
    const again = { organization: ids.orgA, request: randomUUID(), content: Buffer.from('second image'), expected: 1 };
    const logoA2 = await logo('orgAdminA', 'orgAdminA', again);
    assert.equal((await logo('orgAdminA', 'orgAdminA', again)).id, logoA2.id);
    await assert.rejects(() => logo('orgAdminA', 'orgAdminA', { ...again, content: Buffer.from('different image') }), raised('IDEMPOTENCY_CONFLICT'));
    const removed = await logo('orgAdminA', 'orgAdminA', { organization: ids.orgA, content: null, expected: 2 });
    assert.deepEqual([removed.version, removed.action, removed.public_id, removed.content, removed.size_bytes], [3, 'REMOVE', null, null, null]);
    await assert.rejects(() => logo('orgAdminA', 'orgAdminA', { organization: ids.orgA, content: null, expected: 3 }), raised('EMAIL_LOGO_NOT_SET'));
    await assert.rejects(() => logo('orgAdminB', 'orgAdminB', { organization: ids.orgB, content: null, expected: 0 }), raised('EMAIL_LOGO_NOT_SET'));
    // A removed logo stays readable by its public name, so emails already sent keep their image.
    assert.equal((await runtime.query('SELECT content FROM public.email_logo_version WHERE public_id=$1', [logoA.public_id])).rows[0].content.toString(), 'synthetic image bytes');

    // --- history cannot be rewritten, by the runtime or by an owner
    for (const table of ['email_template_version', 'email_logo_version']) {
      await assert.rejects(() => runtime.query(`UPDATE public.${table} SET version=99`), { code: '42501' });
      await assert.rejects(() => runtime.query(`DELETE FROM public.${table}`), { code: '42501' });
      await assert.rejects(() => runtime.query(`TRUNCATE public.${table}`), { code: '42501' });
      await assert.rejects(() => pool.query(`UPDATE public.${table} SET version=99`), { code: '55000' });
      await assert.rejects(() => pool.query(`DELETE FROM public.${table}`), { code: '55000' });
      await assert.rejects(() => pool.query(`TRUNCATE public.${table}`), { code: '55000' });
    }
    await assert.rejects(() => runtime.query("INSERT INTO public.email_template_version(id,template_type,version,action,created_by,request_id) VALUES($1,'MEMBER_INVITATION',50,'RESET',$2,$3)",
      [randomUUID(), ids.admin, randomUUID()]), { code: '42501' });
  } finally {
    await runtime.end();
  }
}

module.exports = { verify };
