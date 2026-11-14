const assert = require('node:assert/strict');
const test = require('node:test');
const { createMembershipRepository } = require('../../src/security/membershipRepository');
const { createOrganizationSessionService } = require('../../src/security/organizationSession');
const { createOrganizationAuthController } = require('../../src/controllers/organizationAuthController');
const { createOrganizationContextMiddleware } = require('../../src/middlewares/organizationContext');
const { createOidcAuthController, persistRotatedAuthenticationSession } = require('../../src/controllers/oidcAuthController');

const ORG_A = '10000000-0000-4000-8000-000000000001';
const ORG_B = '10000000-0000-4000-8000-000000000002';
const context = id => ({
  organizationId: id, membershipId: id.replace(/^1/, '2'), membershipVersion: 3, baseRoleCode: 'OPAQUE_ROLE',
  organization: { id, displayName: id === ORG_A ? 'Alpha' : 'Beta', slug: id === ORG_A ? 'alpha' : 'beta' }
});

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, redirect(code, value) { this.statusCode = code; this.location = value; return this; } };
}

function request() {
  const req = {
    user: { id: 'user-1', name: 'Synthetic' }, sessionID: 'sid-old',
    session: { auth: { user: { id: 'user-1', name: 'Synthetic' }, revocationVersion: 1, absoluteExpiresAt: 9999999999999 } }
  };
  req.session.regenerate = callback => { req.sessionID = 'sid-new'; callback(); };
  req.session.save = callback => callback();
  req.session.destroy = callback => { req.destroyed = true; callback(); };
  return req;
}

test('session exposes only a presentation label from the resolved current membership', () => {
  const controller = createOrganizationAuthController({});
  for (const [role, label] of [['ORG_ADMIN', 'Administrador do cliente'], ['CONTRIBUTOR', 'Membro da organização'], ['VIEWER', 'Consulta'], ['FUNDING_MANAGER', 'Gestor de candidaturas']]) {
    const req = request();
    req.organizationContext = { ...context(ORG_A), baseRoleCode: role };
    const res = response();
    controller.session(req, res);
    assert.equal(res.body.organization.profileLabel, label);
    assert.equal(res.body.organization.profileCode, role);
    // The backend decides which areas a profile may open; the client only follows this list.
    assert.deepEqual(res.body.organization.navigation, { ORG_ADMIN: { partners: true, calendar: true, people: true, dashboard: 'ORGANIZATION' }, FUNDING_MANAGER: { partners: true, calendar: false, people: true, dashboard: 'ORGANIZATION' },
      CONTRIBUTOR: { partners: false, calendar: false, people: false, dashboard: 'TECHNICIAN' }, VIEWER: { partners: true, calendar: false, people: false, dashboard: 'ORGANIZATION' } }[role]);
    assert.equal(res.body.organization.membershipId, undefined);
    assert.equal(res.body.organization.baseRoleCode, undefined);
  }
  const req = request();
  req.session.auth.organizationContext = { ...context(ORG_A), baseRoleCode: 'ORG_ADMIN' };
  const res = response();
  controller.session(req, res);
  assert.equal(res.body.organization, null, 'stale session context cannot supply a profile');
});

test('organization selection returns the same validated profile label as session', async () => {
  const controller = createOrganizationAuthController({
    organizationSession: { select: async () => ({ ...context(ORG_B), baseRoleCode: 'ORG_ADMIN' }) },
    generateCsrfToken: () => 'csrf'
  });
  const req = request(); req.body = { organizationId: ORG_B };
  const res = response();
  await controller.select(req, res, error => { throw error; });
  assert.equal(res.body.organization.profileLabel, 'Administrador do cliente');
  assert.equal(res.body.organization.id, ORG_B);
});

test('selection rejects malformed or additional input without touching the session', async () => {
  let selected = false;
  const controller = createOrganizationAuthController({
    organizationSession: { select: async () => { selected = true; } }, generateCsrfToken: () => 'csrf'
  });
  for (const body of [undefined, {}, { organizationId: 'not-a-uuid' }, { organizationId: ORG_A, extra: true }]) {
    const req = request(); req.body = body;
    const res = response();
    await controller.select(req, res, error => { throw error; });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: { code: 'ORGANIZATION_SELECTION_INVALID', message: 'Invalid organization selection.' } });
    assert.equal(req.sessionID, 'sid-old');
  }
  assert.equal(selected, false);
});

