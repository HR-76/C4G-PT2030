'use strict';

const { createEmailTemplateRepository } = require('./repository');
const { TEMPLATE_TYPES, fail } = require('./contracts');
const { defaultTemplate } = require('./defaultTemplates');
const { renderTemplate } = require('./render');
const { logoForScope } = require('./logoService');

// Called only after memberService has authorized the operation. This port uses
// the Central read role, not the authority coordinator's closed SQL catalogue.
function createInvitationTemplate({ centralPool, publicBaseUrl, repository = createEmailTemplateRepository() }) {
  let origin = null;
  try {
    const url = new URL(publicBaseUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) origin = url.origin;
  } catch { /* Local HTTP previews have no public image. */ }
  return async function prepare({ organizationId, expiresAt }) {
    const client = await centralPool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const organization = await repository.organization(client, organizationId);
      if (!organization) fail('RESOURCE_NOT_AVAILABLE');
      const type = TEMPLATE_TYPES.MEMBER_INVITATION;
      const own = await repository.latest(client, type, organizationId);
      const global = own?.action === 'SAVE' ? null : await repository.latest(client, type, null);
      const stored = own?.action === 'SAVE' ? own : global?.action === 'SAVE' ? global : null;
      const source = own?.action === 'SAVE' ? 'ORGANIZATION' : stored ? 'GLOBAL' : 'DEFAULT';
      const template = stored || defaultTemplate(type);
      const logo = await logoForScope(repository, client, organizationId);
      const message = renderTemplate(template, {
        organizationName: organization.display_name, expiresAt,
        logoUrl: origin ? origin + (logo.url || '/logo-c4g.png') : null,
        logoAlt: logo.source === 'ORGANIZATION' ? organization.display_name : 'C4G'
      });
      await client.query('COMMIT');
      return { message, template: { source, version: template.version, organizationId: source === 'ORGANIZATION' ? organizationId : null }, logo };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ }
      throw error;
    } finally { client.release(); }
  };
}

// Do not expose the pinned message (or previous receipts) through member APIs.
function deliveryView(value) {
  if (!value) return null;
  return { invitationId: value.invitationId, status: value.status,
    ...(value.template ? { template: value.template } : {}) };
}

module.exports = { createInvitationTemplate, deliveryView };
