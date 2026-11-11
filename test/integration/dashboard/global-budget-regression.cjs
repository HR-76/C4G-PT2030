const fs = require('fs'),
  path = require('path'),
  tls = require('tls'),
  { spawnSync } = require('child_process'),
  { randomUUID } = require('crypto'),
  assert = require('assert/strict');
const R = path.resolve(__dirname, '../../..'),
  dep = (n) => require(R + '/backend/node_modules/' + n),
  mod = (n) => require(R + '/' + n),
  pg = dep('pg'),
  express = dep('express');
const cfg = mod('backend/scripts/localPlatform/config'),
  config = cfg.readConfig(),
  state = JSON.parse(fs.readFileSync(cfg.folder + '/runtime.json')),
  salt = randomUUID().replaceAll('-', '').slice(0, 12),
  central = 'qa_dashboard_' + salt + '_c',
  tenant = 'qa_dashboard_' + salt + '_t',
  created = [],
  pools = [];
const db = (name, add = {}) => {
  const p = new pg.Pool({ ...cfg.connection(config, name), ...add });
  pools.push(p);
  return p;
};
const admin = db('postgres');
let browser, server, comp;
const inheritGuard = process.argv.includes('--inherit-guard');
const pendingLoginTest = inheritGuard || process.argv.includes('--pending-login');

