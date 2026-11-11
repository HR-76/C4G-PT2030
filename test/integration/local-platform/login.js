'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(ch => alphabet.indexOf(ch).toString(2).padStart(5, '0')).join('');
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest(), offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function verify({ origin, access, state, folder }) {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let stage = 'START', activePage;
  try {
    async function login(account) {
      stage = 'LOGIN_PAGE_' + account.username;
      const context = await browser.newContext({ viewport: { width: 1400, height: 950 } }), page = await context.newPage();
      activePage = page;
      // Cross a clock-second boundary before token exchange: AMR lifetime must
      // cover transport latency, not silently default to zero in Keycloak.
      await page.route('**/api/auth/oidc/callback?**', async route => {
        await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue();
      });
      await page.goto(origin + '/login'); await page.getByRole('button', { name: 'Entrar na C4G', exact: true }).click();
      stage = 'LOGIN_CREDENTIALS_' + account.username;
      await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password);
      await page.locator('#kc-login').click();
      if (account.totpSecret) {
      stage = 'LOGIN_OTP_' + account.username;
      await page.locator('#otp').waitFor();
      const otpFile = path.join(folder, 'last-otp.json'); let previous = {};
      try { previous = JSON.parse(fs.readFileSync(otpFile)); } catch {}
      while (previous[account.username] === Math.floor(Date.now() / 30000)) await new Promise(resolve => setTimeout(resolve, 500));
      previous[account.username] = Math.floor(Date.now() / 30000); fs.writeFileSync(otpFile, JSON.stringify(previous));
      await page.locator('#otp').fill(totp(account.totpSecret)); await page.locator('#kc-login').click();
      }
      stage = 'LOGIN_CALLBACK_' + account.username;
      await page.waitForURL(url => url.origin === origin && !url.pathname.startsWith('/api/'), { timeout: 30000 });
      assert.equal(await page.evaluate(async () => (await fetch('/api/auth/session')).status), 200);
      return page;
    }
    const admin = await login(access.admin);
    stage = 'ADMIN_PERMISSIONS';
    const adminStatus = await admin.evaluate(async () => ({
      sources: (await fetch('/api/admin/integrations/funding-tenders')).status,
      memberships: await (await fetch('/api/auth/organizations')).json(),
      privateData: (await fetch('/api/opportunities')).status
    }));
    assert.equal(adminStatus.sources, 200); assert.notEqual(adminStatus.privateData, 200);
    await admin.goto(origin + '/conta/seguranca');
    await admin.getByRole('link', { name: 'Gerir password e MFA' }).waitFor();
    if (state.identity.policyVersion === 'c4g-user-mfa-v1') await admin.getByText(/O MFA é opcional/).waitFor();
    await admin.goto(origin + '/integracoes');
    await admin.getByRole('heading', { name: 'ADMIN · Fontes de oportunidades' }).waitFor();
    await admin.getByText('Ainda não foi executada uma atualização.', { exact: true }).waitFor();
    await admin.screenshot({ path: path.join(folder, 'admin.png'), fullPage: true });
    const manager = await login(access.hugo);
    stage = 'ENTITY_PERMISSIONS';
    await manager.goto(origin + '/catalogo');
    // The sole eligible membership is selected by the server at login.
    const session = await manager.evaluate(async () => (await fetch('/api/auth/session')).json());
    assert.equal(session.organization.id, state.organizationId);
    await manager.waitForFunction(async () => (await fetch('/api/central-opportunities')).status === 200);
    const managerStatus = await manager.evaluate(async () => {
      const catalog = await fetch('/api/central-opportunities'), privateList = await fetch('/api/opportunities');
      return { sources: (await fetch('/api/admin/integrations/funding-tenders')).status,
        catalog: catalog.status, items: (await catalog.json()).items,
        privateList: privateList.status, applications: (await fetch('/api/applications')).status };
    });
    console.log('ENTITY_HTTP_STATUS', JSON.stringify({ ...managerStatus, items: managerStatus.items?.length }));
    assert.equal(managerStatus.sources, 403); assert.equal(managerStatus.catalog, 200);
    assert.deepEqual(managerStatus.items, []); assert.equal(managerStatus.privateList, 200); assert.equal(managerStatus.applications, 200);
    const post = async (page, route, body) => page.evaluate(async ({ route, body }) => {
      const { csrfToken } = await (await fetch('/api/auth/csrf')).json();
      const result = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
      return { status: result.status, body: await result.json() };
    }, { route, body });
    assert.equal((await post(manager, '/api/admin/integrations/funding-tenders', { requestId: crypto.randomUUID() })).status, 403);
    const unconfigured = await post(admin, '/api/admin/integrations/funding-tenders', { requestId: crypto.randomUUID() });
    assert.equal(unconfigured.status, 503); assert.equal(unconfigured.body.error.code, 'SOURCE_NOT_CONFIGURED');
    const foreign = await post(manager, '/api/auth/organization', { organizationId: crypto.randomUUID() });
    assert.notEqual(foreign.status, 200);
    await manager.screenshot({ path: path.join(folder, 'hugo.png'), fullPage: true });
    console.log('REAL_OIDC_ADMIN_ENTITY_PERMISSIONS_EMPTY_CATALOG_PASS');
  } catch (error) {
    console.error('LOCAL_BROWSER_STAGE', stage, activePage ? new URL(activePage.url()).pathname : 'NO_PAGE');
    if (activePage && stage.startsWith('LOGIN_PAGE_')) {
      console.error('LOCAL_LOGIN_PAGE_TEXT', (await activePage.locator('body').innerText()).slice(0, 1200));
      await activePage.screenshot({ path: path.join(folder, 'login-diagnostic.png') });
    }
    if (activePage && new URL(activePage.url()).pathname.startsWith('/api/')) {
      let body; try { body = JSON.parse(await activePage.locator('body').innerText()); } catch {}
      console.error('LOCAL_CALLBACK_CODE', body?.code || body?.error?.code || 'UNKNOWN');
    }
    throw error;
  } finally { await browser.close(); }
}
module.exports = { verify, totp };
