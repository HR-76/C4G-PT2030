'use strict';
// Isolated UI regression against the built app. All API responses are synthetic.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('../../backend/node_modules/express');
const { chromium } = require('../../frontend/test-harness/node_modules/playwright');
async function run() {
  const root = path.resolve(__dirname, '../../frontend/dist');
  const output = path.resolve(__dirname, '../../context/reviews/c4g-delivery-1');
  fs.mkdirSync(output, { recursive: true });
  const app = express(); app.use(express.static(root)); app.use((req, res) => res.sendFile(path.join(root, 'index.html')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [], requests = []; let signedIn = true, platform = false;
    page.on('pageerror', e => errors.push(e.message));
    const organization = { id: 'demo-a', displayName: 'Entidade de demonstração A' };
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      let status = 200, body;
      if (url.pathname.endsWith('/auth/session')) {
        status = signedIn ? 200 : 401;
        body = signedIn ? { user: { id: 'synthetic', name: 'Utilizador de demonstração', platformRoles: platform ? ['C4G_ADMIN'] : [] }, organization } : { code: 'SESSION_REQUIRED' };
      } else if (url.pathname.endsWith('/auth/organizations')) body = { organizations: [organization] };
      else body = { items: [], nextCursor: null };
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/catalogo');
    await page.getByText('Sem resultados para estes filtros').waitFor();
    assert.equal(await page.title(), 'C4G Funding Platform');
    assert.equal(await page.getByRole('link', { name: 'Fontes de oportunidades' }).count(), 0);
    assert.equal(await page.locator('.sidebar').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(7, 91, 89)');
    assert.equal(await page.getByRole('combobox', { name: 'Organização ativa' }).inputValue(), organization.id);
    await page.screenshot({ path: path.join(output, 'catalogo-desktop.png'), fullPage: true });
    await page.getByRole('link', { name: /Matching/ }).click();
    await page.getByRole('heading', { name: 'Matching', level: 2 }).waitFor();
    assert(!requests.some(p => /\/matching\/|\/professors|\/notifications/.test(p)));
    platform = true; await page.reload();
    await page.getByRole('link', { name: 'Fontes de oportunidades' }).waitFor();
    await page.screenshot({ path: path.join(output, 'matching-availability.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.getByRole('button', { name: 'Fechar menu' }).waitFor();
    assert(await page.getByRole('link', { name: 'Fontes de oportunidades' }).isVisible());
    await page.screenshot({ path: path.join(output, 'menu-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    signedIn = false; await page.goto(origin + '/login');
    await page.getByRole('button', { name: 'Entrar na C4G' }).waitFor();
    await page.screenshot({ path: path.join(output, 'login-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(output, 'login-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS C4G shell: branding, tenant selector, role navigation, catalog, matching requests, mobile overflow and login. Synthetic API only.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
