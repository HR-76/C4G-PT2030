'use strict';

// Writes a reviewable localization JSON to stdout. No remote calls or secrets.
// Usage: node backend/scripts/staging/preparePasswordResetEmail.js [template.json]
const fs = require('node:fs');
const { compilePasswordReset } = require('../../src/emailTemplates/keycloakPasswordReset');

try {
  if (process.argv.length > 3) throw new Error('INVALID_INPUT');
  let input;
  if (process.argv[2]) {
    if (fs.statSync(process.argv[2]).size > 100000) throw new Error('INVALID_INPUT');
    input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'html,subject') throw new Error('INVALID_INPUT');
  }
  const result = compilePasswordReset(input);
  // Sanitized edits need review; do not silently export a different template.
  if (result.removed.length) throw new Error('SANITIZATION_REVIEW_REQUIRED');
  process.stdout.write(JSON.stringify(result.messages, null, 2) + '\n');
} catch {
  process.stderr.write('Não foi possível preparar o email. Verifique o ficheiro, as variáveis e o HTML permitido.\n');
  process.exitCode = 1;
}
