'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createKeycloakAdapter } = require('../src/platformOnboarding/keycloakAdapter');
const { createActivationEmail } = require('../src/platformOnboarding/activationEmail');

test('credentialed outbound requests do not follow redirects in isolated HTTP transport', async () => {
  let destinationHits = 0, sourceHits = 0;
  const listen = handler => new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const target = await listen((_req, res) => { destinationHits++; res.end('unexpected'); });
  const source = await listen((_req, res) => {
    sourceHits++;
    res.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/synthetic-target` });
    res.end();
  });
  try {
    const fakeTransport = (_url, options) => fetch(`http://127.0.0.1:${source.address().port}/synthetic-source`, options);
    const adapter = createKeycloakAdapter({ issuer: 'https://id.example.invalid/realms/test', accessToken: async () => 'synthetic', ownershipKey: 'x'.repeat(32), fetchImpl: fakeTransport });
    await assert.rejects(adapter.ensure({ operationId: randomUUID(), organizationId: randomUUID(), globalUserId: randomUUID(), membershipId: randomUUID(), input: { expectedSubject: randomUUID() } }));
    const email = createActivationEmail({ key: 'x'.repeat(32), apiKey: 'synthetic', from: 'test@example.invalid', origin: 'https://app.example.invalid', fetchImpl: fakeTransport });
    const invitationId = randomUUID(), secret = await email.secret({ invitationId });
    assert.deepEqual(await email.send({ invitationId, to: 'test@example.invalid', secret, expiresAt: new Date(Date.now() + 60000) }), { status: 'UNCONFIRMED' });
    assert.equal(sourceHits, 2);
    assert.equal(destinationHits, 0);
  } finally {
    for (const server of [source, target]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
