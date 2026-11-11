'use strict';
// Existing native installation only. No collection, schema or business-data writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');
const { Pool } = require('../../../backend/node_modules/pg');
const { root, folder, readConfig, connection } = require('../../../backend/scripts/localPlatform/config');
const { totp } = require('./login');

async function fingerprint() {
  const config = readConfig(), result = {};
  const groups = [
    [config.centralDatabase, ['opportunity_catalog.opportunity', 'opportunity_catalog.revision', 'opportunity_catalog.funding_identity', 'opportunity_catalog.funding_run']],
    [config.tenantDatabase, ['organizational_scope.organization_card', 'organizational_scope.scope', 'organizational_scope.person', 'organizational_scope.person_unit']],
  ];
  for (const [database, tables] of groups) {
    const pool = new Pool(connection(config, database)), client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      for (const table of tables) result[table] = (await client.query(`SELECT count(*)::int AS count, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM ${table} t`)).rows[0];
      await client.query('ROLLBACK');
    } finally { client.release(); await pool.end(); }
  }
  return result;
}
async function main() {
  const state = JSON.parse(fs.readFileSync(path.join(folder, 'runtime.json'))), access = JSON.parse(fs.readFileSync(path.join(folder, 'access.json')));
  const origin = 'http://localhost:3000'; assert.equal(state.identity.origin, origin); assert.equal(state.funding.source, 'live-local');
  const output = path.join(root, 'output/playwright/c4g-access-navigation'); fs.mkdirSync(output, { recursive: true });
  const before = await fingerprint(), checks = {}, measurements = [], writes = [], errors = [];
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let stage = 'START', active;
  const progress = setInterval(() => console.log('ACCESS_REVIEW', stage), 25000);
  const visit = async (page, route) => { await page.goto(origin + route); await page.waitForLoadState('networkidle'); };
  const get = async (page, route, headers = {}) => page.evaluate(async ({ route, headers }) => {
    const response = await fetch(route, { headers }); return { status: response.status, data: await response.json() };
  }, { route, headers });
  const capture = async (page, name) => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true, animations: 'disabled' });
  async function login(account, expectedPath) {
    stage = 'LOGIN_' + account.username;
    const context = await browser.newContext({ viewport: { width: 1008, height: 620 } }), page = await context.newPage(); active = page;
    context.setDefaultTimeout(20000); context.setDefaultNavigationTimeout(30000);
    page.on('pageerror', error => errors.push(error.name));
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/api/auth/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writes.push({ method: request.method(), path: url.pathname }); return route.abort();
      }
      return route.continue();
    });
    await page.goto(origin + '/login'); await page.getByRole('button', { name: 'Entrar na C4G', exact: true }).click();
    await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password); await page.locator('#kc-login').click();
    if (account.totpSecret) { await page.locator('#otp').fill(totp(account.totpSecret)); await page.locator('#kc-login').click(); }
    await page.waitForURL(url => url.origin === origin && url.pathname === expectedPath);
    await page.waitForLoadState('networkidle'); return page;
  }
  async function layout(page, name) {
    for (const width of [1008, 1280, 1440, 390]) {
      stage = name + '_LAYOUT_' + width; await page.setViewportSize({ width, height: width === 1008 ? 620 : 900 });
      await page.getByRole('table').waitFor();
      const metric = await page.evaluate(() => {
        const main = document.querySelector('.main-area'), table = document.querySelector('.opportunity-table-wrap');
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, contentWidth: main.getBoundingClientRect().width, tableWidth: table.clientWidth, tableScroll: table.scrollWidth, tableTop: table.getBoundingClientRect().top, firstRowBottom: table.querySelector('tbody tr').getBoundingClientRect().bottom };
      });
      measurements.push({ account: name, ...metric }); assert.ok(metric.pageWidth <= width + 1, 'PAGE_OVERFLOW'); assert.ok(metric.tableScroll <= metric.tableWidth + 1, 'TABLE_OVERFLOW');
      if (width <= 1100) assert.ok(metric.contentWidth >= width - 1, 'WORKSPACE_NOT_EXPANDED');
      await capture(page, name + '-catalog-' + width);
      if (width === 1008) {
        assert.ok(metric.firstRowBottom <= 620, 'FIRST_ROW_BELOW_VIEWPORT');
        await page.screenshot({ path: path.join(output, name + '-catalog-viewport-1008.png'), animations: 'disabled' });
      }
      if (width === 1008 || width === 390) {
        await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Navegação principal' }); await dialog.waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Fechar menu');
        await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.getAttribute('title')), 'Sair');
        await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Fechar menu');
        await capture(page, name + '-menu-' + width);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Abrir menu');
      }
      if (width === 1280) {
        await page.locator('header').getByRole('button', { name: 'Recolher menu' }).click();
        assert.ok(await page.evaluate(() => document.querySelector('.main-area').getBoundingClientRect().width >= innerWidth - 1));
        await page.getByRole('button', { name: 'Abrir menu' }).click();
      }
    }
    await page.setViewportSize({ width: 1008, height: 620 });
  }
  try {
    const admin = await login(access.admin, '/integracoes'); stage = 'ADMIN_SOURCE';
    await admin.getByRole('button', { name: 'Atualizar agora', exact: true }).waitFor();
    await admin.getByText('Administração da plataforma C4G', { exact: true }).waitFor();
    assert.equal(await admin.getByRole('combobox').count(), 0); await capture(admin, 'admin-sources');
    stage = 'ADMIN_CATALOG'; await visit(admin, '/catalogo'); await admin.getByRole('table').waitFor();
    const all = await get(admin, '/api/admin/central-opportunities'), current = await get(admin, '/api/admin/central-opportunities?closingFrom=' + new Date().toISOString().slice(0, 10));
    assert.equal(all.status, 200); assert.equal(all.data.items.length, 9); assert.equal(current.data.items.length, 4);
    checks.adminCatalog = all.data.items.length; checks.current = current.data.items.length;
    assert.equal(await admin.getByRole('columnheader', { name: 'Candidaturas', exact: true }).count(), 0);
    await layout(admin, 'admin');
    stage = 'ADMIN_FILTERS'; await admin.getByLabel('Programa', { exact: true }).selectOption({ label: current.data.items[0].programmeName });
    await admin.getByRole('button', { name: 'Pesquisar', exact: true }).click(); await admin.waitForLoadState('networkidle');
    await admin.getByLabel('Prazo', { exact: true }).selectOption('30'); await admin.waitForLoadState('networkidle');
    await admin.reload(); await admin.getByLabel('Prazo', { exact: true }).waitFor(); assert.equal(await admin.getByLabel('Prazo', { exact: true }).inputValue(), '30');
    await admin.getByRole('button', { name: 'Limpar filtros', exact: true }).click(); await admin.waitForLoadState('networkidle');
    await admin.getByText('9 oportunidades nesta página', { exact: true }).waitFor();
    for (const [index, item] of current.data.items.entries()) {
      stage = 'ADMIN_DETAIL_' + index; await visit(admin, '/catalogo/' + item.opportunityId);
      await admin.getByRole('heading', { name: item.title, exact: true }).waitFor();
      await admin.getByRole('link', { name: 'Consultar fonte oficial', exact: true }).waitFor();
      assert.equal(await admin.getByRole('link', { name: /Criar candidatura/ }).count(), 0);
      await capture(admin, 'admin-detail-' + (index + 1));
    }
    stage = 'ADMIN_BOUNDARIES'; checks.adminClientCatalog = (await get(admin, '/api/central-opportunities')).status;
    checks.adminPrivate = (await get(admin, '/api/applications')).status;
    checks.adminDirectory = (await get(admin, '/api/organization-directory', { 'X-C4G-Organization': state.organizationId })).status;
    console.log('ADMIN_BOUNDARIES', JSON.stringify({ clientCatalog: checks.adminClientCatalog, privateApplications: checks.adminPrivate, directory: checks.adminDirectory }));
    // The existing client catalog conceals unavailable context as 404;
    // private application/directory middleware requests a selection with 409.
    assert.equal(checks.adminClientCatalog, 404);
    for (const key of ['adminPrivate', 'adminDirectory']) assert.equal(checks[key], 409);
    await visit(admin, '/candidaturas'); await admin.getByRole('heading', { name: 'Área da organização', exact: true }).waitFor();
    await admin.getByRole('link', { name: 'Consultar catálogo C4G', exact: true }).click(); await admin.getByRole('table').waitFor();
    const manager = await login(access.hugo, '/catalogo'); stage = 'MANAGER_CATALOG';
    await manager.getByRole('table').waitFor(); await manager.getByRole('columnheader', { name: 'Candidaturas', exact: true }).waitFor();
    await manager.getByText('Sem candidaturas', { exact: true }).first().waitFor();
    await layout(manager, 'manager');
    const own = await get(manager, '/api/central-opportunities'); assert.equal(own.status, 200); assert.equal(own.data.items.length, 9);
    checks.managerPlatformCatalog = (await get(manager, '/api/admin/central-opportunities')).status; assert.equal(checks.managerPlatformCatalog, 403);
    checks.managerSourceAdmin = (await get(manager, '/api/admin/integrations/funding-tenders')).status; assert.equal(checks.managerSourceAdmin, 403);
    checks.foreignOrganization = (await get(manager, '/api/organization-directory', { 'X-C4G-Organization': '00000000-0000-4000-8000-000000000099' })).status; assert.equal(checks.foreignOrganization, 409);
    stage = 'MANAGER_PROFILE'; await visit(manager, '/perfil-organizacao'); await manager.getByRole('button', { name: 'Editar dados', exact: true }).waitFor();
    await capture(manager, 'manager-profile-1008');
    await visit(manager, '/perfil-organizacao/pessoas'); await manager.getByRole('button', { name: 'Editar Hugo Romão', exact: true }).waitFor(); await capture(manager, 'manager-people-1008');
    await visit(manager, '/perfil-organizacao/unidades'); await manager.getByText('Departamento Internacional', { exact: true }).first().waitFor(); await capture(manager, 'manager-units-1008');
    stage = 'MANAGER_APPLICATIONS'; await visit(manager, '/candidaturas');
    checks.managerApplications = (await get(manager, '/api/applications')).status; assert.equal(checks.managerApplications, 200);
    stage = 'MANAGER_DETAIL'; await visit(manager, '/catalogo/' + current.data.items[0].opportunityId);
    await manager.getByRole('link', { name: 'Criar candidatura nesta organização', exact: true }).waitFor(); await capture(manager, 'manager-detail-1008');
    checks.details = current.data.items.length; checks.keyboardAndWidths = true;
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    const after = await fingerprint(); assert.deepEqual(after, before);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ at: new Date().toISOString(), checks, measurements, businessWrites: 0, externalCollections: 0, businessDataUnchanged: true, businessTables: after, pageErrors: errors }, null, 2));
    console.log('ACCESS_NAVIGATION_PASS', JSON.stringify(checks));
  } catch (error) {
    console.error('ACCESS_NAVIGATION_FAILED', stage, error.code || error.name);
    if (active && active.url().startsWith(origin + '/') && !active.url().includes('/api/')) await capture(active, 'failure').catch(() => {});
    throw error;
  } finally { clearInterval(progress); await browser.close(); }
}
if (require.main === module) main().catch(() => { process.exitCode = 1; });
module.exports = { main };
