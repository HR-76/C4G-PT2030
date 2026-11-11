const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../../src/app");

const canaries = Object.freeze([
  "SYNTHETIC_SECRET_CANARY", "SYNTHETIC_TOKEN_CANARY", "postgres://synthetic-connection-canary",
  "SYNTHETIC_PAYLOAD_CANARY", "synthetic.pii@example.invalid"
]);

function createRecorder() {
  const gets = [];
  const app = { use() {}, get(path, handler) { gets.push({ path, handler }); } };
  const express = () => app;
  express.json = () => function jsonMiddleware() {};
  return { app, gets, express, cors: () => function corsMiddleware() {} };
}

test("F1 harness responses and startup warnings do not expose synthetic canaries", () => {
  const recorder = createRecorder();
  const routes = Object.fromEntries(["oidcAuth", "opportunities", "applications", "imports", "notifications"].map(name => [name, { name, canaries }]));
  createApp({ express: recorder.express, cors: recorder.cors, config: { nodeEnv: "test" }, pool: { query() {} }, routes });
  let responseBody;
  recorder.gets.find(route => route.path === "/").handler({}, { json(body) { responseBody = body; } });

  const productionSource = fs.readFileSync(path.resolve(__dirname, '../../src/productionComposition.js'), 'utf8');
  const exercisedOutput = JSON.stringify({ responseBody, productionSource });
  for (const canary of canaries) assert.doesNotMatch(exercisedOutput, new RegExp(canary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
