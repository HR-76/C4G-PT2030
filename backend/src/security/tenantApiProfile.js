'use strict';

const MINIMAL_PROFILE='minimal-v1';
const PRODUCTION_EDITORIAL_PROFILE='production-editorial-v1';
const BASE_ROLES=Object.freeze(['c4g_opportunity_tenant_runtime','c4g_f4_metadata_executor']);

function apiFunctionalRoles({editorialEnabled=false,documentsEnabled=false}={}){
 if(typeof editorialEnabled!=='boolean'||typeof documentsEnabled!=='boolean')throw new TypeError('TENANT_API_PROFILE_INVALID');
 return Object.freeze([...BASE_ROLES,...(editorialEnabled?['c4g_organization_profile_runtime']:[]),...(documentsEnabled?['c4g_document_runtime']:[])]);
}
const PROFILES=Object.freeze({
 [MINIMAL_PROFILE]:Object.freeze({code:MINIMAL_PROFILE,editorialEnabled:false,functionalRoles:apiFunctionalRoles()}),
 [PRODUCTION_EDITORIAL_PROFILE]:Object.freeze({code:PRODUCTION_EDITORIAL_PROFILE,editorialEnabled:true,functionalRoles:apiFunctionalRoles({editorialEnabled:true})})
});
// Explicit private configuration, never inferred from observed grants. Existing
// callers retain the minimal profile; production must name the editorial profile.
function requireTenantApiProfile(code=MINIMAL_PROFILE){
 if(typeof code!=='string'||!Object.hasOwn(PROFILES,code))throw new TypeError('TENANT_API_PROFILE_INVALID');
 return PROFILES[code];
}
module.exports={MINIMAL_PROFILE,PRODUCTION_EDITORIAL_PROFILE,apiFunctionalRoles,requireTenantApiProfile};
