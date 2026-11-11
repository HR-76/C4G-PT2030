'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('PQ1 actual app admits 256 KiB JSON and sanitizes parser/middleware failures without logging payload', async () => {
  const express = require('express'), routes = {};
  for (const name of ['oidcAuth','opportunities','applications','imports','organizationDirectory','notifications'])
    routes[name] = (req,res,next) => next();
  routes.profilePq1 = (req,res,next) => req.body?.accepted ? res.json({ accepted: true }) : next(new Error('restricted-payload-canary'));
  const reported = [];
  const app = require('../src/app').createApp({ express, cors: require('cors'), config: { nodeEnv: 'development' }, pool: {}, routes, reportError: e => reported.push(e) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const [body, status] of [['{"restricted-payload-canary":',400], [JSON.stringify({ content: 'x'.repeat(270000) }),413], ['{}',503], [JSON.stringify({ accepted: true, content: 'x'.repeat(150000) }),200]]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/organizational-profile/pq1-publication/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const value = await response.json(); assert.equal(response.status,status); assert.equal(response.headers.get('cache-control'),'no-store');
      assert(!JSON.stringify(value).includes('canary'));
      if (status !== 200) assert.deepEqual(Object.keys(value).sort(),['correlationId','error']);
    }
    assert.deepEqual(reported,[{ code: 'SERVICE_UNAVAILABLE' }]);
    assert(!JSON.stringify(reported).includes('canary'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
