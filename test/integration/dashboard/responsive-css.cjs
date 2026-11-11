'use strict';

const assert = require('node:assert/strict');
const { withBuiltFrontend } = require('../local-platform/mock-built-frontend.cjs');

const organization = { id: 'css-fixture', name: 'Entidade de exemplo', profileCode: 'ORG_ADMIN' };
const budget = { total: '1234567890123456.89', missing: 0, count: 2 };
const longUnit = 'Unidade'.repeat(35);
const reportMetrics = { total: 2, active: 1, submitted: 1, approved: 1, organizationBudget: budget, totalBudget: budget, approvedBudget: budget };
const dashboard = {
  role: 'ORGANIZATION',
  today: '2026-11-03',
  applications: { ...reportMetrics, by_status: { PREPARATION: 1, APPROVED: 1 } },
  opportunities: { total: 10, open: 5, closing_soon: 2 },
  source_totals: [{ source: 'FUNDING_TENDERS', total: 2 }],
  budget,
  report: {
    organizationId: organization.id,
    approvalHistory: { all: budget, '2026': budget },
    states: { APPROVED: { ...reportMetrics, total: 1, active: 0 } },
    items: [],
  },
  unit_totals: [{ ...reportMetrics, unitId: 'unit', label: longUnit, people: 1 }],
};
const task = { taskId: 'task', applicationId: 'application', title: 'Preparar o orçamento', applicationTitle: 'Projeto de exemplo', group: 'upcoming', status: 'OPEN', deadline: '2026-11-30' };
let profileCode = organization.profileCode;

function api({ pathname }) {
  switch (pathname) {
    case '/api/auth/session':
      return { user: { id: 'ui-fixture', name: 'Utilizador de teste', platformRoles: [] }, organization: { ...organization, profileCode } };
    case '/api/organizations/css-fixture/dashboard/summary':
      return dashboard;
    case '/api/applications/my-work':
      return { items: [task], total: 1, counts: { upcoming: 1 } };
    case '/api/notifications':
      return { notifications: [{ id: 'alert', title: 'Prazo próximo' }], unread_count: 1 };
    case '/api/applications/assigned-reviews':
      return { items: [{ requestId: 'review', applicationId: 'application', title: 'Documento de exemplo', applicationTitle: 'Projeto de exemplo' }] };
    default:
      return { items: [] };
  }
}

async function inspectIndicators(page, origin, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(origin + '/dashboard?vista=indicadores');
  const cards = page.locator('.dashboard-stats > .stat-item');
  await cards.last().waitFor();
  assert.equal(await cards.count(), 6);
  const layout = await cards.evaluateAll(nodes => ({
    pageWidth: document.documentElement.scrollWidth,
    sidebarOpen: document.querySelector('.hamburger-btn').getAttribute('aria-expanded') === 'true',
    rows: new Set(nodes.map(node => node.getBoundingClientRect().top)).size,
    contentFits: nodes.every(node => {
      const value = node.querySelector('.stat-num');
      const card = node.getBoundingClientRect();
      return value.scrollWidth <= value.clientWidth + 1 && value.getBoundingClientRect().right <= card.right;
    }),
  }));
  if (width > 768) assert(layout.sidebarOpen, 'A barra lateral deve ocupar a largura real');
  assert(layout.contentFits, `Os montantes devem caber nos cartões a ${width}px`);
  assert(layout.pageWidth <= width + 1, `A página não deve transbordar a ${width}px`);
  if (width === 1440) assert.equal(layout.rows, 1, 'Os cartões devem alinhar numa linha em desktop');
  if (width <= 390) assert.equal(layout.rows, 6, 'Os cartões devem empilhar no móvel');
  const pipeline = page.locator('.dashboard-grid .metric-bar > i').first();
  assert(await pipeline.evaluate(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0));
  assert.equal(await page.locator('.dashboard-grid .dashboard-list').evaluate(node => getComputedStyle(node).listStyleType), 'none');

  for (const id of ['approval-timeline', 'dashboard-budget-title']) {
    await page.locator(`a[href="#${id}"]`).click();
    await page.waitForFunction(target => {
      const header = document.querySelector('.top-header').getBoundingClientRect();
      const heading = document.getElementById(target).getBoundingClientRect();
      return heading.top >= header.bottom && heading.bottom <= innerHeight;
    }, id);
  }
}

async function checkInsetFocus(page, control) {
  await control.waitFor();
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert(await control.evaluate(node => node.matches(':focus-visible') && parseFloat(getComputedStyle(node).outlineOffset) < 0));
}

async function inspectReport(page, origin, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(origin + '/dashboard?vista=relatorio');
  const report = page.locator('.dashboard-report');
  for (const tab of ['Por unidade', 'Por estado', 'Candidaturas']) {
    await report.getByRole('button', { name: tab, exact: true }).click();
    const headers = report.getByRole('columnheader');
    assert.equal(await headers.count(), tab === 'Por unidade' ? 9 : 8);
    const overflowing = await headers.evaluateAll(cells => cells.filter(header => {
      const { left, right } = header.getBoundingClientRect();
      const style = getComputedStyle(header);
      const text = document.createRange();
      text.selectNodeContents(header);
      return Array.from(text.getClientRects()).some(line => line.width > 0 && (
        line.left < left + parseFloat(style.paddingLeft) - 1 ||
        line.right > right - parseFloat(style.paddingRight) + 1
      ));
    }).map(header => header.textContent));
    assert.deepEqual(overflowing, [], `Títulos fora da coluna em ${tab} a ${width}px`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `A página não deve transbordar em ${tab} a ${width}px`);
  }
}

withBuiltFrontend(api, async (page, origin) => {
  for (const width of [1440, 320]) await inspectReport(page, origin, width);
  for (const width of [1440, 1101, 390, 320]) await inspectIndicators(page, origin, width);

  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/dashboard');
    const labels = page.getByText(longUnit, { exact: true });
    await labels.last().waitFor();
    assert.equal(await labels.count(), 2);
    assert(await labels.evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), 'Os rótulos devem quebrar dentro das colunas dos gráficos');
  }

  profileCode = 'CONTRIBUTOR';
  await page.goto(origin + '/dashboard');
  for (const section of ['technician-priorities-title', 'technician-reviews-title', 'technician-alerts-title']) {
    await checkInsetFocus(page, page.locator(`section[aria-labelledby="${section}"] .technician-task-list a`));
  }
  await page.goto(origin + '/meu-trabalho');
  await checkInsetFocus(page, page.getByRole('button', { name: 'Ver tarefa ' + task.title }));
  console.log('DASHBOARD_RESPONSIVE_CSS_PASS: Relatório, indicadores, âncoras, rótulos e foco das tarefas.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
