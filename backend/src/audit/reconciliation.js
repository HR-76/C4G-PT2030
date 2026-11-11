const KINDS = Object.freeze(['AUDIT_INTENT_PENDING', 'AUDIT_APPEND_UNCERTAIN', 'AUDIT_CHAIN_GAP', 'AUDIT_CHECKPOINT_MISMATCH', 'AUDIT_DIGEST_MISMATCH', 'AUDIT_DELIVERY_LATE', 'AUDIT_PARTITION_MISSING']);
function classifyAuditReconciliation(item) {
  if (!item || !KINDS.includes(item.kind)) throw new TypeError('Audit reconciliation kind is invalid.');
  const automatic = ['AUDIT_INTENT_PENDING', 'AUDIT_APPEND_UNCERTAIN', 'AUDIT_DELIVERY_LATE'].includes(item.kind);
  return Object.freeze({ kind: item.kind, automatic, requiresAuthority: !automatic });
}
module.exports = { KINDS, classifyAuditReconciliation };
