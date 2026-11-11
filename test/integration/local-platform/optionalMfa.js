'use strict';
const assert = require('node:assert/strict'), path = require('node:path');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');
const { totp } = require('./login');
const { identityAdmin } = require('../../../backend/scripts/localPlatform/optionalIdentity');
const { identityConfig } = require('../../../backend/scripts/localPlatform/identity');

async function verify({ origin, access, state, folder, reinstall }) {
  assert.equal(state.identity.realm, 'c4g-native-validation', 'MFA lifecycle must use the isolated validation identity');
  const kc = await identityAdmin(identityConfig());
  const otpCredentials = async subject => (await kc(state.identity.realm + '/users/' + subject + '/credentials')).filter(item => item.type === 'otp');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  let stage = 'ANONYMOUS', page;
  let secret, lastOtpPeriod = -1;
  async function useOtp(locator) {
    while (Math.floor(Date.now() / 30000) === lastOtpPeriod) await new Promise(resolve => setTimeout(resolve, 300));
    lastOtpPeriod = Math.floor(Date.now() / 30000);
    await locator.fill(totp(secret));
  }
  async function login(account, withOtp = false) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    page = await context.newPage();
    await page.goto(origin + '/login');
    await page.getByRole('button', { name: 'Entrar na C4G', exact: true }).click();
    await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password);
    await page.locator('#kc-login').click();
    if (withOtp) {
      await page.locator('#otp').waitFor();
      await page.locator('#otp').fill(String((Number(totp(secret)) + 1) % 1000000).padStart(6, '0'));
      await page.locator('#kc-login').click();
      await page.locator('#input-error-otp-code').waitFor();
      assert.equal((await context.request.get(origin + '/api/auth/session')).status(), 401);
      await useOtp(page.locator('#otp')); await page.locator('#kc-login').click();
    }
    await page.waitForURL(url => url.origin === origin && !url.pathname.startsWith('/api/'), { timeout: 30000 });
    assert.equal((await context.request.get(origin + '/api/auth/session')).status(), 200);
    return page;
  }
  try {
    for (const route of ['/api/auth/account', '/api/auth/account-security']) assert.equal((await fetch(origin + route, { redirect: 'manual' })).status, 401);
    assert.equal((await otpCredentials(state.identity.managerSubject)).length, 0);
    stage = 'ACCOUNT_SETTINGS';
    await login(access.hugo);
    await page.goto(origin + '/conta/seguranca');
    await page.getByText(/O MFA é opcional/).waitFor();
    await page.screenshot({ path: path.join(folder, 'account-security.png'), fullPage: true });
    await page.getByRole('link', { name: 'Gerir password e MFA' }).click();
    await page.getByRole('button', { name: 'Set up Authenticator application', exact: true }).click();
    stage = 'ENROLL';
    await page.locator('#mode-manual').click();
    secret = (await page.locator('#kc-totp-secret-key').innerText()).replace(/\s/g, '');
    await page.locator('#userLabel').fill('C4G validation');
    await useOtp(page.locator('#totp')); await page.locator('#saveTOTPBtn').click();
    await page.getByText('C4G validation', { exact: true }).waitFor();
    const enrolled = await otpCredentials(state.identity.managerSubject);
    assert.equal(enrolled.length, 1); assert.equal((await otpCredentials(state.identity.adminSubject)).length, 0);
    stage = 'REINSTALL_PRESERVES_CHOICE';
    await reinstall();
    assert.deepEqual(await otpCredentials(state.identity.managerSubject), enrolled);
    stage = 'OTP_LOGIN_AND_WRONG_CODE';
    await login(access.hugo, true);
    stage = 'DISABLE';
    await page.goto(origin + '/api/auth/account');
    await page.getByTestId('otp/credential-list').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('#kc-accept').click();
    await page.getByText('Authenticator application is not set up.', { exact: true }).waitFor();
    assert.equal((await otpCredentials(state.identity.managerSubject)).length, 0);
    stage = 'PASSWORD_LOGIN_AFTER_DISABLE';
    await login(access.hugo); await login(access.admin);
    console.log('OPTIONAL_MFA_ENROLL_WRONG_CODE_REINSTALL_DISABLE_AND_ACCOUNT_ISOLATION_PASS');
  } catch (error) {
    console.error('OPTIONAL_MFA_STAGE', stage, page ? new URL(page.url()).pathname : 'NO_PAGE');
    // No screenshots or page dumps while a QR/secret/password may be visible.
    if (page && new URL(page.url()).pathname.includes('/account/')) {
      console.error('ACCOUNT_BUTTONS', await page.getByRole('button').allTextContents());
    }
    // Compensate only credentials this test created, on the validation account.
    // Passing the test still requires deletion through the user's account UI.
    for (const credential of await otpCredentials(state.identity.managerSubject)) {
      if (credential.userLabel === 'C4G validation') await kc(state.identity.realm + '/users/'
        + state.identity.managerSubject + '/credentials/' + credential.id, 'DELETE');
    }
    throw error;
  } finally { await browser.close(); }
}
module.exports = { verify };
