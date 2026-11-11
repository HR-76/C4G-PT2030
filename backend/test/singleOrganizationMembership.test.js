'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const q=require('../src/platformOnboarding/sql');
const protocol=require('../src/security/authorityProtocolQueries');
const {manifest,migrationSql}=require('../src/security/centralMigrationManifest');

test('the onboarding protocol checks every non-removed membership for the identity',()=>{
 assert.match(q.nonRemovedMembership,/WHERE global_user_id=\$1/);
 assert.match(q.nonRemovedMembership,/PENDING_PROJECTION/);
 assert.match(q.nonRemovedMembership,/ACTIVE/);
 assert.match(q.nonRemovedMembership,/SUSPENDED/);
 assert.doesNotMatch(q.nonRemovedMembership,/organization_id=\$/);
 assert(protocol.queries.includes(q.nonRemovedMembership));
 for(const file of ['service.js','memberService.js']){
  const source=fs.readFileSync(path.resolve(__dirname,`../src/platformOnboarding/${file}`),'utf8');
  assert.match(source,/organization_membership_single_entity_uidx/);
  assert.match(source,/MEMBERSHIP_ALREADY_EXISTS/);
 }
});

test('migration 032 fails closed on existing conflicts and enforces one operational entity',()=>{
 const entry=manifest.find(item=>item.version==='032_single_organization_membership'),sql=migrationSql(entry.version,'up').sql;
 assert.equal(entry.version,'032_single_organization_membership');
 assert.match(sql,/SINGLE_MEMBERSHIP_EXISTING_CONFLICT/);
 assert.match(sql,/CREATE UNIQUE INDEX organization_membership_single_entity_uidx/);
 assert.match(sql,/WHERE status IN \('PENDING_PROJECTION','ACTIVE','SUSPENDED'\)/);
 const code=createHash('sha256').update(q.nonRemovedMembership).digest('hex');
 assert(sql.includes(code));
 assert.equal(fs.existsSync(path.resolve(__dirname,'../database/central/migrations/032_single_organization_membership.down.sql')),false);
});
