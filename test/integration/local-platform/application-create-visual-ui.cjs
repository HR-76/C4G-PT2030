'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');
const root = path.resolve(__dirname, '../../..'), dist = path.join(root, 'frontend/dist'), out = path.join(root, 'output/playwright/application-create');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const userId = uid(20), orgId = uid(21), interestId = uid(1), opportunityId = uid(2), revisionId = uid(3), responsibleId = uid(4), applicationId = uid(10);
const returnTo = '/candidaturas?ver=interesses&q=energia&status=ACTIVE';
const unit = { unitId: uid(5), label: 'Gabinete de Projetos e Investimentos', lifecycle: 'ACTIVE' };
const title = 'Capacitação e inovação para a transição energética nas organizações — desenvolvimento de soluções sustentáveis e cooperação internacional';
const notes = 'Análise guardada: confirmar a participação da equipa e preparar o orçamento para as atividades da organização.';
const payload = { opportunityId, origin: 'CENTRAL', centralRevisionId: revisionId, evaluationId: null, title: 'Candidatura pendente de confirmação', responsibleMembershipId: responsibleId, deadline: '2027-02-15', totalBudget: '125000.75', organizationBudget: '45000.25', notes: 'Notas preservadas no envio pendente.', sourceInterestId: interestId, sourceInterestRevision: 2, unitIds: [unit.unitId], includeResponsibleInTeam: true };