test('ineligible selection is uniform and does not rotate SID or CSRF', async () => {
  let csrfCalled = false;
  const controller = createOrganizationAuthController({
    organizationSession: { select: async () => null }, generateCsrfToken: () => { csrfCalled = true; }
  });
  const req = request(); req.body = { organizationId: ORG_A };
  const res = response();
  await controller.select(req, res, error => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'ORGANIZATION_NOT_SELECTABLE');
  assert.equal(req.sessionID, 'sid-old');
  assert.equal(csrfCalled, false);
});

test('valid selection rotates and persists both stores before returning minimal public data', async () => {
  const calls = [];
  const req = request(); req.body = { organizationId: ORG_A };
  req.session.save = callback => { calls.push('store-save'); callback(); };
  const service = createOrganizationSessionService({
    membershipRepository: { resolveEligible: async () => context(ORG_A) },
    sessionRegistry: { rotateSession: async input => { calls.push('central-rotate'); assert.equal(input.organizationContext.organizationId, ORG_A); } }
  });
  const controller = createOrganizationAuthController({ organizationSession: service, generateCsrfToken: reqArg => `csrf:${reqArg.sessionID}` });
  const res = response();
  await controller.select(req, res, error => { throw error; });
  assert.deepEqual(calls, ['store-save', 'central-rotate']);
  assert.equal(req.sessionID, 'sid-new');
  assert.deepEqual(res.body.organization, { id: ORG_A, displayName: 'Alpha', slug: 'alpha' });
  assert.equal(res.body.csrfToken, 'csrf:sid-new');
  assert.equal(JSON.stringify(res.body).includes('membership'), false);
  assert.equal(JSON.stringify(res.body).includes('OPAQUE_ROLE'), false);
});

test('Central persistence failure destroys the new store session and suppresses success', async () => {
  const req = request();
  const service = createOrganizationSessionService({
    membershipRepository: { resolveEligible: async () => context(ORG_A) },
    sessionRegistry: { rotateSession: async () => { throw new Error('central unavailable'); } }
  });
  await assert.rejects(service.select(req, ORG_A), /central unavailable/);
  assert.equal(req.destroyed, true);
});

test('Express persistence failure destroys the regenerated session before Central is called', async () => {
  const req = request();
  req.session.save = callback => callback(new Error('store unavailable'));
  let centralCalled = false;
  const service = createOrganizationSessionService({
    membershipRepository: { resolveEligible: async () => context(ORG_A) },
    sessionRegistry: { rotateSession: async () => { centralCalled = true; } }
  });
  await assert.rejects(service.select(req, ORG_A), /store unavailable/);
  assert.equal(req.destroyed, true);
  assert.equal(centralCalled, false);
});

test('failed compensation aggregates persistence and destroy errors', async () => {
  const req = request();
  req.session.destroy = callback => callback(new Error('destroy unavailable'));
  const service = createOrganizationSessionService({
    membershipRepository: { resolveEligible: async () => context(ORG_A) },
    sessionRegistry: { rotateSession: async () => { throw new Error('central unavailable'); } }
  });
  await assert.rejects(service.select(req, ORG_A), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /central unavailable/);
    assert.match(error.errors[1].message, /destroy unavailable/);
    assert.equal(error.cause, error.errors[0]);
    return true;
  });
});

test('OIDC callback persistence helper compensates an Express save failure before Central is called', async () => {
  const req = request();
  req.session.save = callback => callback(new Error('callback store unavailable'));
  let centralCalled = false;
  await assert.rejects(persistRotatedAuthenticationSession({
    req,
    sessionRegistry: { rotateSession: async () => { centralCalled = true; } },
    rotation: {}
  }), /callback store unavailable/);
  assert.equal(req.destroyed, true);
  assert.equal(centralCalled, false);
});

