'use strict';
// Regression-only loader: run the new safety-batch test against frozen A.
const path=require('node:path'),Module=require('node:module');
const root=process.env.AUDIT_AB_A_ROOT;
if(!root||!path.isAbsolute(root))throw Error('AUDIT_AB_A_ROOT_REQUIRED');
const original=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='../src/security/tenantSchemaFingerprint'&&parent?.filename?.endsWith('tenantSafetySnapshotBatch.test.js'))
  return original.call(this,path.join(root,'backend/src/security/tenantSchemaFingerprint.js'),parent,isMain);
 return original.apply(this,arguments);
};
