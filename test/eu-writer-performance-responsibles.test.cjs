'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {readResponsibleDirectory}=require('../backend/src/applications/composition');
function fixture(){
 const org=randomUUID(),active=randomUUID(),inactive=randomUUID(),foreign=randomUUID(),events=[];
 const ids=[active,inactive].sort(),names=new Map([[active,'Active responsible'],[inactive,'Historical responsible']]);let current=true;
 const client={async query(sql,values){events.push('tenant');assert.match(sql,/^SELECT DISTINCT responsible_membership_id FROM opportunity_catalog\.application WHERE organization_id=\$1 ORDER BY responsible_membership_id LIMIT 10001$/);assert.deepEqual(values,[org]);return {rows:ids.map(id=>({responsible_membership_id:id})),rowCount:ids.length};}};
 const responsibles={async names(input){events.push('authority');assert.deepEqual(input,ids);return names;}};
 const options={client,organizationId:org,responsibles,assertCurrent(){events.push('guard');if(!current)throw Error('MEMBERSHIP_REVOKED');}};
 return {org,active,inactive,foreign,ids,names,events,options,revoke(){current=false}};
}
test('real application composition resolves used active and historical names through the existing closed port',async()=>{
 const f=fixture(),result=await readResponsibleDirectory(f.options);
 assert.equal(result.get(f.active),'Active responsible');assert.equal(result.get(f.inactive),'Historical responsible');assert.equal(result.has(f.foreign),false);
 assert.deepEqual(f.events,['guard','tenant','guard','authority','guard']);
});
test('responsible directory revalidates membership before SQL and after the awaited authority observation',async()=>{
 const a=fixture();a.revoke();await assert.rejects(readResponsibleDirectory(a.options),/MEMBERSHIP_REVOKED/);assert.deepEqual(a.events,['guard']);
 const b=fixture();b.options.responsibles.names=async()=>{b.events.push('authority');b.revoke();return b.names;};await assert.rejects(readResponsibleDirectory(b.options),/MEMBERSHIP_REVOKED/);assert.equal(b.events.at(-1),'guard');
 const c=fixture();const original=c.options.client.query;c.options.client.query=async(...args)=>{const rows=await original(...args);c.revoke();return rows;};await assert.rejects(readResponsibleDirectory(c.options),/MEMBERSHIP_REVOKED/);assert(!c.events.includes('authority'));
});
test('directory cap fails closed before Central reads and exact 10000 remains supported',async()=>{
 const f=fixture(),ids=Array.from({length:10001},()=>randomUUID()).sort();let authority=0;
 f.options.client.query=async()=>({rows:ids.map(id=>({responsible_membership_id:id})),rowCount:ids.length});f.options.responsibles.names=async values=>{authority++;assert.equal(values.length,10000);return new Map();};
 await assert.rejects(readResponsibleDirectory(f.options),{code:'LIMIT_EXCEEDED'});assert.equal(authority,0);
 ids.pop();assert.deepEqual(await readResponsibleDirectory(f.options),new Map());assert.equal(authority,1);
});
test('malformed or foreign authority output and observation failures never become a successful empty directory',async()=>{
 const foreign=fixture();foreign.options.responsibles.names=async()=>new Map([[foreign.foreign,'Not tenant data']]);await assert.rejects(readResponsibleDirectory(foreign.options),{code:'SERVICE_UNAVAILABLE'});
 for(const outcome of [null,{},new Map([[randomUUID(),null]])]){const f=fixture();f.options.responsibles.names=async()=>outcome;await assert.rejects(readResponsibleDirectory(f.options));}
 const unavailable=fixture();unavailable.options.responsibles.names=async()=>{throw Error('AUTHORITY_UNAVAILABLE')};await assert.rejects(readResponsibleDirectory(unavailable.options),/AUTHORITY_UNAVAILABLE/);
 for(const rows of [{rows:[],rowCount:1},{rows:[{responsible_membership_id:'invalid'}],rowCount:1},{rows:null,rowCount:0}]){const f=fixture();f.options.client.query=async()=>rows;await assert.rejects(readResponsibleDirectory(f.options),{code:'SERVICE_UNAVAILABLE'});assert(!f.events.includes('authority'));}
});
