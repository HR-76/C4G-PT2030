const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { manifest, migrationSql } = require('../src/security/centralMigrationManifest');

const root = path.resolve(__dirname, '..');
const upPath = path.join(root, 'database/central/migrations/003_f4_tenant_directory.up.sql');
const downPath = path.join(root, 'database/central/migrations/003_f4_tenant_directory.down.sql');

test('F4.1 migration is ordered, canonical and contains the contracted physical boundary', () => {
  assert.deepEqual(manifest.slice(0,4).map(x => x.version), ['000_central_identity_baseline','001_f2_oidc_sessions','002_f3_organization_memberships','003_f4_tenant_directory']);
  const up = fs.readFileSync(upPath, 'utf8'); const down = fs.readFileSync(downPath, 'utf8');
  assert.doesNotMatch(up, /\b(?:BEGIN|COMMIT)\s*;/i); assert.doesNotMatch(down, /\b(?:BEGIN|COMMIT)\s*;/i);
  for (const name of ['tenant','tenant_database_generation','organization_connection_version','organization_connection','tenant_schema_state','organization_provisioning','tenant_health_observation','tenant_directory_event']) assert.match(up, new RegExp(`CREATE TABLE public\\.${name}\\b`));
  assert.match(up, /current_step_code TEXT NOT NULL CHECK \(current_step_code ~ '\^\[A-Z\]\[A-Z0-9_\]\{0,63\}\$'\)/);
  assert.match(up, /database_ref TEXT NOT NULL CHECK \(database_ref ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,255\}\$'\)/);
  assert.match(up, /credential_ref TEXT NOT NULL CHECK \(credential_ref ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,255\}\$'\)/);
  assert.match(up, /Current connection version cannot leave VALIDATED in place/);
  assert.match(up, /current_connection_version=OLD\.connection_version[\s\S]*FOR UPDATE/);
  for (const token of ['MATCH SIMPLE','ON UPDATE RESTRICT','ON DELETE RESTRICT','NOT DEFERRABLE INITIALLY IMMEDIATE','append-only','write-once','DATABASE_PER_ORGANIZATION']) assert.match(up, new RegExp(token,'i'));
  assert.match(down,/rollback refused/i); assert.match(up,/C4G[\s\S]*CENTRAL/);
  assert.doesNotMatch(up,/professor|faculty|research_center|password|connection_string/i);
  assert.equal(migrationSql('003_f4_tenant_directory','up').sql.includes('\r\n'),false);
});

test('F4.1 repositories do not expose generic mutation or prohibited configuration', () => {
  const files=['tenantDirectoryRepository.js','tenantProvisioningRepository.js','tenantConnectionRepository.js','tenantSchemaRepository.js','tenantHealthRepository.js'];
  for(const file of files){const source=fs.readFileSync(path.join(root,'src/security',file),'utf8');assert.doesNotMatch(source,/DATABASE_URL|legacyPool|TenantResolver|secretManager/);}
  const factories=[require('../src/security/tenantDirectoryRepository').createTenantDirectoryRepository,require('../src/security/tenantProvisioningRepository').createTenantProvisioningRepository,require('../src/security/tenantConnectionRepository').createTenantConnectionRepository,require('../src/security/tenantSchemaRepository').createTenantSchemaRepository,require('../src/security/tenantHealthRepository').createTenantHealthRepository];
  for(const factory of factories){const repository=factory({query(){},connect(){}});for(const name of ['update','patch','setState','delete','transition','transitionConnection','transitionVersion'])assert.equal(repository[name],undefined);}
});

test('F4.1 lifecycle keeps READY before initial AVAILABLE in SQL and repository gates', () => {
  const up = fs.readFileSync(upPath, 'utf8');
  const repository = fs.readFileSync(path.join(root, 'src/security/tenantConnectionRepository.js'), 'utf8');
  assert.match(up, /NEW\.status='READY'[\s\S]*version_state='VALIDATED'[\s\S]*compatibility_state='COMPATIBLE'/);
  assert.doesNotMatch(up, /NEW\.status='READY'[\s\S]{0,600}operational_state='AVAILABLE'/);
  assert.match(up, /OLD\.operational_state='PENDING'[\s\S]*status='READY'[\s\S]*compatibility_state='COMPATIBLE'/);
  assert.match(repository, /organization_provisioning/);
  assert.match(repository, /tenant_schema_state/);
  assert.match(repository, /p\.status='READY'/);
  assert.match(repository, /s\.compatibility_state='COMPATIBLE'/);
});

test('F4.1 transaction matrix compares complete persisted rows and events', () => {
  const matrix = fs.readFileSync(path.resolve(root, '../test/integration/f4/transaction-state-matrix.js'), 'utf8');
  assert.match(matrix, /SELECT \* FROM tenant_directory_event/);
  assert.doesNotMatch(matrix, /domain:'SELECT (?!\*)/);
  assert.doesNotMatch(matrix, /const fields=\{/);
});
