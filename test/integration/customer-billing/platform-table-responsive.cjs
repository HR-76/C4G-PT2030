'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');

const origin = 'http://127.0.0.1';
const listPath = '/administracao/faturacao';
const cycleId = '22222222-2222-4222-8222-222222222222';
const detailPath = `${listPath}/${cycleId}`;
const cycle = {
  cycleId,
  organizationName: 'Entidade de exemplo',
  serviceDescription: 'Subscrição anual',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  dueDate: '2026-02-04',
  currency: 'EUR',
  cycleAmount: '1230',
  adjustedTotal: '1230',
  paidAmount: '0',
  balanceAmount: '1230',
  cycleState: 'DRAFT',
  paymentState: 'UNPAID',
};
const responses = {
  '/api/auth/session': {
    user: { id: 'billing-admin', name: 'Admin de teste', platformRoles: ['C4G_ADMIN'] },
    organization: null,
  },
  '/api/admin/billing/summary': { currencies: [] },
  '/api/admin/billing/cycles': { items: [cycle], total: 1, page: 1, pageSize: 25 },
  [`/api/admin/billing/cycles/${cycleId}`]: {
    ...cycle,
    accountSnapshot: { legalName: cycle.organizationName },
    documents: [],
    payments: [],
    timeline: [],
  },
};

async function openList(page) {
  await page.goto(origin + listPath);
  const link = page.getByRole('link', { name: 'Consultar', exact: true });
  await link.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Recolher menu' }).getAttribute('aria-expanded'), 'true');
  const table = page.locator('.billing-table-wrap');
  assert(await table.evaluate(node => node.scrollWidth > node.clientWidth), 'A tabela tem colunas fora da largura útil');
  return { table, link };
}

async function assertDetail(page) {
  await page.waitForURL(origin + detailPath);
  await page.getByRole('heading', { name: cycle.organizationName, exact: true }).waitFor();
}

function visibleLinkCenter(link) {
  return link.evaluate(node => {
    const { x, y, width, height } = node.getBoundingClientRect();
    const center = { x: x + width / 2, y: y + height / 2 };
    return node.contains(document.elementFromPoint(center.x, center.y)) ? center : null;
  });
}

async function run() {
  const dist = path.resolve(__dirname, '../../../frontend/dist');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.route(`${origin}/**`, route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/')) {
        const data = responses[pathname];
        return data ? route.fulfill({ json: data }) : route.fulfill({ status: 404, json: {} });
      }
      const asset = path.resolve(dist, request.isNavigationRequest() ? 'index.html' : `.${pathname}`);
      return asset.startsWith(dist + path.sep) && fs.statSync(asset, { throwIfNoEntry: false })?.isFile()
        ? route.fulfill({ path: asset })
        : route.fulfill({ status: 404 });
    });

    const mouse = await openList(page);
    await mouse.table.scrollIntoViewIfNeeded();
    await mouse.table.hover();
    await page.mouse.wheel(1200, 0);
    await page.waitForFunction(() => document.querySelector('.billing-table-wrap').scrollLeft > 0, null, { timeout: 3000 });
    const point = await visibleLinkCenter(mouse.link);
    assert(point, 'Consultar deve estar visível e clicável após deslocar a tabela');
    await page.mouse.click(point.x, point.y);
    await assertDetail(page);

    const keyboard = await openList(page);
    const region = page.getByRole('region', { name: 'Tabela de ciclos de faturação' });
    for (let step = 0; step < 40; step++) {
      await page.keyboard.press('Tab');
      if (await region.evaluate(node => node === document.activeElement)) break;
    }
    assert(await region.evaluate(node => node.matches(':focus-visible')), 'Tab deve alcançar a região da tabela');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.billing-table-wrap').scrollLeft > 0, null, { timeout: 3000 });
    await page.keyboard.press('Tab');
    assert(await keyboard.link.evaluate(node => node === document.activeElement && node.matches(':focus-visible')), 'Tab deve alcançar Consultar');
    assert(await visibleLinkCenter(keyboard.link), 'Consultar deve estar visível ao receber o foco');
    await page.keyboard.press('Enter');
    await assertDetail(page);

    await page.setViewportSize({ width: 390, height: 820 });
    await page.goto(origin + listPath);
    const mobileTable = page.getByRole('table', { name: 'Ciclos de faturação' });
    await mobileTable.waitFor();
    assert.equal(await mobileTable.getByRole('columnheader', { name: 'Entidade' }).count(), 1);
    assert.equal(await mobileTable.locator('caption').evaluate(node => getComputedStyle(node).clipPath), 'inset(50%)');
    console.log('PASS: Consultar abre o detalhe a 1024 px, com barra lateral aberta, por rato e teclado.');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
