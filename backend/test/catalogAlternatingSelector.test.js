'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSelector}=require('../../test/integration/catalog-acceptance/alternating-selector.cjs');
test('alternating selector chooses independent C1/C2 paths and never retains an observed result',async()=>{
 const observed=[];const core={centralSchemaSnapshot:async(c,o)=>{observed.push(o.constraintVersion);return observed.length;}},reader={admitReader:async()=> 'new'},session={coordinateSessionStore:s=>s};
 const selector=createSelector({core,reader,session,baselineReader:async()=> 'old'});
 for(const [arm,version,expected] of [['A',undefined,'old'],['C1',18,'old'],['C2',undefined,'new'],['BOTH',18,'new']]){selector.set(arm);await core.centralSchemaSnapshot({}, {constraintVersion:18});assert.equal(observed.at(-1),version);assert.equal(await reader.admitReader({}),expected);}
 assert.equal(observed.length,4);selector.restore();
});
test('switch is refused while work or session callback is pending, including errors',async()=>{
 let release;const core={centralSchemaSnapshot:()=>new Promise(r=>release=r)},reader={admitReader:async()=>{}},session={coordinateSessionStore:s=>s};const selector=createSelector({core,reader,session,baselineReader:reader.admitReader});
 const p=core.centralSchemaSnapshot({},{});assert.throws(()=>selector.set('A'),/PENDING/);release();await p;selector.set('A');
 let callback;const store=session.coordinateSessionStore({touch(s,v,cb){callback=cb;}});store.touch('x',{},()=>{});assert.throws(()=>selector.set('C1'),/PENDING/);callback(Error('failed'));assert.equal(selector.active,0);selector.set('C1');selector.restore();
});