async function clone(source, target, { centralCopy = false, copyGuard = false } = {}) {
  const meta = (
    await admin.query(
      'select pg_encoding_to_char(encoding) enc,datcollate,datctype,datlocprovider,datlocale from pg_database where datname=$1',
      [source],
    )
  ).rows[0];
  const lit = (v) => "'" + v.replaceAll("'", "''") + "'";
  await admin.query(
    'CREATE DATABASE ' +
      target +
      ' TEMPLATE template0 ENCODING ' +
      lit(meta.enc) +
      ' LC_COLLATE ' +
      lit(meta.datcollate) +
      ' LC_CTYPE ' +
      lit(meta.datctype) +
      (meta.datlocprovider === 'i'
        ? ' LOCALE_PROVIDER icu ICU_LOCALE ' + lit(meta.datlocale)
        : ' LOCALE_PROVIDER libc'),
  );
  created.push(target);
  await admin.query('ALTER DATABASE ' + target + ' SET timezone TO UTC');
  await admin.query('REVOKE ALL ON DATABASE ' + target + ' FROM PUBLIC');
  const args = ['-h', config.host, '-p', '5432', '-U', config.user],
    opts = {
      env: { ...process.env, PGPASSWORD: config.password },
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
    },
    bin = (process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin') + '/';
  // In-flight coordination belongs to the source installation. Its guards pin
  // the original tenant binding and cannot be recovered after clone rebinding.
  const exclusions = centralCopy
    ? ['authority_commit_guard', 'authority_write_request', 'authority_write_permit']
        .filter(table => !(copyGuard && table === 'authority_commit_guard'))
        .map(table => '--exclude-table-data=public.' + table)
    : [];
  const dump = spawnSync(bin + 'pg_dump.exe', [...args, ...exclusions, '-Fc', '-d', source], opts);
  assert.equal(dump.status, 0, 'dump failed');
  const rest = spawnSync(bin + 'pg_restore.exe', [...args, '--exit-on-error', '-d', target], {
    ...opts,
    input: dump.stdout,
  });
  if (rest.status) throw Error('restore ' + rest.stderr.toString().slice(0, 250));
  for (const r of (
    await admin.query(
      "select coalesce(quote_ident(pg_get_userbyid(a.grantee)),'PUBLIC') role,a.grantee,a.privilege_type from pg_database d cross join lateral aclexplode(coalesce(datacl,acldefault('d',datdba))) a where datname=$1",
      [source],
    )
  ).rows)
    await admin.query(
      'GRANT ' + r.privilege_type + ' ON DATABASE ' + target + ' TO ' + (r.grantee === 0 ? 'PUBLIC' : r.role),
    );
  console.log('isolated database ready', target);
}
async function cloneWithPendingLoginGuard() {
  const sourceName = 'qa_dashboard_' + salt + '_source';
  await clone(config.centralDatabase, sourceName, { centralCopy: true });
  const source = db(sourceName);
  const guardId = randomUUID();
  const snapshot = await mod('backend/src/security/tenantDirectoryRepository')
    .createTenantDirectoryRepository(source).resolveSnapshotByOrganization(state.organizationId, 'API');
  const digest = mod('backend/src/security/tenantAuthorityRecovery').snapshotDigest(snapshot);
  // An expired PREPARED operation overlaps the authenticating subject. If inherited,
  // session rotation must recover it, but its snapshot belongs to the original binding.
  const inserted = await source.query(`
    INSERT INTO public.authority_commit_guard (
      guard_id, organization_id, tenant_id, subject_id, membership_id, session_digest,
      scope_keys, protected_operations, authority_versions, normalized_assurance, authority_epoch,
      transaction_id, correlation_id, finalization_digest, source_binding, state, created_at, deadline
    )
    SELECT $1, organization_id, $2, global_user_id, id, repeat('0',64),
      ARRAY['SUBJECT:' || global_user_id::text], '[]', '{}', '{}', nextval('public.authority_epoch_seq'),
      $3, $4, repeat('0',64), $5, 'PREPARED', now()-interval '2 minutes', now()-interval '1 minute'
    FROM public.organization_membership WHERE organization_id=$6 AND global_user_id=$7
    RETURNING guard_id
  `, [guardId, state.tenantId, randomUUID(), randomUUID(), {snapshotDigest:digest,sourceOperation:'DIRECTORY_READ'},
    state.organizationId, state.managerId]);
  assert.equal(inserted.rowCount, 1, 'Falta a operação pendente do utilizador do teste');
  await clone(sourceName, central, { centralCopy: true, copyGuard: inheritGuard });
  const copied = await db(central).query('SELECT state FROM public.authority_commit_guard WHERE guard_id=$1', [guardId]);
  assert.deepEqual(copied.rows, inheritGuard ? [{state:'PREPARED'}] : [], 'Operação pendente na cópia');
  const original = await source.query('SELECT state FROM public.authority_commit_guard WHERE guard_id=$1', [guardId]);
  assert.equal(original.rows[0]?.state, 'PREPARED', 'A operação deve continuar pendente na origem');
}

async function loginToDashboard(browser) {
  const origin = 'http://localhost:3000';
  const access = JSON.parse(fs.readFileSync(cfg.folder + '/access.json')).hugo;
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  page.setDefaultTimeout(60000);
  await page.goto(origin + '/api/auth/oidc/login?returnTo=/dashboard');
  await page.locator('#username').fill(access.username);
  await page.locator('#password').fill(access.password);
  const [callback] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/oidc/callback'),
    page.locator('#kc-login').click(),
  ]);
  assert.equal(await callback.headerValue('X-Validation-Run'), salt);
  assert.equal(callback.status(), inheritGuard ? 503 : 302, 'Resposta do primeiro callback OIDC');
  if (inheritGuard) {
    assert.equal((await callback.json()).code, 'SESSION_PERSISTENCE_UNAVAILABLE');
    return {page};
  }
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/dashboard/summary')),
    page.goto(origin + '/dashboard'),
  ]);
  return { page, response };
}

