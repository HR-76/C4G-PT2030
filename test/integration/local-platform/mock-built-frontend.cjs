'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');

const origin = 'http://127.0.0.1';
const dist = path.resolve(__dirname, '../../../frontend/dist');

async function withBuiltFrontend(api, verify) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
    page.setDefaultTimeout(5000);
    await page.route(`${origin}/**`, route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        const json = api(url, request);
        return json === undefined ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json });
      }
      const file = path.resolve(dist, request.isNavigationRequest() ? 'index.html' : `.${url.pathname}`);
      return file.startsWith(dist + path.sep) && fs.statSync(file, { throwIfNoEntry: false })?.isFile()
        ? route.fulfill({ path: file })
        : route.fulfill({ status: 404 });
    });
    await verify(page, origin);
  } finally {
    await browser.close();
  }
}

module.exports = { withBuiltFrontend };
