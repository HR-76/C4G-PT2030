'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allowsInterestDependency:allows}=require('../src/security/interestAuthorityDependencies');
test('interest dependencies are restricted to exact operation, intention and resource type',()=>{
 const item=(operationCode,resourceType='OPPORTUNITY_INTEREST')=>({operationCode,resource:{resourceType}});
 for(const op of ['OPPORTUNITY_INTEREST_REGISTER','OPPORTUNITY_INTEREST_MANAGE'])assert(allows(op,null,item('OPPORTUNITY_INTEREST_READ')));
 for(const op of ['OPPORTUNITY_INTEREST_REGISTER','OPPORTUNITY_INTEREST_MANAGE'])assert(allows('OPPORTUNITY_INTEREST_READ',{operation:'INTEREST_UNIT_ASSIGN'},item(op)));
 for(const op of ['OPPORTUNITY_INTEREST_READ','OPPORTUNITY_INTEREST_MANAGE'])assert(allows('APPLICATION_CREATE',{operation:'APPLICATION_CREATE'},item(op)));
 assert(allows('APPLICATION_CREATE',{operation:'APPLICATION_CREATE'},item('APPLICATION_WORK_EDIT','APPLICATION')));
 assert(!allows('APPLICATION_READ',{operation:'APPLICATION_CREATE'},item('OPPORTUNITY_INTEREST_MANAGE')));
 assert(!allows('OPPORTUNITY_INTEREST_READ',null,item('OPPORTUNITY_INTEREST_REGISTER')));
 assert(!allows('OPPORTUNITY_INTEREST_REGISTER',null,item('OPPORTUNITY_INTEREST_READ','APPLICATION')));
 assert(!allows('APPLICATION_CREATE',null,item('APPLICATION_WORK_EDIT','APPLICATION')));
});