async function verifyYearSelection(page, tenantPool, organizationId, currentYear) {
  const card = page.locator('[href="#approval-timeline"]'),
    chart = page.getByRole('region', { name: 'Evolução do orçamento aprovado' }),
    selector = chart.getByRole('combobox'),
    rows = chart.getByRole('listitem'),
    norm = (s) => s.replace(/\s+/g, ' ').trim();
  await selector.waitFor();
  function money(value) {
    if (value === null) return 'Não disponível';
    const [whole, decimal = ''] = value.split('.');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + decimal.padEnd(2, '0') + ' €';
  }
  async function expected(prefix) {
    const {
      rows: [r],
    } = await tenantPool.query(
      "select sum(total_budget)::text total,count(*)::int n,count(*) filter(where total_budget is null)::int missing from (select distinct on (application_id) recorded_at,total_budget from opportunity_catalog.application_change where organization_id=$1 and kind in ('CREATE','TRANSITION') and to_status='APPROVED' order by application_id,revision) first_approvals where to_char(recorded_at at time zone 'Europe/Lisbon','YYYY-MM') like $2",
      [organizationId, prefix + '%'],
    );
    return {
      amount: money(r.n ? r.total : '0.00'),
      detail:
        r.n +
        ' ' +
        (r.n === 1 ? 'aprovação' : 'aprovações') +
        (r.missing ? ' · ' + r.missing + ' sem valor' : ''),
    };
  }
  const before = norm(await card.innerText()),
    all = await expected(''),
    now = await expected(String(currentYear));
  assert.equal(norm(await card.locator('.stat-num').innerText()), all.amount);
  assert.ok(before.includes(currentYear + ' · ' + now.amount + ' · ' + now.detail));
  const months =
    'Janeiro Fevereiro Março Abril Maio Junho Julho Agosto Setembro Outubro Novembro Dezembro'.split(' ');
  const years = await selector
    .locator('option')
    .evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
  for (const offset of [0, 1, 2]) assert.ok(years.includes(String(currentYear - offset)));
  assert.equal(await rows.count(), years.length);
  for (const [i, y] of years.entries()) {
    const a = await expected(y);
    assert.equal(norm(await rows.nth(i).innerText()), y + ' ' + a.amount + ' ' + a.detail);
    await selector.selectOption(y);
    assert.equal(await rows.count(), 12);
    for (let j = 0; j < 12; j++) {
      const m = await expected(y + '-' + String(j + 1).padStart(2, '0'));
      assert.equal(norm(await rows.nth(j).innerText()), months[j] + ' ' + m.amount + ' ' + m.detail);
    }
    assert.equal(norm(await card.innerText()), before, 'O cartão global mudou ao selecionar ' + y);
    await selector.selectOption('');
    assert.equal(await rows.count(), years.length);
    assert.equal(norm(await card.innerText()), before, 'O cartão global mudou ao voltar a todos os anos');
    console.log('verified', y, a, '12 months');
  }
}

