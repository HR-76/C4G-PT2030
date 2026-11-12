'use strict';
// Takes the candidates a Portugal 2030 import staged and accepts the NEW ones into the common central catalogue, in one
// batch the administrator approves by its digest. Contract: context/features/pt2030-central-import-to-catalog.md.
//
// Only candidates that reconcile as NEW are accepted. One whose identity is already accepted is reported as such; one
// whose content differs from what is accepted, or that reconciliation blocks, stays for review and is never written
// (accepting changes would overwrite editorial work). Each candidate is accepted in its own transaction, so one failure
// does not undo the others, and the request id is derived from the import and the candidate, so a repeat adds nothing.
const { createHash } = require('node:crypto');
const { canonicalize } = require('../organizationalProfile/canonicalization');
const { createAcceptedOpportunityV2Repository } = require('../opportunities/v2/acceptedRepository');
const { createActivationAuditV2 } = require('../opportunities/v2/activationAudit');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const sha = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const STATUS = Object.freeze({ ACCEPTABLE: 'ACCEPTABLE', ALREADY_ACCEPTED: 'ALREADY_ACCEPTED', NEEDS_REVIEW: 'NEEDS_REVIEW', REJECTED: 'REJECTED' });
// Reconciliation actions that never lead to a write here.
const ACTION_STATUS = Object.freeze({ NEW: STATUS.ACCEPTABLE, UNCHANGED: STATUS.ALREADY_ACCEPTED, CHANGE_REQUIRES_APPROVAL: STATUS.NEEDS_REVIEW, BLOCKED: STATUS.NEEDS_REVIEW });

function publicCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^(OPPORTUNITY_V2|PT2030)_[A-Z0-9_]{1,80}$/.test(code) ? code : 'PT2030_ACCEPT_FAILED';
}

