const assert = require("node:assert/strict");
const net = require("node:net");
const test = require("node:test");

function fakeHttpDependencies() {
  const app = { use() {}, get() {} };
  const express = () => app;
  express.json = () => function jsonMiddleware() {};
  return { app, express, cors: () => function corsMiddleware() {} };
}

test("importing app and production composition and constructing the app has no startup effects", () => {
  const originalInterval = global.setInterval;
  const originalListen = net.Server.prototype.listen;
  const originalFetch = global.fetch;
  const calls = { intervals: 0, listeners: 0, network: 0 };
  global.setInterval = () => { calls.intervals += 1; throw new Error("timer must not start"); };
  net.Server.prototype.listen = () => { calls.listeners += 1; throw new Error("listener must not start"); };
  global.fetch = async () => { calls.network += 1; throw new Error("network must not be contacted"); };

  try {
    delete require.cache[require.resolve("../src/app")];
    delete require.cache[require.resolve("../src/productionComposition")];
    const { createApp } = require("../src/app");
    require("../src/productionComposition");
    const http = fakeHttpDependencies();
    const routes = Object.fromEntries([
      "oidcAuth", "opportunities", "applications", "imports", "organizationDirectory", "notifications"
    ].map(name => [name, { name }]));
    assert.equal(createApp({ express: http.express, cors: http.cors, config: {}, pool: { query() {} }, routes }), http.app);
    assert.deepEqual(calls, { intervals: 0, listeners: 0, network: 0 });
  } finally {
    global.setInterval = originalInterval;
    net.Server.prototype.listen = originalListen;
    global.fetch = originalFetch;
  }
});