function routeFor(scenario) {
  const query = new URLSearchParams({ nova: '1', oportunidade: opportunityId, retorno: returnTo });
  if (scenario !== 'private') { query.set('origem', 'CENTRAL'); query.set('revisao', revisionId); }
  if (['interest', 'denied', 'pending'].includes(scenario)) { query.set('interesse', interestId); query.set('interesseRevisao', '2'); }
  return '/candidaturas?' + query;
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.resolve(dist, '.' + requested);
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const base = 'http://127.0.0.1:' + server.address().port, results = [];
    const cases = [['interest', 1440], ['interest', 1024], ['interest', 390], ['central', 1440], ['central', 390], ['private', 1440], ['private', 390], ['denied', 390], ['pending', 390]];
    for (const [scenario, width] of cases) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [], writes = [];
      page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      const key = `c4g.application.intention.v1:${userId}:${orgId}`;
      const saved = { userId, organizationId: orgId, method: 'create', id: null, payload, idempotencyKey: 'synthetic-pending-create-key' };
      if (scenario === 'pending') await page.addInitScript(({ key, saved }) => sessionStorage.setItem(key, JSON.stringify(saved)), { key, saved });
      let application = null;
      const interest = { interestId, opportunityId, revision: 2, centralRevisionId: revisionId, title, notes, status: 'ACTIVE', unitIds: [unit.unitId], units: [unit], capabilities: { canManage: scenario !== 'denied', canCreateApplication: scenario !== 'denied', canIncludeResponsibleInTeam: scenario !== 'denied' } };
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()); let body = { items: [] }, status = 200;
        if (!['GET', 'HEAD'].includes(request.method())) writes.push({ path: url.pathname, method: request.method(), payload: request.postDataJSON() });
        if (url.pathname.includes('/auth/session')) body = { user: { id: userId, name: 'Utilizador de teste', platformRoles: [] }, organization: { id: orgId, name: 'Entidade de teste', profileLabel: scenario === 'denied' ? 'Membro da organização' : 'Administrador do cliente' } };
        else if (url.pathname === '/api/auth/csrf') body = { csrfToken: 'synthetic-ui-token' };
        else if (url.pathname === '/api/central-opportunities/' + opportunityId) body = { opportunityId, revisionId, lifecycleState: 'ACTIVE', snapshot: { title, programmeName: 'Horizon Europe', callReference: 'HORIZON-2027-ENERGY-01', closingDate: '2027-05-31', officialUrl: 'https://example.org/official-call' } };
        else if (url.pathname === '/api/opportunities/' + opportunityId) body = { opportunityId, title, programmeName: 'Programa de inovação', callReference: 'INOV-2027-01', closingDate: '2027-05-31', officialUrl: 'https://example.org/official-call' };
        else if (url.pathname === '/api/opportunity-interests/' + interestId) { if (scenario === 'denied') { status = 403; body = { error: { code: 'FORBIDDEN' } }; } else body = interest; }
        else if (url.pathname === '/api/opportunity-interests/units') body = { items: [unit] };
        else if (url.pathname === '/api/applications/responsibles') body = { items: [{ membershipId: responsibleId, name: 'Responsável de projetos e cooperação internacional' }] };
        else if (url.pathname === '/api/applications' && request.method() === 'POST') {
          application = { ...request.postDataJSON(), applicationId, opportunityTitle: title, units: [unit], status: 'IDENTIFIED', revision: 1, canEdit: true, allowedTransitions: [], createdAt: '2026-11-03T10:00:00Z' }; body = application;
        }
        else if (url.pathname === '/api/applications/' + applicationId) body = application;
        else if (url.pathname === '/api/applications/' + applicationId + '/work') body = { canEdit: true, revision: 1, participants: [], tasks: [] };
        else if (url.pathname === '/api/applications/' + applicationId + '/partners') body = { items: [], revision: 1, total: 0, canEdit: true };
        else if (url.pathname === '/api/applications/' + applicationId + '/documents') body = { capabilities: { canEdit: true, canDecide: true, canUpload: true }, revision: 1, documents: [], reviews: [] };
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const businessWrites = () => writes.filter(item => item.path !== '/api/notifications/check-deadlines');
      const go = async () => {
        await page.goto(base + routeFor(scenario));
        await page.getByRole('heading', { name: 'Nova candidatura', exact: true }).waitFor();
        await page.getByRole('heading', { name: 'Dados da candidatura', exact: true }).waitFor();
        await page.getByRole('heading', { name: 'Orçamento e notas', exact: true }).waitFor();
        await page.getByRole('option', { name: 'Responsável de projetos e cooperação internacional', exact: true }).waitFor({ state: 'attached' });
        await page.getByLabel(unit.label, { exact: true }).waitFor();
      };
      const capture = async suffix => {
        await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'PAGE_OVERFLOW_' + scenario + '_' + width);
        if (width === 1440) {
          const totalBox = await page.getByLabel('Orçamento total da candidatura (EUR)', { exact: true }).boundingBox();
          const organizationBox = await page.getByLabel('Orçamento afeto à organização (EUR)', { exact: true }).boundingBox();
          assert(Math.abs(totalBox.y - organizationBox.y) <= 1, 'BUDGET_INPUTS_MUST_ALIGN');
        }
        const duplicateIds = await page.locator('main input[id], main select[id], main textarea[id]').evaluateAll(nodes => nodes.map(node => node.id).filter((id, index, all) => all.indexOf(id) !== index));
        assert.deepEqual(duplicateIds, [], 'DUPLICATED_FORM_IDS');
        await page.screenshot({ path: path.join(out, `${scenario}-${width}${suffix || ''}.png`), fullPage: true, animations: 'disabled' });
      };
      await go();
      assert.equal(businessWrites().length, 0, 'OPENING_DOES_NOT_CREATE');
      const create = page.getByRole('button', { name: 'Criar candidatura', exact: true });
      if (scenario === 'denied') {
        await page.getByRole('alert').waitFor(); assert(await create.isDisabled(), 'DENIED_SOURCE_CANNOT_CREATE');
        await capture(); assert.equal(businessWrites().length, 0);
      } else if (scenario === 'pending') {
        const retry = page.getByRole('button', { name: 'Repetir o mesmo envio', exact: true });
        await retry.waitFor(); assert(await create.isDisabled(), 'PENDING_BLOCKS_NEW_CREATE');
        assert((await retry.boundingBox()).height >= 42, 'RECOVERY_ACTION_TOUCH_TARGET');
        assert.equal(await page.getByLabel('Título', { exact: true }).inputValue(), payload.title);
        assert.equal(await page.getByLabel('Notas', { exact: true }).inputValue(), payload.notes);
        assert.equal(await page.getByLabel('Orçamento total da candidatura (EUR)', { exact: true }).inputValue(), payload.totalBudget);
        assert(await page.getByLabel('Incluir o responsável na equipa', { exact: true }).isChecked());
        assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), JSON.stringify(saved));
        await capture(); assert.equal(businessWrites().length, 0, 'PENDING_NOT_AUTOMATICALLY_RETRIED');
        await retry.click(); await page.getByRole('tablist', { name: 'Secções da candidatura' }).waitFor();
        assert.deepEqual(businessWrites()[0].payload, { ...payload, idempotencyKey: saved.idempotencyKey });
        assert.equal(businessWrites().length, 1);
      } else {
        assert.equal(await page.getByLabel('Título', { exact: true }).inputValue(), title);
        assert.equal(await page.getByRole('link', { name: 'Fonte oficial', exact: true }).getAttribute('href'), 'https://example.org/official-call');
        assert.equal(await page.getByLabel('Notas', { exact: true }).inputValue(), '', 'NOTES_OPT_IN');
        if (scenario === 'interest') {
          await page.getByRole('button', { name: 'Usar análise nas notas da candidatura', exact: true }).waitFor();
          assert(await page.getByLabel(unit.label, { exact: true }).isChecked());
          assert(await page.getByLabel('Incluir o responsável na equipa', { exact: true }).isVisible());
        } else {
          assert.equal(await page.getByRole('button', { name: 'Usar análise nas notas da candidatura', exact: true }).count(), 0);
          assert.equal(await page.getByLabel('Incluir o responsável na equipa', { exact: true }).count(), 0);
        }
        await page.getByLabel('Título', { exact: true }).focus(); await page.keyboard.press('Tab');
        assert(await page.getByLabel('Responsável da organização').evaluate(node => document.activeElement === node), 'TITLE_TO_RESPONSIBLE_TAB_ORDER');
        await page.keyboard.press('Tab'); assert(await page.getByLabel('Prazo interno', { exact: true }).evaluate(node => document.activeElement === node), 'RESPONSIBLE_TO_DEADLINE_TAB_ORDER');
        await capture();
        await page.getByRole('link', { name: 'Cancelar', exact: true }).click();
        await page.getByRole('heading', { name: 'Interesses da organização', exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, returnTo, 'CANCEL_RETAINS_CONTEXT');
        assert.equal(businessWrites().length, 0, 'CANCEL_DOES_NOT_CREATE');
        await go();
        await page.getByLabel('Responsável da organização').selectOption(responsibleId);
        await page.getByLabel('Prazo interno', { exact: true }).fill('2027-02-15');
        await page.getByLabel('Orçamento total da candidatura (EUR)', { exact: true }).fill('987654.32');
        await page.getByLabel('Orçamento afeto à organização (EUR)', { exact: true }).fill('0');
        if (scenario === 'interest') {
          await page.getByRole('button', { name: 'Usar análise nas notas da candidatura', exact: true }).click();
          assert.equal(await page.getByLabel('Notas', { exact: true }).inputValue(), notes);
          await page.getByLabel('Incluir o responsável na equipa', { exact: true }).check();
        } else {
          await page.getByLabel('Notas', { exact: true }).fill('Notas da candidatura preenchidas explicitamente.');
          await page.getByLabel(unit.label, { exact: true }).check();
        }
        if (scenario === 'private') {
          await page.getByText('Associar avaliação de adequação (opcional)', { exact: true }).click();
          await page.getByLabel('Referência da avaliação').fill(uid(88));
          await capture('-filled');
        } else assert.equal(await page.getByLabel('Referência da avaliação').count(), 0);
        assert.equal(businessWrites().length, 0, 'FIELDS_DO_NOT_CREATE');
        await create.click(); await page.getByRole('tablist', { name: 'Secções da candidatura' }).waitFor();
        assert.equal(businessWrites().length, 1, 'EXACTLY_ONE_EXPLICIT_CREATE');
        const submitted = businessWrites()[0].payload;
        assert.equal(submitted.title, title); assert.equal(submitted.responsibleMembershipId, responsibleId); assert.equal(submitted.deadline, '2027-02-15');
        assert.equal(submitted.totalBudget, '987654.32'); assert.equal(submitted.organizationBudget, '0');
        assert.deepEqual(submitted.unitIds, [unit.unitId]); assert.equal(typeof submitted.idempotencyKey, 'string');
        assert.equal(submitted.evaluationId, scenario === 'private' ? uid(88) : null);
        if (scenario === 'interest') { assert.equal(submitted.sourceInterestId, interestId); assert.equal(submitted.sourceInterestRevision, 2); assert.equal(submitted.includeResponsibleInTeam, true); assert.equal(submitted.notes, notes); }
        assert.equal(new URL(page.url()).pathname, '/candidaturas/' + applicationId); assert.equal(new URL(page.url()).searchParams.get('retorno'), returnTo);
      }
      assert.deepEqual(errors, [], 'PAGE_ERRORS_' + scenario);
      results.push({ scenario, width, sectionsVisible: true, preservedFields: true, noOverflow: true, explicitWrites: businessWrites().length });
      await page.close();
    }
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ status: 'PASS', mockedApi: true, realLogin: false, results }, null, 2));
    console.log('APPLICATION_CREATE_VISUAL_UI_PASS');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
