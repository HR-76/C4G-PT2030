'use strict';

// PostgreSQL 18 also records column NOT NULL in pg_constraint. The same
// invariant is already fingerprinted through pg_attribute.attnotnull on 17/18.
// Noncanonical NOT NULL semantics must not disappear during normalization.
function canonicalConstraints(rows) {
  return rows.filter(row => {
    if (row.constraint_type !== 'n') return true;
    if (!/^NOT NULL [a-z_][a-z_0-9]*$/.test(row.definition)) {
      throw new Error('UNSUPPORTED_NOT_NULL_CONSTRAINT');
    }
    return false;
  });
}

const SUPPORTED_POSTGRES_MAJORS = Object.freeze([17, 18]);
module.exports = { canonicalConstraints, SUPPORTED_POSTGRES_MAJORS };