// readImport({ userId, sessionId, importId }) is the trusted, authorized read of the staged import:
//   { importId, mappingDigest, rows: [{ physicalRow, externalIdentifier, errors, revisionId, contentDigest, snapshot,
//     accepted: { opportunityId, revisionId, rowVersion } | null }] }  (accepted: what the catalogue already holds for that identity)
function createPortugal2030CatalogAcceptance({ pool, authority, audit = createActivationAuditV2(), readImport, accepted: injected = null } = {}) {
  if (typeof readImport !== 'function' || !authority || typeof authority.authorize !== 'function') throw new TypeError('Catalogue acceptance requires an authorized import reader and the activation authority.');
  // The approval is the administrator's explicit batch request, bound to a digest the server recomputes. This port only
  // confirms that this exact candidate was bound for this exact context and that the session is still authorized.
  const bindings = new WeakMap();
  const accepted = injected || createAcceptedOpportunityV2Repository({ pool, authorize: authority.authorize, audit,
    verifyApproval: async (client, { input, context }) => {
      const bound = bindings.get(context);
      if (!bound || bound.requestId !== input.requestId || bound.approvalDigest !== input.approvalDigest) return false;
      return authority.authorize(client, context);
    } });
  const running = new Set();

  const contextFor = (userId, sessionId, importId) => Object.freeze({ actor: Object.freeze({ type: 'HUMAN', id: userId }), sessionId, planId: importId, fence: 1 });
  const commandFor = (row, mappingDigest) => ({ requestId: 'pt2030:' + sha({ importId: row.importId, externalIdentifier: row.externalIdentifier, contentDigest: row.contentDigest }),
    candidateId: 'pt2030:' + row.revisionId, snapshot: row.snapshot, mappingDigest, expected: row.accepted || null });

  async function classify(userId, sessionId, importId, loaded) {
    const context = contextFor(userId, sessionId, importId), rows = [];
    for (const row of loaded.rows) {
      const base = { physicalRow: row.physicalRow, externalIdentifier: row.externalIdentifier, title: row.snapshot?.description?.title?.value ?? null };
      if (row.errors?.length || !row.revisionId) { rows.push({ ...base, status: STATUS.REJECTED, errors: row.errors || [] }); continue; }
      const prepared = { ...row, importId };
      const cmd = commandFor(prepared, loaded.mappingDigest);
      let preview;
      try { preview = await accepted.preview(cmd, context); }
      catch (error) {
        // Losing authority is not a reason to review one row: the whole request stops.
        if (error?.code === 'OPPORTUNITY_V2_AUTHORITY_DENIED') throw error;
        rows.push({ ...base, status: STATUS.NEEDS_REVIEW, code: publicCode(error) }); continue;
      }
      const action = preview.items?.[0]?.action;
      const reasons = (preview.items?.[0]?.reasonCodes || []).filter(code => typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)).slice(0, 8);
      rows.push({ ...base, status: ACTION_STATUS[action] || STATUS.NEEDS_REVIEW, action, reasons, contentDigest: row.contentDigest,
        ...(action === 'NEW' ? { previewDigest: preview.previewDigest, command: cmd } : {}) });
    }
    return rows;
  }
  const totals = rows => Object.fromEntries(Object.values(STATUS).map(status => [status, rows.filter(r => r.status === status).length]));
  const digestOf = (importId, mappingDigest, rows) => sha({ importId, mappingDigest, rows: rows.map(r => [r.externalIdentifier, r.status, r.contentDigest ?? null, r.previewDigest ?? null]) });
  const view = (importId, loaded, rows) => ({ importId, totalRows: rows.length, totals: totals(rows), batchDigest: digestOf(importId, loaded.mappingDigest, rows),
    rows: rows.map(r => ({ physicalRow: r.physicalRow, externalIdentifier: r.externalIdentifier, title: r.title, status: r.status,
      ...(r.action ? { action: r.action } : {}), ...(r.reasons?.length ? { reasons: r.reasons } : {}), ...(r.code ? { code: r.code } : {}), ...(r.errors ? { errors: r.errors } : {}) })) });

  function ids({ userId, sessionId, importId }) {
    if (!UUID.test(userId || '') || !UUID.test(importId || '') || typeof sessionId !== 'string' || !sessionId) fail('PT2030_IMPORT_INPUT_INVALID');
  }
  return Object.freeze({
    async review(input) {
      ids(input);
      const loaded = await readImport(input);
      return view(input.importId, loaded, await classify(input.userId, input.sessionId, input.importId, loaded));
    },
    async accept(input) {
      ids(input);
      if (!SHA.test(input.batchDigest || '')) fail('PT2030_IMPORT_INPUT_INVALID');
      if (running.has(input.importId)) fail('PT2030_IMPORT_BUSY');
      running.add(input.importId);
      try {
        const loaded = await readImport(input);
        const rows = await classify(input.userId, input.sessionId, input.importId, loaded);
        // The administrator approved what the review showed. If anything under it changed, nothing is written.
        if (digestOf(input.importId, loaded.mappingDigest, rows) !== input.batchDigest) fail('PT2030_BATCH_STALE');
        const result = { importId: input.importId, requested: 0, created: 0, failed: [], skipped: { alreadyAccepted: 0, needsReview: 0, rejected: 0 } };
        for (const row of rows) {
          if (row.status === STATUS.ALREADY_ACCEPTED) { result.skipped.alreadyAccepted++; continue; }
          if (row.status === STATUS.NEEDS_REVIEW) { result.skipped.needsReview++; continue; }
          if (row.status === STATUS.REJECTED) { result.skipped.rejected++; continue; }
          result.requested++;
          const context = contextFor(input.userId, input.sessionId, input.importId);
          bindings.set(context, { requestId: row.command.requestId, approvalDigest: row.previewDigest });
          try {
            const saved = await accepted.accept({ ...row.command, approvalDigest: row.previewDigest }, context);
            if (saved?.action === 'CREATED') result.created++; else result.skipped.alreadyAccepted++;
          } catch (error) { result.failed.push({ physicalRow: row.physicalRow, externalIdentifier: row.externalIdentifier, code: publicCode(error) }); }
          finally { bindings.delete(context); }
        }
        return Object.freeze(result);
      } finally { running.delete(input.importId); }
    }
  });
}

module.exports = { createPortugal2030CatalogAcceptance, STATUS };
