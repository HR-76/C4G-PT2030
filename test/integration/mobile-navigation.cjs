'use strict';
// Real Layout/Header/Sidebar and CSS; synthetic auth, no API or database.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../../frontend/test-harness/node_modules/playwright');
async function run() {
  const root = path.resolve(__dirname, '../../frontend');
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
  const html = `<html><head></head><body><div id="root"></div><script type="module">
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter,Routes,Route} from 'react-router-dom';
    import Layout from '/src/components/Layout/Layout.jsx';
    import '/src/index.css';
    import '/src/c4g-shell.css';
    createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/dashboard']},
      React.createElement(Routes,null,React.createElement(Route,{element:React.createElement(Layout)},
        React.createElement(Route,{path:'*',element:React.createElement('button',{id:'content-action'},'Content action')})))));
  </script></body></html>`;
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'synthetic-navigation-session', enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/contexts/AuthContext.jsx'))
        return `export function useAuth(){return {user:{name:'Synthetic',role:'MEMBER'},isAdmin:false,logout(){}}}`;
    },
    configureServer(vite) {
      vite.middlewares.use('/__navigation_test', async (req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/__navigation_test', html));
      });
    }
  }] });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__navigation_test`);
    const toggle = page.getByRole('button', { name: 'Abrir menu' });
    await toggle.waitFor();
    const sidebar = page.locator('#primary-navigation');
    assert.equal(await sidebar.isVisible(), false);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('link', { name: 'Ir para o conteúdo' }).evaluate(e => e === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await toggle.evaluate(e => e === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#content-action').evaluate(e => e === document.activeElement), true);
    await toggle.focus(); await page.keyboard.press('Enter');
    const close = page.getByRole('button', { name: 'Fechar menu' });
    await close.waitFor();
    assert.equal(await close.evaluate(e => e === document.activeElement), true);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.logout-btn').evaluate(e => e === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(e => e === document.activeElement), true);
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await sidebar.evaluate(e => e.contains(document.activeElement)), true);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Abrir menu');
    assert.equal(await sidebar.isVisible(), false);
    await page.keyboard.press('Enter'); await close.click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Abrir menu');
    await page.keyboard.press('Enter');
    await page.getByRole('link', { name: 'Oportunidades', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Abrir menu');
    assert.equal(await sidebar.isVisible(), false);
    await page.keyboard.press('Enter');
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForFunction(() => !document.querySelector('.main-area').hasAttribute('inert'));
    assert.equal(await sidebar.isVisible(), true);
    assert.equal(await sidebar.getAttribute('inert'), null);
    await page.getByRole('link', { name: 'Oportunidades', exact: true }).focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('#primary-navigation').hasAttribute('inert'));
    assert.equal(await sidebar.isVisible(), false);
    assert.equal(await toggle.evaluate(e => e === document.activeElement), true);
    assert.deepEqual(errors, []);
    console.log('PASS: closed Tab, open focus, Tab/Shift+Tab containment, Escape/close/route focus return, desktop and mobile resize.');
  } finally { await browser?.close(); await server.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
