'use strict';

const assert = require('node:assert/strict');
const { withBuiltFrontend } = require('./mock-built-frontend.cjs');

const organization = { id: 'org-fixture', name: 'Organização de exemplo', profileCode: 'ORG_ADMIN' };
const person = { personId: 'person-fixture', name: 'Maria da Conceição Albuquerque', email: 'maria@example.test', active: true, unitIds: [] };
const opportunityId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const applicationId = '33333333-3333-4333-8333-333333333333';
const opportunity = {
  opportunityId,
  revisionId,
  lifecycleState: 'ACTIVE',
  fields: { title: 'Oportunidade de exemplo' },
  snapshot: { title: 'Oportunidade de exemplo', summary: 'Descrição pública. '.repeat(90) },
};
let associated = true;

function api({ pathname }) {
  switch (pathname) {
    case '/api/auth/session':
      return { user: { id: 'ui-fixture', name: 'Utilizador de teste', platformRoles: [] }, organization: associated ? organization : null };
    case '/api/auth/account-security':
      return {};
    case '/api/organization-directory':
      return { organization, profile: {}, permissions: { edit: true, units: true } };
    case '/api/organization-directory/access':
      return { items: [{ ...person, membershipId: 'membership', profileCode: 'FUNDING_MANAGER', status: 'ACTIVE', billingRead: true, canChangeBilling: true }] };
    case '/api/organization-directory/people':
      return { items: [person] };
    case '/api/opportunity-interests':
      return { items: [{ interestId: 'interest', title: 'Oportunidade de exemplo', unitIds: [], status: 'ACTIVE' }] };
    case '/api/central-opportunities':
      return { items: [opportunity] };
    case `/api/central-opportunities/${opportunityId}`:
      return opportunity;
    case '/api/admissions/admission-fixture/draft':
      return { fields: {}, administrator: {}, types: [] };
    case `/api/applications/${applicationId}`:
      return { applicationId, opportunityId, opportunityTitle: opportunity.snapshot.title, title: 'Candidatura de exemplo', status: 'IDENTIFIED', revision: 1, canEdit: true, allowedTransitions: [], unitIds: [] };
    case `/api/applications/${applicationId}/work`:
      return { canEdit: true, revision: 1, participants: [], tasks: [] };
    case `/api/applications/${applicationId}/documents`:
      return { revision: 1, documents: [], reviews: [] };
    case '/api/applications/browse':
      return { items: [], total: 0, countsByStatus: {} };
    default:
      return { items: [] };
  }
}

function isInsideCell(button) {
  return button.evaluate(node => {
    const { left, right } = node.getBoundingClientRect();
    const cell = node.closest('td').getBoundingClientRect();
    return left >= cell.left && right <= cell.right && node.scrollWidth <= node.clientWidth + 1;
  });
}