(async () => {
  try {
    console.log('A preparar as bases isoladas para o teste do Dashboard.');
    if (pendingLoginTest) await cloneWithPendingLoginGuard();
    else await clone(config.centralDatabase, central, { centralCopy: true });
    await clone(config.tenantDatabase, tenant);
    const c = db(central),
      t = db(tenant),
      auth = db(central, { user: 'c4g_authority_runtime', password: state.authorityPassword });
    const cred = { ...state.credentials, database: tenant };
    const coordination = await c.query(`SELECT
      (SELECT count(*) FROM public.authority_commit_guard) +
      (SELECT count(*) FROM public.authority_write_request) +
      (SELECT count(*) FROM public.authority_write_permit) AS inherited`);
    assert.equal(coordination.rows[0].inherited, inheritGuard ? '1' : '0', 'Número de operações herdadas na cópia');
    const hash = mod('backend/src/security/localTenantCredentialAdapter').bindingDigest({
      ...cred,
      workload: 'API',
    });
    const cl = await c.connect();
    try {
      await cl.query('BEGIN'); // Rebind the immutable directory entries only inside the disposable central copy.
      await cl.query('SET LOCAL session_replication_role=replica');
      await cl.query('UPDATE public.tenant_database_generation SET database_ref=$1 WHERE database_ref=$2', [
        tenant,
        config.tenantDatabase,
      ]);
      await cl.query(
        'UPDATE public.organization_connection_version SET database_ref=$1,binding_digest=CASE WHEN connection_version=$3 and credential_ref=$4 THEN $5 ELSE binding_digest END WHERE database_ref=$2',
        [tenant, config.tenantDatabase, cred.connectionVersion, cred.credentialRef, hash],
      );
      await cl.query(
        "UPDATE public.tenant_workload_connection_version SET binding_digest=$1 WHERE credential_ref=$2 AND tenant_id=$3 AND workload='API'",
        [hash, cred.credentialRef, state.tenantId],
      );
      await cl.query('COMMIT');
    } finally {
      cl.release();
    }
    const org = state.organizationId;
    // pg_dump omits explicit ACLs equal to the defaults; the schema fingerprint distinguishes them.
    const relations =
      "select n.nspname||'.'||c.relname k, c.relacl is not null explicit, format('%I.%I',n.nspname,c.relname) tbl, quote_ident(pg_get_userbyid(c.relowner)) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='organization_profile' and c.relkind='r'";
    const original = (await db(config.tenantDatabase).query(relations)).rows;
    for (const r of (await t.query(relations)).rows)
      if (!r.explicit && original.some((x) => x.k === r.k && x.explicit)) {
        await t.query('GRANT ALL PRIVILEGES ON TABLE ' + r.tbl + ' TO ' + r.owner);
        console.log('restored explicit ACL', r.tbl);
      }

    await admin.query(
      'ALTER ROLE c4g_tenant_runtime IN DATABASE ' + tenant + ' SET search_path TO pg_catalog,c4g_app',
    );
    const currentYear = Number(
      new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Lisbon' }).format(new Date()),
    );
    if (!pendingLoginTest) {
      const seed = (
        await t.query(
          'select responsible_membership_id,created_by,opportunity_id,central_opportunity_id,central_revision_id,central_snapshot from opportunity_catalog.application where organization_id=$1 limit 1',
          [org],
        )
      ).rows[0];
      assert.ok(seed, 'A base local precisa de uma candidatura de referência para os dados de teste.');
      for (const [offset, monthDay, value] of [
        [2, '01-15', '125.35'],
        [2, '12-01', '74.65'],
        [1, '01-01', '10.11'],
        [1, '06-30T23:30Z', '20.22'],
        [1, '11-02', null],
        [0, '01-01', '0.00'],
        [0, '01-01', '300.03'],
      ]) {
        const date = currentYear - offset + '-' + monthDay;
        const id = randomUUID();
        await t.query(
          "insert into opportunity_catalog.application(organization_id,application_id,opportunity_id,central_opportunity_id,central_revision_id,central_snapshot,title,responsible_membership_id,created_by,status,revision,deadline,total_budget) values($1,$2,$3,$4,$9,$5,'QA', $6,$7,'APPROVED',2,make_date(extract(year from current_date)::int,12,31),$8)",
          [
            org,
            id,
            seed.opportunity_id,
            seed.central_opportunity_id,
            seed.central_snapshot,
            seed.responsible_membership_id,
            seed.created_by,
            value,
            seed.central_revision_id,
          ],
        );
        await t.query(
          "insert into opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,actor_subject_id,deadline,reason,recorded_at,total_budget) values($1,$2,2,'TRANSITION','SUBMITTED','APPROVED','QA',$3,$4,make_date(extract(year from current_date)::int,12,31),'Teste de integração',$5,$6)",
          [org, id, seed.responsible_membership_id, seed.created_by, date, value],
        );
      }
    }
    const env = mod('backend/scripts/localPlatform/runtime').runtimeEnvironment(config, {
      ...state,
      catalogRead: { mode: 'disabled' },
    });
    env.CENTRAL_DATABASE_URL = cfg.connectionUrl(config, central);
    const cat = new URL(env.CATALOG_DATABASE_URL);
    cat.pathname = '/' + central;
    env.CATALOG_DATABASE_URL = cat.href;
    env.OPPORTUNITY_API_CREDENTIALS_JSON = JSON.stringify([cred]);
    env.SESSION_COOKIE_NAME = 'c4g_isolated_qa';
    env.SESSION_SECRET = randomUUID() + randomUUID();
    env.FUNDING_TENDERS_SOURCE = 'unconfigured';
    env.OPPORTUNITY_EU_WRITER = 'disabled';
    env.OPPORTUNITY_11145_EXECUTOR = 'disabled';
    tls.setDefaultCACertificates([
      ...tls.getCACertificates('default'),
      fs.readFileSync(
        mod('backend/scripts/localPlatform/identity').identityConfig().NODE_EXTRA_CA_CERTS,
        'utf8',
      ),
    ]);
    comp = mod('backend/src/productionComposition').createProductionComposition({
      env,
      dependencies: {
        express,
        cors: dep('cors'),
        centralPool: c,
        authorityPool: auth,
        enableRegistration: false,
        applicationFailureObserver: (e) =>
          console.log('report diagnostic', e.code, e.internalCode, e.message?.slice(0, 120)),
      },
    });
    await comp.assertDatabaseReadiness();
    console.log('actual composition ready');
    const app = express(),
      dist = R + '/frontend/dist',
      seen = [];
    app.use((q, r, n) => {
      const original = q.path;
      r.setHeader('X-Validation-Run', salt);
      r.on('finish', () => {
        if (original.includes('dashboard/summary') || original.includes('oidc/callback'))
          seen.push([original, r.statusCode]);
      });
      n();
    });
    app.use(express.static(dist));
    app.get(['/dashboard', '/login', '/'], (_q, r) => r.sendFile(dist + '/index.html'));
    app.use(comp.app);
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;
    // Keep the registered OIDC callback URL, routing only this browser to the isolated listener.
    browser = await mod('frontend/test-harness/node_modules/playwright').chromium.launch({
      channel: 'chrome',
      args: ['--host-resolver-rules=MAP localhost:3000 127.0.0.1:' + port],
    });
    const { page, response: initialSummary } = await loginToDashboard(browser);
    const callbacks = seen.filter(([route]) => route === '/api/auth/oidc/callback');
    assert.deepEqual(callbacks.map(([,status]) => status), [inheritGuard ? 503 : 302], 'Esperado um único callback OIDC');
    if (inheritGuard) return;
    let response = initialSummary;
    if (response.status() !== 200) {
      const retry = page.waitForResponse((r) => r.url().includes('/dashboard/summary'));
      await page.getByRole('button', { name: 'Atualizar', exact: true }).first().click();
      response = await retry;
    }
    assert.equal(response.status(), 200);
    assert.equal(await response.headerValue('X-Validation-Run'), salt);
    const payload = await response.json();
    assert.equal(payload.report.organizationId, org);
    if (!pendingLoginTest) await verifyYearSelection(page, t, org, currentYear);
  } catch (e) {
    console.error('stage', e.message.slice(0, 300));
    throw e;
  } finally {
    await browser?.close();
    if (server) await new Promise((r) => server.close(r));
    await comp?.closeOpportunityRuntime();
    for (const p of pools.filter((v) => v !== admin)) await p.end();
    for (const name of created.reverse()) await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await admin.end();
    console.log('Bases temporárias removidas.');
  }
})()
  .then(() => {
    if (inheritGuard) console.log('PASS · Operação herdada: primeiro callback 503 SESSION_PERSISTENCE_UNAVAILABLE.');
    else if (pendingLoginTest) console.log('PASS · Callback 302. Operação pendente na origem, cópia limpa e login OIDC à primeira tentativa.');
    else console.log('PASS · O orçamento global permaneceu igual em todas as seleções.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('FAILED', e.code, e.message?.slice(0, 400));
    process.exit(1);
  });
