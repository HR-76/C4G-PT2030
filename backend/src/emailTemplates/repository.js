'use strict';

const sql = require('./sql');

// One query per method, on the client the service hands over, so every read and
// write of a request shares that request's transaction.
function createEmailTemplateRepository() {
  return Object.freeze({
    async isPlatformAdmin(client, sessionId, actorId) {
      return (await client.query(sql.admin, [sessionId, actorId])).rows[0]?.allowed === true;
    },
    async organization(client, organizationId) {
      return (await client.query(sql.organization, [organizationId])).rows[0] || null;
    },
    async latest(client, type, organizationId) {
      return (await client.query(sql.latest, [type, organizationId])).rows[0] || null;
    },
    async summary(client, type) {
      return (await client.query(sql.summary, [type])).rows[0];
    },
    async write(client, input) {
      return (await client.query(sql.write, [
        input.sessionId, input.actorId, input.type, input.organizationId, input.id, input.action,
        input.subject, input.html, input.contentSha256, input.requestId, input.expectedRevision
      ])).rows[0];
    }
  });
}

module.exports = { createEmailTemplateRepository };
