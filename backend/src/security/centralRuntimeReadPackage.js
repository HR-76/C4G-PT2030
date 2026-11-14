'use strict';
// Central package 052: SELECT-only projections for c4g_central_runtime (G1 restrito, 14/11/2026).
// Explicit installation only, after 051. Fingerprints are measured on a disposable PostgreSQL 18:
// the schema pin is the state without staging runtime-login memberships; the staging variant is admitted separately.
const previous = require('./emailTemplateMigrationPackage').entry;
const PACKAGE_ID = 'central-runtime-read-v1';
const CENTRAL_BASELINE = previous.version;
const entry = Object.freeze({
  ...previous,
  version: '052_central_runtime_read',
  file: 'central_runtime_read.up.sql',
  irreversible: false,
  requiresPreflightVersion: CENTRAL_BASELINE,
  upChecksum: '99fc2f2db65c55393d6a2fe4f59990190bbc46cd1c3e30b35a84437b26caac0c',
  schemaFingerprint: 'e1fdad20bc1643dc53bbfb0f3375650b7d852a2f66911510520ebfb07304d3ea',
  authoritySecurityFingerprint: '3b9dc6271c8459522efd219f1a6d985214b9394ccbc6a6318a9aac2c964a0309'
});
module.exports = { PACKAGE_ID, CENTRAL_BASELINE, entry };
