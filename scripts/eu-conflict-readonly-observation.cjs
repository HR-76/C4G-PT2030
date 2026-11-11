'use strict';
// Read-only, fixed-ID observation. Does not use application configuration or DB.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createSource, LIMITS } = require('../backend/src/fundingTenders/source');

const IDS = Object.freeze([
  'CASCADE:17045',
  'CEF-T-2021-AFIFCOEN-WORKS-LNG',
  'CEF-T-2021-AFIFCOEN-WORKS-ZE',
  'CEF-T-2021-AFIFGEN-UNITS',
  'CEF-T-2021-AFIFGEN-WORKS-LNG',
  'ERASMUS-EDU-2022-ECHE-CERT-FP',
  'ESC-HUMAID-2021-QUAL-LABEL-FP'
]);
const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'output', `eu-conflict-observation-${randomUUID()}.json`);
const source = createSource({
  fetchImpl: globalThis.fetch,
  enrichmentEnabled: true,
  canonicalV2Enabled: true,
  limits: { ...LIMITS, retries: 0, totalMs: 20000 }
});
function mappingSignals(evidence) {
  const raw = evidence?.variants?.[0];
  if (!raw) return null;
  const metadata = raw.metadata || {};
  const multiValueFields = Object.entries(metadata)
    .filter(([, values]) => Array.isArray(values) && new Set(values).size > 1)
    .map(([key]) => key).sort();
  const content = typeof raw.content === 'string'
    ? require('../backend/src/fundingTenders/sourceDescription').sourceDescription(raw.content, raw.content.length + 1)
    : null;
  const callTitle = metadata.callTitle?.[0] || null;
  const normalized = value => value?.normalize('NFC').trim() || null;
  return { multiValueFields, contentCallTitleDifferent: Boolean(content && callTitle && normalized(content) !== normalized(callTitle)),
    distinctOpeningValues: new Set(metadata.startDate || []).size };
}

async function main() {
  const rows = [];
  for (const externalIdentifier of IDS) {
    try {
      const result = await source.lookup({ externalIdentifier });
      rows.push({ externalIdentifier, outcome: result.outcome,
        conflictReasons: result.conflictReasons || [], received: result.received,
        observedAt: result.observedAt, evidenceFingerprint: result.evidence?.fingerprint || null,
        archivedVariants: result.evidence?.variants.length || 0,
        ...(externalIdentifier === 'CASCADE:17045' ? { mappingSignals: mappingSignals(result.evidence) } : {}) });
    } catch (error) {
      rows.push({ externalIdentifier, outcome: 'LOOKUP_ERROR',
        errorCode: /^[A-Z0-9_]{3,100}$/.test(error.code || '') ? error.code : 'SOURCE_UNAVAILABLE' });
    }
  }
  const report = { kind: 'eu-conflict-readonly-observation-v2', generatedAt: new Date().toISOString(),
    source: 'EU_FUNDING_TENDERS', liveReadOnly: true, habitualDatabaseAccess: false,
    caveat: 'Current observations cannot establish historical conflict causes or override protected resolutions.', rows };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ report: path.relative(root, reportPath).replaceAll('\\', '/'),
    outcomes: rows.map(({ externalIdentifier, outcome, conflictReasons, errorCode }) =>
      ({ externalIdentifier, outcome, conflictReasons, ...(errorCode ? { errorCode } : {}) })) }));
}
main().catch(() => { console.error('EU_CONFLICT_OBSERVATION_FAILED'); process.exitCode = 1; });
