'use strict';
// One EU cycle in a visible, human-authenticated OIDC browser. The source is
// suspended in the executor's finally path, including terminal errors.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const cfg = require('../backend/scripts/localPlatform/config');
const { euWriterConfiguration } = require('../backend/src/fundingTenders/euWriter');
const { runControlledCycle, browserSession } = require('./eu-writer-controlled-cycle.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fail(code) { throw Object.assign(Error(code), { code }); }
function input(argv) {
  if (argv.length !== 2 || !/^--readiness=output\/eu-resume-readiness-[a-f0-9-]{36}\.json$/.test(argv[0])
    || !/^--backup=output\/eu-legacy-acceptance-window-[a-f0-9-]{36}\/preparation\.json$/.test(argv[1]))
    fail('EU_RESUME_INPUT_INVALID');
  return [argv[0].slice(12), argv[1].slice(9)];
}
function evidence(argv, now = Date.now(), root = cfg.root) {
  const [readinessPath, backupPath] = input(argv);
  const readBytes = fs.readFileSync(path.join(root, readinessPath));
  const backupBytes = fs.readFileSync(path.join(root, backupPath));
  const ready = JSON.parse(readBytes), backup = JSON.parse(backupBytes);
  if (ready.kind !== 'eu-resume-readiness-v1' || ready.status !== 'READY_FOR_AUTHENTICATED_CONTROLLED_CYCLE'
    || Date.parse(ready.checkedAt) > now || now - Date.parse(ready.checkedAt) > 15 * 60 * 1000
    || ready.centralVersion !== '045_opportunity_eu_legacy_prearchive'
    || ready.source?.state !== 'QUIESCED' || ready.source.fence !== 7 || ready.source.canResume !== true
    || ready.source.pendingRuns !== 0 || ready.source.activeLeases !== 0
    || ready.worker?.state !== 'PROCESSING' || ready.worker.ready !== true || ready.worker.capabilityMatch !== true
    || ready.inventory?.legacy?.length !== 7
    || !ready.inventory.versions.some(v => v.current_schema_version === 2 && v.count === 529)
    || backup.status !== 'PASS' || backup.healthRestored !== true || backup.sourceResumed !== false
    || backup.workBefore?.source?.state !== 'QUIESCED' || Number(backup.workBefore.source.fence) !== 7
    || Date.parse(backup.completedAt) > now || now - Date.parse(backup.completedAt) > 30 * 60 * 1000)
    fail('EU_RESUME_EVIDENCE_STALE');
  return { ready, backup, readiness: { path: readinessPath, sha256: sha(readBytes) },
    backupProof: { path: backupPath, sha256: sha(backupBytes) } };
}
async function main(argv = process.argv.slice(2)) {
  const checked = evidence(argv), id = randomUUID();
  const folder = path.join(cfg.root, 'output', 'eu-resume-cycle-' + id);
  fs.mkdirSync(folder);
  const file = path.join(folder, 'report.json');
  const report = { kind: 'eu-resume-controlled-cycle-045-v1', id, status: 'WAITING_FOR_HUMAN_OIDC',
    startedAt: new Date().toISOString(), readiness: checked.readiness,
    backup: checked.backupProof, credentialsExported: false, sourceBefore: checked.ready.source,
    steps: [], loginNavigation: [] };
  const save = () => cfg.saveState(report, file);
  save();
  let first, running = false, phase = 'BROWSER_LOGIN';
  try {
    const navigation = pathname => { report.loginNavigation.push(pathname); save(); };
    first = await browserSession({ interactive: true, onNavigation: navigation });
    phase = 'ADMIN_SESSION';
    const actor = (await first.request('GET', '/api/auth/session'))?.user;
    if (!UUID.test(actor?.id) || !actor.platformRoles?.includes('C4G_ADMIN')) fail('EU_RESUME_ADMIN_REQUIRED');
    phase = 'PLAN_BINDING';
    const writer = euWriterConfiguration();
    const plan = { windowId: id, source: { fence: 7 }, writer,
      controlledCycle: { observationWindowSeconds: 180 } };
    const execution = { executionId: id, source: { fence: 7 },
      approval: { actorId: actor.id }, planDigest: sha(JSON.stringify(plan)) };
    const validate = (_execution, _plan, now) => {
      if (_execution !== execution || _plan !== plan || now - Date.parse(report.startedAt) > 15 * 60 * 1000
        || sha(fs.readFileSync(path.join(cfg.root, checked.readiness.path))) !== checked.readiness.sha256
        || sha(fs.readFileSync(path.join(cfg.root, checked.backupProof.path))) !== checked.backupProof.sha256)
        fail('EU_RESUME_EVIDENCE_CHANGED');
      return plan;
    };
    report.status = 'RUNNING'; report.authenticatedActorId = actor.id; save();
    let handed = false;
    phase = 'CONTROLLED_CYCLE'; running = true;
    report.result = await runControlledCycle({ execution, plan, validate,
      openSession: async () => { if (!handed) { handed = true; return first; }
        return browserSession({ interactive: true, onNavigation: navigation }); },
      onProgress: async event => { report.steps.push(event); save(); } });
    report.status = report.result.status;
    if (report.result.finalSuspensionVerified !== true || !['PASS', 'PARTIAL'].includes(report.status))
      fail('EU_RESUME_CYCLE_NOT_VERIFIED');
  } catch (error) {
    report.status = 'FAIL';
    report.failure = /^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_RESUME_CYCLE_FAILED';
    report.failurePhase = phase;
    report.failureClass = ['AssertionError','Error','TypeError','TimeoutError'].includes(error?.name) ? error.name : 'UNKNOWN';
    if (/^[A-Za-z0-9 _().:-]{1,160}$/.test(error?.message || '')) report.failureMessage = error.message;
    if (!running) await first?.close().catch(() => {});
  } finally {
    report.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, id, finalSuspensionVerified: report.result?.finalSuspensionVerified === true,
      cycleStatus: report.result?.cycle?.status || null, report: path.relative(cfg.root, file).replaceAll('\\', '/'),
      failure: report.failure || report.result?.failure || null }));
  }
  if (report.status === 'FAIL') process.exitCode = 1;
  return report;
}
if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_RESUME_CYCLE_FAILED');
  process.exitCode = 1;
});
module.exports = { input, evidence, main };
