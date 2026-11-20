'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInvitationTemplate } = require('../src/emailTemplates/invitation');
const { createEmailTemplateService } = require('../src/emailTemplates/service');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const request = { sessionID: 'session', authContext: { sessionId: 'session' }, user: { id: ADMIN, email: 'forged@example.invalid' } };
const html = '<p>{Logotipo}</p><p>{Organizacao}</p><p>{LigacaoAtivacao} {Validade}</p>';
function fixture() {
  const templates = new Map(), logos = new Map(), statements = [], sent = [];
  let authorized = true, outcome = 'ACCEPTED';
  const repository = {
    isPlatformAdmin: async(c,s,id) => authorized && s === 'session' && id === ADMIN,
    recipient: async(c,id) => { assert.equal(id, ADMIN); return 'admin@example.invalid'; },
    organization: async(c,id) => [A,B].includes(id) ? { display_name: id === A ? 'Entidade <A>' : 'Entidade B' } : null,
    latest: async(c,t,id) => templates.get(id), latestLogo: async(c,id) => logos.get(id),
    summary: async() => ({}), write: async() => { throw Error('No writes allowed'); }
  };
  const centralPool = { connect: async() => ({ query: async q => { statements.push(q); return { rows: [] }; }, release() { statements.push('release'); } }) };
  const options = { centralPool, repository, publicBaseUrl: 'https://app.example.invalid' };
  return { templates, logos, statements, sent, prepare: createInvitationTemplate(options),
    service: createEmailTemplateService({ ...options, testDelivery: async value => { sent.push(value); return { status: outcome }; } }),
    deny: () => { authorized = false; }, outcome: value => { outcome = value; } };
}
const invite = organizationId => ({ organizationId, expiresAt: '2030-01-15T12:00:00Z' });

test('organization templates and logos never cross scopes; resets fall back independently', async() => {
  const f = fixture();
  f.templates.set(null, { action: 'SAVE', version: 3, subject: 'Global', html });
  f.templates.set(A, { action: 'SAVE', version: 7, subject: 'Convite {Organizacao}', html: html+'<script>bad()</script>' });
  f.logos.set(A, { action: 'SET', public_id: 'a'.repeat(32) });
  f.logos.set(null, { action: 'SET', public_id: 'c'.repeat(32) });
  const a = await f.prepare(invite(A)), b = await f.prepare(invite(B));
  assert.equal(a.template.version, 7); assert.equal(a.template.organizationId, A);
  assert.match(a.message.html, /Entidade &lt;A&gt;/); assert.doesNotMatch(a.message.html,/script|bad\(\)/);
  assert.match(a.message.html, new RegExp('email-logos/'+'a'.repeat(32)));
  assert.equal(b.template.source,'GLOBAL'); assert.equal(b.template.version,3);
  assert.doesNotMatch(b.message.html,new RegExp('a'.repeat(32)));assert.match(b.message.html,new RegExp('c'.repeat(32)));
  f.templates.set(A,{action:'RESET',version:8});
  const reset=await f.prepare(invite(A));assert.equal(reset.template.source,'GLOBAL');assert.equal(reset.logo.source,'ORGANIZATION');
  f.templates.set(null,{action:'RESET',version:4});f.logos.set(A,{action:'REMOVE'});f.logos.set(null,{action:'REMOVE'});
  const fallback=await f.prepare(invite(A));assert.equal(fallback.template.version,'default-1');assert.match(fallback.message.html,/logo-c4g.png/);
});

test('unknown organization fails closed and rolls back the template snapshot',async()=>{
  const f=fixture();await assert.rejects(f.prepare(invite(ADMIN)),{code:'RESOURCE_NOT_AVAILABLE'});
  assert.deepEqual(f.statements.slice(-2),['ROLLBACK','release']);
});

test('test uses the current administrator database email, validates input and checks authorization before dispatch',async()=>{
  const f=fixture(),body={subject:'Convite',html,idempotencyKey:A};
  const result=await f.service.test('member-invitation',A,body,request);
  assert.deepEqual(result,{status:'ACCEPTED',to:'admin@example.invalid'});
  assert.equal(f.sent[0].to,'admin@example.invalid');assert.doesNotMatch(JSON.stringify(f.sent),/forged/);
  await assert.rejects(f.service.test('member-invitation',A,{...body,to:'other@example.invalid'},request),{code:'INVALID_INPUT'});
  await assert.rejects(f.service.test('member-invitation',A,{...body,html:'no required variables'},request),{code:'EMAIL_TEMPLATE_INVALID'});
  f.deny();await assert.rejects(f.service.test('member-invitation',A,body,request),{code:'C4G_ADMIN_REQUIRED'});
  assert.equal(f.sent.length,1);
});

test('test reports uncertain delivery and unavailable configuration without claiming success',async()=>{
  const f=fixture(),body={subject:'Convite',html,idempotencyKey:A};
  f.outcome('UNCONFIRMED');assert.equal((await f.service.test('member-invitation',null,body,request)).status,'UNCONFIRMED');
  f.outcome('NOT_CONFIGURED');await assert.rejects(f.service.test('member-invitation',null,body,request),{code:'EMAIL_DELIVERY_UNAVAILABLE'});
});
