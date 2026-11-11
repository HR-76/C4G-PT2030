# Native local catalog reader compatibility

Authorized scope: restore the habitual localhost:3000 application using existing
Dev data and accounts. Rehearse the official Central 027 -> 030 chain on a restored
backup before updating Central Dev. Preserve historical SQL/checksums and existing
business data. Do not apply Central 032 or the consolidated rollout.

Provision the existing catalog-reader service contract separately from startup.
Keep its credentials in a restricted external file; the local runtime selects that
file explicitly. No administrative fallback, new functional grants on existing
accounts, password reset, or weakening of authentication.

Acceptance: backup restoration and data comparison; official preflight; reader
positive and negative permission tests; unchanged prior ledger rows; configured
normal local startup and existing Admin/Entity login. Preserve other resources.

Central 029 removes PUBLIC TEMPORARY only in the affected database. Inspect known
local workloads for temporary-table dependencies and test their affected paths.
Unknown external workloads are not presumed compatible.
