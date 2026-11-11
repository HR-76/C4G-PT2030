'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {applyBranding}=require('../scripts/localPlatform/identityBranding');
const state={installationId:'local-installation',identity:{realm:'c4g-native-test',issuer:'https://localhost:8443/realms/c4g-native-test',origin:'http://localhost:3000'}};
function fixture(){let value={loginTheme:'c4g',resetPasswordAllowed:false,registrationAllowed:false,attributes:{'c4g.local.installation':state.installationId,keep:'yes'},smtpServer:{password:'must-not-escape'}};const calls=[];return {calls,admin:async(route,method,body)=>{calls.push({route,method,body});if(method==='PUT')value={...value,...body};return structuredClone(value)}};}
test('only presentation settings are written and the backup contains no realm secrets',async()=>{
 const f=fixture(),backups=[];const result=await applyBranding({...f,state,backup:x=>backups.push(x)});
 assert.equal(result.changed,true);assert.equal(result.resetPasswordAllowed,false);
 assert.deepEqual(f.calls.filter(c=>c.method==='PUT'),[{route:'c4g-native-test',method:'PUT',body:{loginTheme:'c4g',accountTheme:'c4g'}}]);
 assert.deepEqual(backups,[{realm:'c4g-native-test',installationId:'local-installation',loginTheme:'c4g',accountTheme:''}]);
 assert.equal((await applyBranding({...f,state})).changed,false);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
});
test('refuses remote or unowned realms without mutation',async()=>{
 for(const candidate of [{...state,installationId:'other'},{...state,identity:{...state.identity,origin:'https://customer.invalid'}}]){const f=fixture();await assert.rejects(()=>applyBranding({...f,state:candidate}));assert.equal(f.calls.filter(c=>c.method==='PUT').length,0)}
});
test('detects changes in nested authentication settings during the operation',async()=>{
 const f=fixture();let reads=0;await assert.rejects(()=>applyBranding({state,admin:async(...args)=>{const value=await f.admin(...args);if(!args[1]&&++reads===2)value.attributes.keep='changed';return value}}),/LOCAL_IDENTITY_THEME_VERIFICATION_FAILED/);
});
