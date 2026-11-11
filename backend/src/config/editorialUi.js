'use strict';
const {createEditorialUiTokens}=require('../organizationalProfile/editorialUiTokens');
function editorialUiConfiguration(env) {
  try {
    const tokenKeys=JSON.parse(env.PROFILE_EDITORIAL_UI_KEYS_JSON||'null');
    const tokenKeyId=env.PROFILE_EDITORIAL_UI_KEY_ID;
    if(!tokenKeys||Array.isArray(tokenKeys)||typeof tokenKeys!=='object')throw new Error();
    if(env.NODE_ENV==='production'&&Object.values(tokenKeys).some(key=>!require('../security/secretFormat').isSecretHex(key)))throw new Error();
    createEditorialUiTokens({keys:tokenKeys,currentKeyId:tokenKeyId});
    return {tokenKeys,tokenKeyId};
  } catch { throw Object.assign(new Error('EDITORIAL_UI_KEY_NOT_CONFIGURED'),{code:'EDITORIAL_UI_KEY_NOT_CONFIGURED'}); }
}
module.exports={editorialUiConfiguration};