test('OIDC callback persistence helper aggregates registry and compensation failures', async () => {
  const req = request();
  req.session.destroy = callback => callback(new Error('callback destroy unavailable'));
  await assert.rejects(persistRotatedAuthenticationSession({
    req,
    sessionRegistry: { rotateSession: async () => { throw new Error('callback central unavailable'); } },
    rotation: {}
  }), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /central unavailable/);
    assert.match(error.errors[1].message, /destroy unavailable/);
    assert.equal(error.cause, error.errors[0]);
    return true;
  });
});

test('final Central eligibility check fails before revoking the previous SID', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (/SELECT om\.id/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); }
  };
  const { createPgSessionRegistry } = require('../../src/security/sessionRegistry');
  const registry = createPgSessionRegistry({ connect: async () => client });
  await assert.rejects(registry.rotateSession({
    previousSid: 'sid-old', sid: 'sid-new', globalUserId: 'user-1', revocationVersion: 1,
    expiresAt: Date.now() + 60000, organizationContext: context(ORG_A)
  }), /no longer eligible/);
  assert.equal(calls.some(sql => typeof sql === 'string' && /UPDATE public\.application_session\s+SET status = 'REVOKED'/.test(sql)), false);
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'RELEASE']);
});

test('stale organization context rotates to a global session and tenant middleware returns 409', async () => {
  const req = request();
  const rotations = [];
  const service = createOrganizationSessionService({
    membershipRepository: {},
    sessionRegistry: {
      resolveOrganizationContext: async () => ({ state: 'INVALID' }),
      rotateSession: async input => rotations.push(input)
    }
  });
  const middleware = createOrganizationContextMiddleware({ organizationSession: service });
  await new Promise((resolve, reject) => middleware.resolveOrganizationContext(req, response(), error => error ? reject(error) : resolve()));
  const res = response();
  middleware.requireOrganizationContext(req, res, () => assert.fail('tenant access must remain blocked'));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'ORGANIZATION_SELECTION_REQUIRED');
  assert.equal(req.sessionID, 'sid-new');
  assert.equal(rotations.length, 1);
  assert.equal(rotations[0].organizationContext, null);
});

test('Central NONE reconciles a stale Express context but leaves a consistently global session unchanged', async () => {
  for (const expressHasContext of [true, false]) {
    const req = request();
    req.session.auth.organizationContext = expressHasContext ? context(ORG_A) : null;
    const rotations = [];
    const service = createOrganizationSessionService({
      membershipRepository: {},
      sessionRegistry: {
        resolveOrganizationContext: async () => ({ state: 'NONE' }),
        rotateSession: async input => rotations.push(input)
      }
    });
    await service.resolve(req);
    assert.equal(rotations.length, expressHasContext ? 1 : 0);
    if (expressHasContext) assert.equal(rotations[0].organizationContext, null);
  }
});

test('eligible organizations are ordered by the repository and public payload stays minimal', async () => {
  let sql;
  const repository = createMembershipRepository({ query: async (text, values) => {
    sql = text;
    assert.equal(values[0], 'user-1');
    return { rows: [
      { membership_id: 'm1', organization_id: ORG_A, membership_version: '1', base_role_code: 'OPAQUE', display_name: 'Alpha', slug: 'alpha' },
      { membership_id: 'm2', organization_id: ORG_B, membership_version: '2', base_role_code: 'OPAQUE', display_name: 'Beta', slug: 'beta' }
    ] };
  } });
  const controller = createOrganizationAuthController({
    organizationSession: { organizations: id => repository.listEligible(id, Date.now()) }, generateCsrfToken: () => 'unused'
  });
  const res = response();
  await controller.list({ user: { id: 'user-1' } }, res, error => { throw error; });
  assert.match(sql, /ORDER BY org\.display_name ASC, org\.id ASC/);
  assert.deepEqual(res.body.organizations.map(item => item.id), [ORG_A, ORG_B]);
  assert.equal(JSON.stringify(res.body).includes('membership'), false);
});

test('session payload exposes only validated public organization and selection state', () => {
  const controller = createOrganizationAuthController({ organizationSession: {}, generateCsrfToken: () => 'unused' });
  const req = request();
  let res = response();
  controller.session(req, res);
  assert.deepEqual(res.body, { user: req.user, organization: null, organizationSelectionRequired: true });
  req.organizationContext = context(ORG_A);
  res = response();
  controller.session(req, res);
  assert.deepEqual(res.body, {
    user: req.user,
    organization: { id: ORG_A, displayName: 'Alpha', slug: 'alpha' },
    organizationSelectionRequired: false
  });
  assert.equal(Object.hasOwn(res.body, 'csrfToken'), false);
});

