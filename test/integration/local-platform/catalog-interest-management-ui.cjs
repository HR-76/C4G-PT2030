'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');
const root = path.resolve(__dirname, '../../..'), dist = path.join(root, 'frontend/dist'), out = path.join(root, 'output/playwright/catalog-interest-management');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const opportunity = (n, title) => ({ opportunityId: uid(n), revisionId: uid(n + 100), title, lifecycleState: 'ACTIVE', source: 'EU', snapshot: { title, programmeName: 'Horizon Europe', openingDate: '2026-01-01', closingDate: '2027-05-31', officialUrl: 'https://example.org/official/' + n, lifecycleState: 'ACTIVE' } });
const opportunities = [opportunity(1, 'Investigação em energia limpa'), opportunity(2, 'Redes de inovação europeia'), opportunity(3, 'Capacitação de equipas'), opportunity(4, 'Mobilidade sustentável')];
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), candidate = path.resolve(dist, '.' + requested);
    if (!candidate.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
    const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(dist, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const canManage of [true, false]) for (const width of [1440, 390]) {
      const role = canManage ? 'ORG_ADMIN' : 'CONTRIBUTOR';
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), writes = [], errors = [], reads = [];
      page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      const unit = { unitId: uid(50), label: 'Projetos', lifecycle: 'ACTIVE' };
      const makeInterest = (index, status = 'ACTIVE') => ({ interestId: uid(index + 200), opportunityId: opportunities[index - 1].opportunityId, centralRevisionId: opportunities[index - 1].revisionId, revision: 1, status, title: opportunities[index - 1].title, snapshot: opportunities[index - 1].snapshot, notes: 'Análise guardada para preparar a candidatura.', unitIds: [unit.unitId], units: [unit], createdAt: '2026-11-03T10:00:00Z', capabilities: { canManage, canCreateApplication: canManage } });
      const registered = makeInterest(2), archived = makeInterest(3, 'ARCHIVED'), unknown = makeInterest(4, 'UNKNOWN'), created = makeInterest(1);
      let saved = false;
      const saving = deferred();
      const businessWrites = () => writes.filter(entry => entry.path !== '/api/notifications/check-deadlines');
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()); let body = { items: [] };
        if (['GET', 'HEAD'].includes(request.method())) reads.push(url.pathname);
        else writes.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
        if (url.pathname === '/api/auth/session') body = { user: { id: uid(40), name: 'Utilizador de teste', platformRoles: [] }, organization: { id: uid(41), displayName: 'Entidade de teste', profileLabel: canManage ? 'Administrador do cliente' : 'Membro da organização' } };
        else if (url.pathname === '/api/auth/csrf') body = { csrfToken: 'synthetic-ui-token' };
        else if (url.pathname === '/api/central-opportunities') body = { items: opportunities, nextCursor: null, programmes: ['Horizon Europe'], interventionAreas: [], sourceMode: 'fixture' };
        else if (url.pathname.startsWith('/api/central-opportunities/')) body = opportunities.find(row => url.pathname.endsWith(row.opportunityId));
        else if (url.pathname === '/api/opportunity-interests/context') body = { capabilities: { canRegister: canManage } };
        else if (url.pathname === '/api/opportunity-interests/summaries') {
          const ids = url.searchParams.get('opportunityIds').split(',');
          body = { items: ids.map(id => [saved && created, registered, archived, unknown].find(row => row && row.opportunityId === id) || { opportunityId: id, interestId: null, status: null, unitIds: [] }) };
        } else if (url.pathname === '/api/opportunity-interests/units') body = { items: [unit] };
        else if (url.pathname === '/api/opportunity-interests' && request.method() === 'POST') {
          await saving.promise; saved = true; body = created;
        } else if (url.pathname === '/api/opportunity-interests') {
          let items = [saved && created, registered].filter(Boolean);
          if (url.searchParams.get('q')) items = items.filter(row => row.title.toLowerCase().includes(url.searchParams.get('q').toLowerCase()));
          body = { items, nextCursor: null };
        } else if (url.pathname.startsWith('/api/opportunity-interests/')) body = [created, registered, archived, unknown].find(row => url.pathname.endsWith(row.interestId)) || body;
        else if (url.pathname === '/api/applications/responsibles') body = { items: [{ membershipId: uid(60), name: 'Responsável de teste' }] };
        else if (url.pathname === '/api/applications/browse') body = { items: [], total: 0, countsByStatus: {}, page: 1, pageSize: 25, nextCursor: null, previousCursor: null };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(base + '/catalogo');
      const table = page.locator('.habitual-catalog-table');
      await table.getByRole('link', { name: opportunities[0].title, exact: true }).waitFor();
      await table.getByRole('button', { name: 'Interesse registado', exact: true }).waitFor();
      assert.equal((await table.locator('thead th').allTextContents()).at(-1), 'Interesse', 'INTEREST_COLUMN_LAST');
      assert.equal(await table.getByText('Sem candidaturas visíveis', { exact: true }).count(), 0, 'NO_APPLICATION_SUMMARIES');
      assert.equal(await table.locator('.cr-application-status-badges').count(), 0, 'NO_APPLICATION_STATUSES');
      assert.equal(reads.filter(read => read.includes('/applications/opportunity-summaries')).length, 0, 'NO_APPLICATION_SUMMARY_REQUEST');
      const rowFor = title => table.locator('tbody tr').filter({ has: page.getByRole('link', { name: title, exact: true }) });
      const freshRow = rowFor(opportunities[0].title), savedRow = rowFor(opportunities[1].title);
      assert(await savedRow.evaluate(row => row.classList.contains('catalog-interest-registered')), 'CONFIRMED_ROW_HIGHLIGHTED');
      assert(!(await freshRow.evaluate(row => row.classList.contains('catalog-interest-registered'))), 'UNREGISTERED_ROW_NOT_HIGHLIGHTED');
      for (const item of opportunities.slice(2)) assert(!(await rowFor(item.title).evaluate(row => row.classList.contains('catalog-interest-registered'))), 'ONLY_ACTIVE_IS_HIGHLIGHTED');
      const official = freshRow.getByRole('link', { name: 'Consultar fonte oficial de ' + opportunities[0].title });
      assert.equal(await official.getAttribute('href'), opportunities[0].snapshot.officialUrl, 'OFFICIAL_LINK_PRESERVED');
      assert.equal(await freshRow.getByRole('button').count(), canManage ? 1 : 0, 'ONE_REGISTRATION_ACTION_OR_NONE');
      if (canManage) {
        const register = freshRow.getByRole('button', { name: 'Registar interesse em ' + opportunities[0].title });
        await register.focus(); await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Registar interesse' }); await dialog.waitFor();
        await dialog.getByLabel('Projetos', { exact: true }).check();
        await dialog.getByRole('button', { name: 'Guardar interesse', exact: true }).click();
        await dialog.getByRole('button', { name: 'A guardar…', exact: true }).waitFor();
        assert(!(await freshRow.evaluate(row => row.classList.contains('catalog-interest-registered'))), 'PENDING_IS_NOT_SUCCESS');
        assert.equal(await freshRow.getByRole('button', { name: 'Interesse registado', exact: true }).count(), 0, 'PENDING_HAS_NO_SUCCESS_BUTTON');
        saving.resolve();
        const confirmed = freshRow.getByRole('button', { name: 'Interesse registado', exact: true }); await confirmed.waitFor();
        assert(await confirmed.isDisabled(), 'SUCCESS_CANNOT_REGISTER_AGAIN');
        assert(await freshRow.evaluate(row => row.classList.contains('catalog-interest-registered')), 'ROW_CHANGES_AFTER_CONFIRMATION');
        assert.equal(await freshRow.getByRole('button').count(), 1, 'SINGLE_BUTTON_AFTER_SAVE');
        assert.equal(businessWrites().length, 1, 'ONLY_INTEREST_CREATED');
        assert.equal(businessWrites()[0].path, '/api/opportunity-interests');
        assert.equal(businessWrites()[0].body.centralRevisionId, opportunities[0].revisionId);
        assert.deepEqual(businessWrites()[0].body.unitIds, [unit.unitId]);
      } else assert.equal(await table.getByRole('button', { name: /^Registar interesse em/ }).count(), 0, 'READ_ONLY_CANNOT_REGISTER');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'CATALOG_OVERFLOW');
      if (width > 768) await page.locator('.opportunity-table-wrap').evaluate(node => { node.scrollLeft = node.scrollWidth; });
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(out, role + '-catalog-' + width + '.png'), fullPage: true, animations: 'disabled' });
      const areaLink = (canManage ? freshRow : savedRow).getByRole('link', { name: 'Candidaturas', exact: true });
      assert.equal(await areaLink.getAttribute('href'), '/candidaturas?ver=interesses', 'DIRECT_APPLICATION_AREA');
      await areaLink.click();
      const navigation = page.getByRole('navigation', { name: 'Área de candidaturas' }); await navigation.waitFor();
      await page.getByRole('heading', { name: 'Interesses da organização', exact: true }).waitFor();
      assert.equal(await navigation.getByRole('link', { name: 'Interesses', exact: true }).getAttribute('aria-current'), 'page');
      assert.equal(await navigation.getByRole('link', { name: 'Candidaturas', exact: true }).getAttribute('href'), '/candidaturas');
      if (canManage) {
        await page.getByLabel('Pesquisar', { exact: true }).fill('energia');
        await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
        await page.getByRole('button', { name: 'Nova candidatura para ' + created.title }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get('ver'), 'interesses', 'FILTERS_KEEP_SECTION');
        assert.equal(new URL(page.url()).searchParams.get('q'), 'energia', 'SEARCH_FILTER_APPLIED');
        const returnTo = new URL(page.url()).pathname + new URL(page.url()).search;
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
        await page.screenshot({ path: path.join(out, role + '-interests-' + width + '.png'), fullPage: true, animations: 'disabled' });
        await page.getByRole('button', { name: 'Nova candidatura para ' + created.title }).click();
        await page.getByRole('heading', { name: 'Nova candidatura', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Usar análise nas notas da candidatura' }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get('retorno'), returnTo, 'FORM_RETURN_TO_INTEREST_SECTION');
        assert.equal(await page.getByLabel('Título', { exact: true }).inputValue(), created.title);
        assert(await page.getByLabel('Projetos', { exact: true }).isChecked());
        assert.equal(businessWrites().filter(entry => entry.path === '/api/applications').length, 0, 'OPEN_FORM_NEVER_CREATES_APPLICATION');
        await page.getByRole('link', { name: 'Cancelar', exact: true }).click();
        await navigation.waitFor();
        assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, returnTo, 'CANCEL_PRESERVES_SECTION_AND_FILTERS');
        await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
        assert.equal(new URL(page.url()).searchParams.get('ver'), 'interesses', 'CLEAR_FILTERS_KEEP_SECTION');
        assert.equal(new URL(page.url()).searchParams.get('q'), null);
      } else {
        assert.equal(await page.getByRole('button', { name: /^Nova candidatura para/ }).count(), 0, 'READ_ONLY_CANNOT_PREPARE');
        await page.screenshot({ path: path.join(out, role + '-interests-' + width + '.png'), fullPage: true, animations: 'disabled' });
      }
      await navigation.getByRole('link', { name: 'Candidaturas', exact: true }).click();
      await page.getByRole('heading', { name: 'Candidaturas', exact: true }).waitFor();
      assert.equal(await navigation.getByRole('link', { name: 'Candidaturas', exact: true }).getAttribute('aria-current'), 'page');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'AREA_OVERFLOW');
      assert.deepEqual(errors, [], 'PAGE_ERRORS');
      assert.equal(businessWrites().length, canManage ? 1 : 0, 'NO_EXTRA_BUSINESS_WRITES');
      results.push({ role, width, lastColumn: true, confirmedHighlightOnly: true, directArea: true, registrationAllowed: canManage, applicationCreated: false, officialLinks: true, filteredReturn: canManage });
      await page.close();
    }
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ status: 'PASS', mockedApi: true, realLogin: false, results }, null, 2));
    console.log('CATALOG_INTEREST_MANAGEMENT_UI_PASS');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
