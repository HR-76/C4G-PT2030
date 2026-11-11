'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TABLES,RETAIN,validateTables,preserved}=require('../scripts/reset-local-catalog.cjs');
test('reset admits only the exact catalogue set and never security-control tables',()=>{
 const sql=validateTables([...TABLES,...RETAIN]);assert.equal(TABLES.length,37);
 for(const name of RETAIN)assert(!sql.includes(`"${name}"`));
 assert(!sql.includes('CASCADE'));assert(!sql.includes('public.'));assert(!sql.includes('application'));
 assert.throws(()=>validateTables([...TABLES,...RETAIN,'application']));
 assert.throws(()=>validateTables([...TABLES.slice(1),...RETAIN]));
});
test('preservation checks include security controls, audit and unrelated data',()=>{
 const data={'"opportunity_catalog"."opportunity"':{count:538},'"opportunity_catalog"."eu_legacy_prearchive_use_v1"':{count:391},'"audit"."event"':{count:1},'"public"."global_user"':{count:3}};
 const result=preserved(data);assert.equal(Object.keys(result).length,3);assert(result['"audit"."event"']);assert(result['"opportunity_catalog"."eu_legacy_prearchive_use_v1"']);
});
