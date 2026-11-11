const phaseByCriterion = {
  1: "F2", 2: "F2", 3: "F2", 4: "F2", 5: "F3", 6: "F3", 7: "F5", 8: "F5",
  9: "F4", 10: "F4", 11: "F9", 12: "F7", 13: "F7", 14: "F9", 15: "F9",
  16: "F6", 17: "F6", 18: "F8", 19: "F8", 20: "F10", 21: "F10", 22: "F5", 23: "F10"
};

const secCoverageMatrix = Object.entries(phaseByCriterion).map(([number, phase]) => {
  const id = `SEC-AC-${number.padStart(2, "0")}`;
  if (["SEC-AC-01", "SEC-AC-02", "SEC-AC-03", "SEC-AC-04"].includes(id)) {
    return Object.freeze({
      id,
      phase,
      status: "partial",
      test: "test/security/f2Security.test.js",
      tests: Object.freeze([
        "test/security/f2Security.test.js",
        "test/security/oidcCryptographicValidation.test.js",
        "../test/integration/f2/gate.js"
      ]),
      note: `${id} has automated and disposable Keycloak/PostgreSQL/Chrome coverage; final review and target-environment rollout evidence remain required before promotion.`
    });
  }
  if (["SEC-AC-05", "SEC-AC-06"].includes(id)) {
    return Object.freeze({
      id,
      phase,
      status: "partial",
      test: "test/security/f3MembershipContext.test.js",
      tests: Object.freeze([
        "test/security/f3MembershipContext.test.js"
      ]),
      note: `${id} has automated repository, session lifecycle and HTTP-contract coverage; target-environment PostgreSQL rollout evidence remains required before promotion.`
    });
  }
  if (id === "SEC-AC-20") {
    return Object.freeze({ id, phase, status: "partial", test: "test/security/secAc20Baseline.test.js", tests: Object.freeze(["test/security/secAc20Baseline.test.js"]), note: "F1 covers only harness responses and logs; full telemetry coverage remains assigned to F10." });
  }
  return Object.freeze({ id, phase, status: "pending", test: null, tests: Object.freeze([]), note: `${id} remains pending for ${phase}; F1 provides no compliance claim.` });
});

module.exports = Object.freeze(secCoverageMatrix);