function contrast(node, property) {
  return node.evaluate((element, propertyName) => {
    const luminance = color => color.match(/\d+/g).slice(0, 3).map(value => Number(value) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((total, value, channel) => total + value * [0.2126, 0.7152, 0.0722][channel], 0);
    return 1.05 / (luminance(getComputedStyle(element)[propertyName]) + 0.05);
  }, property);
}

withBuiltFrontend(api, async (page, origin) => {
  const visit = route => page.goto(origin + route);
  associated = false;
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await visit('/catalogo');
    const search = page.getByRole('button', { name: 'Pesquisar páginas' });
    await search.waitFor();
    const headerFits = await page.locator('.top-header').evaluate(node => node.scrollWidth <= node.clientWidth + 1);
    assert(headerFits, `O cabeçalho sem entidade deve caber a ${width}px`);
    await search.click();
    const input = page.getByRole('searchbox', { name: 'Pesquisar páginas' });
    await input.fill('sem resultado de teste');
    const label = page.locator('#header-search-title');
    assert.equal(await label.evaluate(node => getComputedStyle(node).clipPath), 'inset(50%)');
    const empty = page.getByText('Nenhuma página encontrada.');
    assert(await contrast(empty, 'color') >= 4.5);
  }

  associated = true;
  for (const width of [769, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await visit('/catalogo');
    const catalog = page.locator('.habitual-catalog-table');
    await catalog.waitFor();
    const clippedHeaders = await catalog.locator('th:visible').evaluateAll(nodes => nodes
      .filter(node => node.scrollWidth > node.clientWidth + 1)
      .map(node => `${node.textContent}: ${node.scrollWidth}/${node.clientWidth} (${getComputedStyle(node).whiteSpace})`));
    assert.deepEqual(clippedHeaders, [], `Os cabeçalhos do catálogo devem caber a ${width}px`);

    await visit('/utilizadores');
    const access = page.getByRole('button', { name: 'Retirar acesso financeiro a ' + person.name });
    await access.waitFor();
    assert(await isInsideCell(access), `A ação de faturação deve caber a ${width}px`);

    await visit('/perfil-organizacao/pessoas');
    const edit = page.getByRole('button', { name: 'Editar ' + person.name });
    await edit.waitFor();
    assert(await isInsideCell(edit), `A ação de edição deve caber a ${width}px`);
  }

  await page.setViewportSize({ width: 390, height: 820 });
  await visit('/interesses');
  const interests = page.getByRole('table');
  const review = page.getByRole('link', { name: 'Rever análise de Oportunidade de exemplo' });
  await review.waitFor();
  assert.equal(await interests.getByRole('columnheader', { name: 'Situação' }).count(), 1);
  assert((await review.boundingBox()).height >= 44);

  await visit('/catalogo');
  const catalog = page.getByRole('table', { name: 'Oportunidades do catálogo C4G' });
  await catalog.waitFor();
  assert.equal(await catalog.getByRole('columnheader', { name: 'Fecho', exact: true }).count(), 1);
  assert.equal(await catalog.getByRole('button', { name: 'Fecho', exact: true }).count(), 0);

  await visit('/candidaturas');
  const applicationTable = page.getByRole('table');
  await applicationTable.waitFor();
  assert.equal(await applicationTable.getByRole('columnheader', { name: 'Título', exact: true }).count(), 1);
  assert.equal(await applicationTable.getByRole('button', { name: 'Título', exact: true }).count(), 0);
  await page.locator('.application-mobile-sort summary').click();
  await page.getByRole('combobox', { name: 'Ordenar por', exact: true }).waitFor();

  await visit(`/candidaturas/${applicationId}#equipa-tarefas`);
  await page.getByRole('button', { name: 'Calendário', exact: true }).click();
  const previousMonth = page.getByRole('button', { name: 'Mês anterior' });
  assert((await previousMonth.boundingBox()).height >= 44);

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    for (const id of ['descricao-oportunidade', 'financiamento-oportunidade']) {
      await visit(`/catalogo/${opportunityId}#${id}`);
      await page.waitForFunction(target => {
        const section = document.getElementById(target);
        if (!section || section !== document.activeElement) return false;
        const heading = section.querySelector('h2').getBoundingClientRect();
        const header = document.querySelector('.top-header').getBoundingClientRect();
        return heading.top >= header.bottom && heading.bottom <= innerHeight;
      }, id);
    }
  }

  await visit('/adesao/admission-fixture');
  const field = page.locator('.registration-field input').first();
  await field.waitFor();
  assert(await contrast(field, 'borderTopColor') >= 3);

  await visit(`/candidaturas?nova=1&oportunidade=${opportunityId}&origem=CENTRAL&revisao=${revisionId}`);
  const titleField = page.getByRole('textbox', { name: 'Título', exact: true });
  await titleField.waitFor();
  assert(await contrast(titleField, 'borderTopColor') >= 3);

  await visit('/perfil');
  const security = page.locator('#main-content').getByRole('link', { name: 'Segurança da conta', exact: true });
  await security.focus();
  const firstOutline = await security.evaluate(node => getComputedStyle(node).outlineWidth);
  assert.equal(firstOutline, '3px');
  await security.press('Enter');
  await page.getByRole('heading', { name: 'Segurança da conta', exact: true }).waitFor();
  await page.goBack();
  await security.focus();
  assert.equal(await security.evaluate(node => getComputedStyle(node).outlineWidth), firstOutline);
  console.log('PASS: CSS do cabeçalho, pesquisa, tabelas, âncoras, contraste, alvos táteis e foco entre rotas.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
