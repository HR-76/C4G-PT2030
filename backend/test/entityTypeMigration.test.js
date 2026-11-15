 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const migration=require('../src/security/centralMigrationManifest');
const {entry}=require('../src/security/entityTypeMigrationPackage');
test('entity type migration is an explicit pinned extension of 054',()=>{
 const source=migration.migrationSql(entry.version,'up');
 assert.equal(source.checksum,entry.upChecksum);
 assert.equal(migration.entityTypeManifest.at(-2).version,'054_billing_account_validation');
 assert.equal(migration.supportsCentralVersion(entry.version,'054_billing_account_validation'),true);
 assert.equal(migration.knownManifest.some(x=>x.version===entry.version),false);
 assert.throws(()=>migration.migrationSql(entry.version,'down'),/irreversible/);
 const query=require('../src/entityAdmission/registrationSql').changeType;
 assert.ok(source.sql.includes(createHash('sha256').update(query).digest('hex')));
 assert.ok(source.sql.includes(query.replaceAll("'","''")));
 assert.match(source.sql,/GRANT UPDATE\(type_code\) ON public.organization TO c4g_authority_owner/);
 assert.doesNotMatch(source.sql,/GRANT UPDATE[^;]+TO c4g_central_runtime/);
});
