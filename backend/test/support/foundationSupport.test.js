const assert = require("node:assert/strict");
const test = require("node:test");
const fixtures = require("./fixtures");
const doubles = require("./doubles");

test("fixtures contain two distinct, wholly synthetic organizations and known resources", () => {
  assert.equal(fixtures.organizations.length, 2);
  assert.equal(new Set(fixtures.organizations.map(item => item.id)).size, 2);
  assert.equal(fixtures.memberships.length, 2);
  assert.equal(fixtures.resources.length, 2);
  const serialized = JSON.stringify(fixtures).toLowerCase();
  assert.match(serialized, /synthetic/);
  assert.doesNotMatch(serialized, /ubi|covilh|@|professor|admin/);
});

test("the six boundary doubles record success, failure and clock calls", async () => {
  const identity = doubles.createIdentityDouble({ resolveIdentity: { id: "user-synthetic-analyst" } });
  const central = doubles.createCentralDatabaseDouble({ findMembership: new Error("synthetic failure") });
  const tenant = doubles.createTenantDouble({ query: { rows: [] } });
  const r2 = doubles.createR2Double({ putObject: { etag: "synthetic-etag" } });
  const resend = doubles.createResendDouble({ sendEmail: { id: "synthetic-message" } });
  const clock = doubles.createClockDouble();

  assert.deepEqual(await identity.resolveIdentity("synthetic-subject"), { id: "user-synthetic-analyst" });
  await assert.rejects(central.findMembership("org-synthetic-alpha"), /synthetic failure/);
  await tenant.query("synthetic-query");
  await r2.putObject({ key: "synthetic-key" });
  await resend.sendEmail({ to: "synthetic-recipient" });
  assert.equal(clock.now().toISOString(), "2030-01-15T12:00:00.000Z");
  for (const boundary of [identity, central, tenant, r2, resend, clock]) assert.equal(boundary.calls.length, 1);
});
