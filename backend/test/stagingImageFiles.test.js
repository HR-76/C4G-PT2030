'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Regression: the staging image did not contain context/references/opportunity-v2/evidence, which the catalogue listing reads
// at run time, so the Catálogo answered 503 on the VPS while it worked everywhere the repository is checked out.
test('the staging image carries the evidence folder the catalogue reads at run time', () => {
  const evidence = 'context/references/opportunity-v2/evidence';
  for (const module of ['archivedDescription.js', 'presentation.js']) {
    assert.ok(read(`backend/src/opportunities/catalogRead/${module}`).includes(evidence), `${module} still reads ${evidence}`);
  }
  assert.ok(fs.statSync(path.join(root, evidence)).isDirectory());
  const dockerfile = read('deploy/staging/Dockerfile');
  assert.ok(dockerfile.includes(`COPY ${evidence} /app/${evidence}`), 'the Dockerfile copies it to the path the code resolves');
  assert.ok(dockerfile.includes(`RUN test -f /app/${evidence}/eu-11145.json`), 'the build fails if the copy did not arrive');
});

test('.dockerignore lets the evidence folder into the build context and keeps the rest of context out', () => {
  const lines = read('.dockerignore').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const at = pattern => lines.indexOf(pattern);
  assert.ok(!lines.includes('context'), 'a bare "context" would exclude the evidence folder too');
  // Each parent is excluded by its children pattern and the next level is re-included, in this order.
  const chain = ['context/*', '!context/references', 'context/references/*', '!context/references/opportunity-v2',
    'context/references/opportunity-v2/*', '!context/references/opportunity-v2/evidence'];
  chain.forEach(pattern => assert.ok(at(pattern) >= 0, pattern));
  assert.deepEqual([...chain].sort((a, b) => at(a) - at(b)), chain);
});
