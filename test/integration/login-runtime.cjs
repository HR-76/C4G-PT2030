'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../../frontend/test-harness/node_modules/playwright');

async function run() {
  const root = path.resolve(__dirname, '../../frontend');
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', open: false } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/Invalid hook call/.test(message.text())) errors.push(message.text());
    });
    await page.route('**/api/auth/session', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' }));
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    let starts=0;
    await page.route('**/api/auth/oidc/login?*',route=>{starts++;assert.equal(new URL(route.request().url()).searchParams.get('returnTo'),'/');return route.fulfill({status:200,contentType:'text/html',body:'<h1>OIDC test destination</h1>'})});
    await page.goto(origin+'/');
    await page.getByRole('heading',{name:'OIDC test destination'}).waitFor();
    assert.equal(starts,1);
    await page.goto(origin+'/recuperar-password');
    await page.getByRole('heading',{name:'Recuperar password'}).waitFor();
    assert(await page.getByText('A recuperação por email ainda não está disponível neste ambiente.').isVisible());
    assert.equal(await page.locator('input').count(),0);
    await page.getByRole('link',{name:'Voltar ao login'}).click();
    await page.getByRole('heading',{name:'OIDC test destination'}).waitFor();assert.equal(starts,2);
    await page.goto(origin+'/login');
    await page.getByRole('heading',{name:'OIDC test destination'}).waitFor();assert.equal(starts,3);
    await page.goto(origin+'/login?logout=incomplete');
    await page.getByRole('heading',{name:'OIDC test destination'}).waitFor();assert.equal(starts,4);
    assert.deepEqual(errors, []);
    console.log('PASS: root and login alias start OIDC once without an intermediate button, including logout query; recovery preserved.');
  } finally {
    await browser?.close();
    await server.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
