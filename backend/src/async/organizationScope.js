'use strict';

// Equality that still matches NULL to NULL (the Central funding job has no organization) but, unlike
// `column IS NOT DISTINCT FROM $n`, stays usable by a btree index: with a bound parameter the planner
// folds `$n IS NULL`, leaving `column = $n` (or `column IS NULL`).
const COLUMN = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;

function organizationScope(column, parameter) {
  if (typeof column !== 'string' || !COLUMN.test(column) || !Number.isInteger(parameter) || parameter < 1) {
    throw new TypeError('Organization scope predicate input is invalid.');
  }
  return `(${column} = $${parameter}::uuid OR (${column} IS NULL AND $${parameter}::uuid IS NULL))`;
}

module.exports = Object.freeze({ organizationScope });
