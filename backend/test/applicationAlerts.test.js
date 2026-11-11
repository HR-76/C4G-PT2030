'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse,milestone}=require('../src/applications/alerts');
test('deadline windows preserve pilot milestones and never generate after expiry',()=>{
 for(const [days,expected] of [[31,null],[30,30],[29,30],[28,30],[27,null],[8,null],[7,7],[6,7],[5,7],[4,null],[2,null],[1,1],[0,1],[-1,null],[null,null],[NaN,null]])assert.equal(milestone(days),expected,String(days));
});
test('inputs reject forged scope, recipients, filters and writes with caller metadata',()=>{
 for(const input of [{recipient:'other'},{organizationId:'other'},{unread:'1'},{limit:0},{limit:101},{limit:1.5},[],null])assert.throws(()=>parse('alertsList',input));
 for(const input of [{id:'other'},{is_read:true},{organizationId:'other'}])assert.throws(()=>parse('alertsRead',input));
 assert.deepEqual(parse('alertsList',{unread:'true',limit:'1'}),{unread:true,limit:1});
});
test('personal inbox has its own permission and never an implicit admin grant',()=>{
 const catalog=require('../src/authorization/productionAuthorization').validateProductionAuthorizationBootstrap();
 for(const action of ['READ','ACK','SYNC'])assert.equal(catalog.operationCatalog.resolve('NOTIFICATION_'+action).permission,'notification.read');
 assert.ok(catalog.profileCatalog.profiles.every(p=>!p.permissions.length));
});
