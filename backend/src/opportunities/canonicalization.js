'use strict';
const { canonicalizeJcs1 } = require('../audit/canonicalJson');
function canonicalize(value) { return canonicalizeJcs1(value); }
module.exports = { canonicalize };
