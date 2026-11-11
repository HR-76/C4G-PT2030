const organizations = Object.freeze([
  Object.freeze({ id: "org-synthetic-alpha", name: "Synthetic Alpha Institute" }),
  Object.freeze({ id: "org-synthetic-beta", name: "Synthetic Beta Institute" })
]);

const identities = Object.freeze([
  Object.freeze({ id: "user-synthetic-analyst", handle: "synthetic-analyst" }),
  Object.freeze({ id: "user-synthetic-reviewer", handle: "synthetic-reviewer" })
]);

const memberships = Object.freeze([
  Object.freeze({ id: "membership-synthetic-alpha", organizationId: organizations[0].id, userId: identities[0].id, profile: "test-analyst" }),
  Object.freeze({ id: "membership-synthetic-beta", organizationId: organizations[1].id, userId: identities[1].id, profile: "test-reviewer" })
]);

const resources = Object.freeze([
  Object.freeze({ id: "resource-synthetic-alpha-001", organizationId: organizations[0].id }),
  Object.freeze({ id: "resource-synthetic-beta-001", organizationId: organizations[1].id })
]);

module.exports = Object.freeze({ organizations, identities, memberships, resources });
