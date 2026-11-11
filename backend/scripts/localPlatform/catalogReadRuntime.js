 'use strict';
function catalogReadRuntimeEnvironment(state,controlledAdmission){
 const config=state.catalogRead;
 if(config!==undefined && (!config || typeof config!=='object' || Array.isArray(config) || Object.keys(config).some(k=>!['mode','firstAccess'].includes(k)) || !['disabled','controlled'].includes(config.mode) || (config.firstAccess!==undefined&&config.firstAccess!=='organization-administrator')))throw Error('CATALOG_READ_ACTIVATION_NOT_ADMITTED');
 if(config?.mode==='controlled'){if(!require('../../src/opportunities/catalogRead/controlledTarget').isControlledAdmission(controlledAdmission)||config.firstAccess!=='organization-administrator')throw Error('CATALOG_READ_ACTIVATION_NOT_ADMITTED');return Object.freeze({CATALOG_READ_RUNTIME:'controlled'});}
 return Object.freeze({CATALOG_READ_RUNTIME:'disabled'});
}
module.exports={catalogReadRuntimeEnvironment};
