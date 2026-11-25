'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const version='058_platform_account_lifecycle';
test('account lifecycle is a distinct pinned irreversible package after immutable 057',()=>{
 const m=require('../src/security/centralMigrationManifest'),pkg=require('../src/security/platformAccountLifecycleMigrationPackage');
 assert.equal(pkg.PACKAGE_ID,'platform-account-lifecycle-v1');
 assert.equal(pkg.CENTRAL_BASELINE,'057_production_central_permissions');
 assert.equal(pkg.entry.version,version);assert.equal(pkg.entry.irreversible,true);
 assert.equal(pkg.entry.productionPermissions,true);
 assert.equal(pkg.entry.requiresCatalogSecurityFingerprint,m.productionCentralManifest.at(-1).catalogSecurityFingerprint);
 assert.deepEqual(m.platformAccountLifecycleManifest.slice(0,-1),m.productionCentralManifest);
 assert.equal(m.platformAccountLifecycleManifest.at(-1),pkg.entry);
 assert.equal(m.productionCentralManifest.at(-1).upChecksum,'9ed39c76da6261753f0bfce22bb90b713bb499fa2b2e46e6ca85e766527b17a2');
 assert.equal(m.migrationSql(version,'up').checksum,pkg.entry.upChecksum);
 assert.throws(()=>m.migrationSql(version,'down'),/irreversible/);
 assert.equal(m.supportsCentralVersion(version,'057_production_central_permissions'),true);
 assert.equal(m.supportsCentralVersion('057_production_central_permissions',version),false);
 assert.equal(m.allKnownMigrations.filter(e=>e.version===version).length,1);
});
test('058 includes only the existing closed invitation and deletion protocol statements',()=>{
 const sql=require('../src/security/centralMigrationManifest').migrationSql(version,'up').sql;
 const queries=[require('../src/platformOnboarding/memberSql').emailDelivery,...Object.values(require('../src/platformDirectory/deletionSql'))];
 for(const query of queries){
  const digest=createHash('sha256').update(query).digest('hex');
  assert.ok(sql.includes(`WHEN '${digest}' THEN statement:='${query.replaceAll("'","''")}';`));
 }
 assert.equal((sql.match(/ WHEN '[a-f0-9]{64}' THEN/g)||[]).length,queries.length);
 assert.doesNotMatch(sql,/GRANT\s+[^;]*\bTO\s+(?:PUBLIC|c4g_prod_|c4g_authority_runtime)/i);
 for(const file of ['member_email_delivery','platform_user_deletion']){
  const candidate=fs.readFileSync(path.join(__dirname,`../database/central/candidates/${file}.up.sql`),'utf8').replace(/\r\n/g,'\n').trim();
  assert.ok(sql.includes(candidate),'preserve the reviewed candidate SQL verbatim');
 }
});
test('058 is part of the exact ledger branch and refuses tampering, gaps and unknown packages',async()=>{
 const m=require('../src/security/centralMigrationManifest'),runner=require('../scripts/runCentralMigrations');
 const rows=m.requiredCentralMigrations(m.platformAccountLifecycleManifest).map(e=>({version:e.version,checksum_sha256:e.checksum,irreversible:e.irreversible}));
 assert.equal(runner.validateAppliedMigrationLedger(rows).size,rows.length);
 assert.throws(()=>runner.validateAppliedMigrationLedger(rows.filter(e=>e.version!=='057_production_central_permissions')),/gap/);
 assert.throws(()=>runner.validateAppliedMigrationLedger(rows.map(e=>e.version===version?{...e,checksum_sha256:'0'.repeat(64)}:e)),/differs/);
 await assert.rejects(runner.applyRegisteredPlatformAccountLifecyclePackage(null,'unknown'),/PLATFORM_ACCOUNT_LIFECYCLE_PACKAGE_REQUIRED/);
});