test('membership status change is transactional and increments only the targeted membership version', async () => {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/UPDATE public\.organization_membership/.test(sql)) return { rows: [{ id: 'membership-a', global_user_id: 'user-1', organization_id: ORG_A, membership_version: '4' }] };
      return { rows: [] };
    }, release() { calls.push({ sql: 'RELEASE' }); }
  };
  const repository = createMembershipRepository({ connect: async () => client });
  const result = await repository.changeStatus({ membershipId: 'membership-a', status: 'SUSPENDED', reason: 'synthetic' });
  assert.equal(result.membershipVersion, 4);
  assert.deepEqual(calls.map(call => call.sql), ['BEGIN', calls[1].sql, 'COMMIT', 'RELEASE']);
  assert.match(calls[1].sql, /membership_version = membership_version \+ 1/);
  assert.deepEqual(calls[1].values, ['membership-a', 'SUSPENDED', 'synthetic']);
});

test('membership status change discards the client and aggregates primary and rollback failures', async () => {
  const primaryError = new Error('membership update failed');
  const rollbackError = new Error('membership rollback failed');
  const releaseCalls = [];
  const client = {
    async query(sql) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'ROLLBACK') throw rollbackError;
      throw primaryError;
    },
    release(error) { releaseCalls.push(error); }
  };
  const repository = createMembershipRepository({ connect: async () => client });
  await assert.rejects(repository.changeStatus({ membershipId: 'membership-a', status: 'SUSPENDED' }), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.deepEqual(error.errors, [primaryError, rollbackError]);
    assert.equal(error.cause, primaryError);
    return true;
  });
  assert.deepEqual(releaseCalls, [rollbackError]);
});

test('membership status change aggregates a healthy-release failure without a second release', async () => {
  const primaryError = new Error('membership update failed');
  const releaseError = new Error('membership release failed');
  let releaseCount = 0;
  const client = {
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      throw primaryError;
    },
    release(error) {
      releaseCount += 1;
      assert.equal(error, undefined);
      throw releaseError;
    }
  };
  const repository = createMembershipRepository({ connect: async () => client });
  await assert.rejects(repository.changeStatus({ membershipId: 'membership-a', status: 'REMOVED' }), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.deepEqual(error.errors, [primaryError, releaseError]);
    assert.equal(error.cause, primaryError);
    return true;
  });
  assert.equal(releaseCount, 1);
});

test('OIDC login auto-selects exactly one membership and never auto-selects zero or multiple', async () => {
  for (const eligible of [[], [context(ORG_A)], [context(ORG_A), context(ORG_B)]]) {
    const now = 2_000_000_000_000;
    const req = request();
    req.query = { state: 'state' };
    req.originalUrl = '/api/auth/oidc/callback?code=synthetic&state=state';
    req.session.oidcTransaction = { codeVerifier: 'v', state: 'state', nonce: 'n', createdAt: now, returnPath: '/' };
    const rotations = [];
    const controller = createOidcAuthController({
      config: { oidcTransactionMs: 60000, publicOrigin: new URL('https://app.example.invalid'), policyVersion: 'v1', privilegedRoleNames: [], sessionAbsoluteMs: 60000, assurancePolicy: {} },
      now: () => now,
      oidcClient: { callback: async () => ({ claims: { iss: 'https://issuer.example.invalid', sub: 'subject', auth_time: now / 1000 } }) },
      identityRepository: { resolve: async () => ({ id: 'user-1', platformRoles: [], sessionRevocationVersion: 1 }) },
      membershipRepository: { listEligible: async () => eligible },
      sessionRegistry: { consumeOidcTransaction: async () => true, rotateSession: async input => rotations.push(input) }
    });
    const res = response();
    await controller.callback(req, res, error => { throw error; });
    assert.equal(res.statusCode, 302);
    assert.equal(rotations[0].organizationContext, eligible.length === 1 ? eligible[0] : null);
  }
});
