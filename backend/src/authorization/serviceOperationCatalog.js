'use strict';
const {types:{isProxy}}=require('node:util');
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/;const PERMISSION=/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;const JOB=/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
function exact(value,keys){return value&&typeof value==='object'&&!isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function createServiceOperationCatalog(configuration,{operationCatalog,permissionCatalog}){
 if(!exact(configuration,['version','bindings'])||typeof configuration.version!=='string'||!Array.isArray(configuration.bindings)||!Object.isFrozen(configuration.bindings)||!operationCatalog||!permissionCatalog)throw new TypeError('Service operation catalog configuration is invalid.');
 const byOperation=new Map();
 for(const binding of configuration.bindings){if(!exact(binding,['operationCode','permission','serviceActorCode','jobType'])||!Object.isFrozen(binding)||!CODE.test(binding.operationCode)||!PERMISSION.test(binding.permission)||!CODE.test(binding.serviceActorCode)||!JOB.test(binding.jobType)||byOperation.has(binding.operationCode))throw new TypeError('Service operation binding is invalid.');const operation=operationCatalog.resolve(binding.operationCode),permission=permissionCatalog.resolve(binding.permission);if(!operation||!permission||operation.permission!==binding.permission||permission.sensitive||permission.sodRule!==null)throw new TypeError('Service operation authorization binding is inconsistent.');byOperation.set(binding.operationCode,binding);}
 return Object.freeze({version:configuration.version,bindings:Object.freeze([...byOperation.values()]),resolve:code=>byOperation.get(code)||null});
}
module.exports={createServiceOperationCatalog};
