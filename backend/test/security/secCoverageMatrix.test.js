const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const matrix = require("./secCoverageMatrix");

test("SEC matrix contains exactly SEC-AC-01 through SEC-AC-23 once", () => {
  const expected = Array.from({ length: 23 }, (_, index) => `SEC-AC-${String(index + 1).padStart(2, "0")}`);
  assert.deepEqual(matrix.map(item => item.id).sort(), expected);
  assert.equal(new Set(matrix.map(item => item.id)).size, 23);
});

test("SEC matrix has valid phases, states, notes and coverage references", () => {
  const validPhases = new Set(Array.from({ length: 9 }, (_, index) => `F${index + 2}`));
  const validStates = new Set(["pending", "partial", "covered"]);
  for (const item of matrix) {
    assert.ok(validPhases.has(item.phase), `${item.id} has invalid phase`);
    assert.ok(validStates.has(item.status), `${item.id} has invalid state`);
    if (item.status === "pending") {
      assert.equal(item.test, null);
      assert.ok(item.note);
    } else {
      assert.ok(item.test);
      assert.ok(fs.existsSync(path.resolve(__dirname, "../..", item.test)), `${item.id} references a missing test`);
      assert.ok(Array.isArray(item.tests) && item.tests.length > 0);
      for (const evidence of item.tests) {
        assert.ok(fs.existsSync(path.resolve(__dirname, "../..", evidence)), `${item.id} references missing evidence ${evidence}`);
      }
    }
  }
});

test("F2 criteria remain partial until final review and target rollout evidence", () => {
  for (const id of ["SEC-AC-01", "SEC-AC-02", "SEC-AC-03", "SEC-AC-04"]) {
    const item = matrix.find(candidate => candidate.id === id);
    assert.equal(item.status, "partial");
    assert.equal(item.test, "test/security/f2Security.test.js");
    assert.ok(item.tests.includes("test/security/oidcCryptographicValidation.test.js"));
    assert.ok(item.tests.includes("../test/integration/f2/gate.js"));
    assert.match(item.note, /final review and target-environment rollout evidence remain required/i);
  }
});
