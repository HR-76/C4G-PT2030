'use strict';

// The production worker reads provider credentials from its private JSON, not
// from the API environment. Legacy callers without this field retain their env.
function memberWorkerEmailConfiguration(config,env){
 if(!Object.hasOwn(config,'email'))return {apiKey:env.RESEND_API_KEY,from:env.ACTIVATION_EMAIL_FROM,origin:env.ACTIVATION_PUBLIC_URL};
 const email=config.email;
 const invalid=()=>{throw new TypeError('MEMBER_EMAIL_CONFIGURATION_INVALID');};
 if(!email||typeof email!=='object'||Array.isArray(email)||Object.keys(email).sort().join(',')!=='apiKey,from,origin')invalid();
 if(['apiKey','from','origin'].some(key=>typeof email[key]!=='string'||!email[key]||email[key].length>4096||email[key]!==email[key].trim()||/[\u0000-\u001f\u007f]/.test(email[key])))invalid();
 let origin;try{origin=new URL(email.origin);}catch{invalid();}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.origin!==email.origin||(env.PUBLIC_APP_URL&&env.PUBLIC_APP_URL!==email.origin))invalid();
 return Object.freeze({apiKey:email.apiKey,from:email.from,origin:email.origin});
}
module.exports={memberWorkerEmailConfiguration};
