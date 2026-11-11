# Local Tenant 030 historical ownership transition

Authorized scope: preserve the native Dev data and historical migration ledger;
correct only `async_exec.guard_outbox_lineage_v1()` ownership from
`c4g_f12_admin` to `c4g_tenant_owner`. No Central 032, consolidated patch,
functional privilege expansion, or historical SQL/checksum replacement.

Admission is restricted to the exact 30-entry historical ledger through
`030_organization_notices`, digest
`4dc1dc0d4b91d822c27b5a996b4a8ca051bc621edc5122970aeee9d572c4c46d`.
The historical schema fingerprint is
`e39a77c76efb85ce9e19fe17f2e92057739681ded45601cb3e2c1374fca6a623`.
Changing that single owner in the catalog snapshot must produce the current
canonical 030 fingerprint. Runtime admission still requires the canonical
schema and all existing privilege/capability checks. Historical fingerprints
are evidence of earlier execution, not a waiver of current schema checks.

Acceptance: restore protected backups into disposable databases; reject
additional schema/ledger drift; validate rollback, repeat safety, final
preflight and unchanged business data/ACL/memberships. Record the transition
outside the repository with database identity, transaction ID, hashes and
before/after evidence. Publish only the new schema observation through the
existing Central repository (with its audit event); update the private local
snapshot. Keep the original ledger unchanged. Back up before Dev application,
stop only its writers, then verify the normal localhost:3000 startup and
existing authorized accounts. No automatic startup repair.
