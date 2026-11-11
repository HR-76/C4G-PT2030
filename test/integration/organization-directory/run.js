'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../.tmp/organization-directory/c4g-directory-integration.json')));
assert.equal(config.host,'127.0.0.1');assert.equal(config.port,5567);assert.equal(config.database,'postgres');
const url=new URL('postgresql://127.0.0.1:5567/postgres');url.username=config.user;url.password=config.password;
process.env.F13_S2_ADMIN_URL=url.toString();process.env.F13_S2_DISPOSABLE_PROOF='C4G_F13_S2_DISPOSABLE_V1';process.env.DIRECTORY_SLICE_ONLY='1';
require('../c4g/runtime-gate');
