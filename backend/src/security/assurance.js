function normalizeAmr(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
}

function buildAssuranceEvidence(claims, policyVersion) {
  return {
    authTime: Number.isFinite(claims.auth_time) ? claims.auth_time : null,
    acr: typeof claims.acr === "string" ? claims.acr : null,
    amr: normalizeAmr(claims.amr),
    policyVersion
  };
}

function hasMfa(evidence, requirement) {
  const acrAllowed = Boolean(evidence.acr && requirement.acceptedAcr.includes(evidence.acr));
  const amrAllowed = requirement.acceptedAmr.length > 0 && (requirement.amrMode === "all"
    ? requirement.acceptedAmr.every(value => evidence.amr.includes(value))
    : requirement.acceptedAmr.some(value => evidence.amr.includes(value)));
  return acrAllowed && amrAllowed;
}

function evaluateAssurance({ evidence, requirement, nowSeconds, expectedPolicyVersion }) {
  if (!requirement) return { allowed: false, reason: "AUTH_POLICY_UNKNOWN" };
  if (!evidence || !Number.isFinite(evidence.authTime)) return { allowed: false, reason: "AUTH_EVIDENCE_MISSING" };
  if (!expectedPolicyVersion || evidence.policyVersion !== expectedPolicyVersion) {
    return { allowed: false, reason: "AUTH_POLICY_VERSION_MISMATCH" };
  }
  const age = nowSeconds - evidence.authTime;
  if (age < 0 || age > requirement.maxAgeSeconds) return { allowed: false, reason: "AUTH_EVIDENCE_EXPIRED" };
  if (requirement.mfa && !hasMfa(evidence, requirement)) return { allowed: false, reason: "MFA_EVIDENCE_INSUFFICIENT" };
  return { allowed: true };
}

module.exports = { buildAssuranceEvidence, evaluateAssurance, hasMfa };
