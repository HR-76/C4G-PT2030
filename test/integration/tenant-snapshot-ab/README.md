# Tenant snapshot SQL A/B

The parent is the validated B variant of `central-snapshot-ab-58f2f8910abee80f`, not the live workspace. The only runtime overlay is the canonical PostgreSQL NOT NULL projection in `tenantSchemaFingerprint.js`. Explicit test overlays and common infrastructure have independent source provenance.

`run.cjs --isolated --readiness --manifest <ab.json> --tls-dir <existing-local-tls>` validates Central042/043, tenant034 equality/drift/checkpoint boundaries and HTTP/OIDC for A/B. The read-only tenant microbenchmark then uses `--measure-metadata --readiness-report <new-readiness/report.json>`: two tenant034 populations, six alternating pairs each,10 warmups/100 measurements per block,2400 measures/240 warmups. It is not a Central microbenchmark.

H uses `--measure-http` with the same new readiness proof: eight fresh fixtures in AB/BA/AB/BA order,288 measures/56 warmups/136 readiness controls. Same frozen HTTP matrix, concurrency, leases and phase budgets. Each stage is a separate owned child and two isolated containers; cleanup failure stops the campaign. All failures are retained; no automatic retry or continuation.

Only synthetic owned resources and local image IDs may be used. Never target habitual services or5432/5433. Secrets remain in memory/child environment and are not part of reports. Run suites and builds before timing, then avoid concurrent own heavy work. Source/dependency/report hashes and actual owned-resource absence must be checked at closure.

Contract: `context/features/tenant-snapshot-sql-performance.md`. The common Central equivalence and authority-after-lock helpers are copied unchanged from the previous harness; tenant-specific proof is additional, never a replacement.

Run a hash-verified copy of `analyze.cjs` in a new analysis directory outside the frozen bundle: its output files are written beside the script. Supply the manifest, matching readiness report, M report and complete H report, in that order. A fifth continuation argument is refused.

Readiness observations retain all17 HTTP attempts and9 drains before assertions, with closed error codes and projected instrumentation only. The wrapper is used during readiness; measured HTTP uses the original harness object. An observer error prevents acceptance. The earlier readiness failure remains in its original bundle; a later corrected harness has a new identity and cannot rewrite that failure.
