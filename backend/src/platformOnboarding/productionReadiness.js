'use strict';
// Production account operations require their registered extension. Historical
// staging variants keep their existing admission path and are not upgraded here.
function createProductionAccountReadiness({env,pool,assertSchema=(client,versions)=>require('../security/centralSchemaManifest').assertCentralSchemaForVersions(client,versions)}){
 if(env.CENTRAL_RUNTIME_PROFILE!=='production-v1')return async()=>{};
 const members=env.MEMBER_ONBOARDING_RUNTIME||'disabled',deletion=env.USER_DELETION_RUNTIME||'disabled';
 if(![members,deletion].every(value=>['disabled','central'].includes(value)))throw Error('PRODUCTION_ACCOUNT_RUNTIME_INVALID');
 if(deletion==='central'&&members!=='central')throw Error('PRODUCTION_DELETION_REQUIRES_MEMBER_RUNTIME');
 if(members!=='central')return async()=>{};
 return ()=>assertSchema(pool,['058_platform_account_lifecycle']);
}
module.exports={createProductionAccountReadiness};
