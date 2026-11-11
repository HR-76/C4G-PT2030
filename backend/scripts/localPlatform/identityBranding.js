'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {folder}=require('./config');
// Explicit local operation: never called by startup and never writes credentials or authentication policy.
async function applyBranding({admin,state,backup=()=>{}}){
 const {realm,issuer,origin}=state.identity||{};
 if(!/^c4g-native-[a-z0-9-]+$/.test(realm||'')||issuer!==`https://localhost:8443/realms/${realm}`||origin!=='http://localhost:3000')throw Error('LOCAL_IDENTITY_TARGET_INVALID');
 const current=await admin(realm);
 if(current.attributes?.['c4g.local.installation']!==state.installationId)throw Error('LOCAL_REALM_ALREADY_OWNED');
 const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
 const stable=value=>{const copy={...value};delete copy.loginTheme;delete copy.accountTheme;return createHash('sha256').update(JSON.stringify(normalize(copy))).digest('hex')};
 // Record only the reversible presentation settings. The realm response may contain secrets.
 await backup({realm,installationId:state.installationId,loginTheme:current.loginTheme||'',accountTheme:current.accountTheme||''});
 const changed=current.loginTheme!=='c4g'||current.accountTheme!=='c4g';
 if(changed)await admin(realm,'PUT',{loginTheme:'c4g',accountTheme:'c4g'});
 const after=await admin(realm);
 if(after.loginTheme!=='c4g'||after.accountTheme!=='c4g'||stable(current)!==stable(after))throw Error('LOCAL_IDENTITY_THEME_VERIFICATION_FAILED');
 return {changed,loginTheme:after.loginTheme,accountTheme:after.accountTheme,resetPasswordAllowed:after.resetPasswordAllowed===true};
}
async function main(){
 const state=JSON.parse(fs.readFileSync(path.join(folder,'runtime.json')));
 const admin=await require('./optionalIdentity').identityAdmin(require('./identity').identityConfig());
 const result=await applyBranding({admin,state,backup:async value=>{const file=path.join(folder,'identity-branding-backup.json');if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'})}});
 console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message||'')?e.message:'LOCAL_IDENTITY_THEME_FAILED');process.exitCode=1});
module.exports={applyBranding};
