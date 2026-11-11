# Central/security SQL A/B

The authorized contract is `context/features/central-security-snapshot-sql-performance.md`.
A is the exact immutable 1844-source `eu-writer-trial-0ecb31dc7c705859` archive. B replaces only `backend/src/security/centralSchemaManifest.js` and `backend/src/security/authoritySecurityManifest.js`. Package definitions, fingerprints, authority checkpoints, HTTP composition, source-control changes and all other runtime bytes remain those of A.

The common harness and identified regression files are separately archived. `backend/test/centralSchemaCatalogBatch.test.js` is a validation overlay only; the new regressions and common harness may be overlaid into a separate `validation/B` tree for local suites. Neither workload source tree is modified for validation.

Prepare with `node scripts/prepare-central-snapshot-ab.cjs --prepare`. The resulting `ab.json` binds A/B/common digests, three ZIP archives, parent provenance, the two runtime overlays, lockfile/dependency version metadata and the fixed protocol. Preparation runs no services or workloads. Attach the same three installed dependency directories to each arm only after capture; installed dependency bytes are not archived. Verify with the captured `common/scripts/verify-central-snapshot-ab.cjs --manifest <absolute ab.json>`.

Run the captured common `test/integration/central-snapshot-ab/run.cjs` with `--isolated --readiness --manifest <ab.json> --tls-dir <existing local test TLS directory>`. `--equivalence` runs only the two schema equivalence fixtures and cannot authorize measurement. Full readiness additionally creates fresh A and B HTTP/OIDC fixtures. Equivalence/EXPLAIN/security mutations occur before, and outside, all timing populations.

After readiness and local validation pass, invoke `--measure-metadata` then `--measure-http`, supplying `--readiness-report <matching report.json>` as well as the same manifest and TLS directory. M uses one fresh fixture per revision and six alternating A/B pairs, one connection per block, 10 warmups and 100 measured calls. H uses eight independent arm fixtures in AB/BA/AB/BA order and the original six-scenario matrix: 288 measured attempts and 56 warmups. Each H arm first performs the original real HTTP/OIDC readiness checks. This is aggregate A versus aggregate B, not M7/M1.

Every process verifies the common harness and both roots before loading runtime modules and after work. The original per-arm infrastructure, fixture, HTTP, instrumentation and readiness modules are loaded from that arm's source root. Metadata/equivalence use the common collectors and limited fixture clients without installing HTTP instrumentation on only one arm. The pinned original Windows child-process watchdog, owned-resource cleanup and Docker operations are reused. Credentials remain in the owned child's environment and are omitted from reports and arguments.

Only the new bundle's `evidence/<run UUID>/` receives reports. All partial failures are retained. Cleanup attempts every owner-specific close, then the parent verifies child exit and removes only its labeled resource IDs. No old bundle, habitual service, runtime configuration or external database is changed. Reports preserve source/manifest/harness/seed/image bindings and stage hashes. Measurement requires the matching A/B readiness proof; the historical single-variant readiness proof is insufficient.

After any cleanup failure the next fixture is refused. A forced process-tree termination can lose samples still buffered since the last progress checkpoint; the partial stage remains a failure and cannot establish complete measurement or readiness. Ordinary reported failures retain their attached partial collector/HTTP evidence.

No workload executes merely by importing any new module. Host exclusivity is not claimed; fixed-schema paired comparisons and short HTTP samples are diagnostic. Analyze pairing, failures, uncertainty and overlaps before proposing an optimization conclusion.
