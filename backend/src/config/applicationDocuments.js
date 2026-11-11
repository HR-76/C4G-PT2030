'use strict';
function required(env,name){const value=String(env[name]||'').trim();if(!value)throw new TypeError(`Document runtime configuration ${name} is required.`);return value}
function loadApplicationDocumentConfiguration(env=process.env){
 const endpoint=required(env,'C4G_R2_ENDPOINT');let parsed;try{parsed=new URL(endpoint)}catch{throw new TypeError('Document R2 endpoint is invalid.')}
 if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.eu.r2.cloudflarestorage.com')||parsed.pathname!=='/'||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.port)throw new TypeError('Document R2 endpoint must be the EU jurisdiction endpoint.');
 const documentsBucket=required(env,'C4G_R2_DOCUMENTS_BUCKET'),quarantineBucket=required(env,'C4G_R2_QUARANTINE_BUCKET');if(documentsBucket===quarantineBucket)throw new TypeError('Document buckets must be distinct.');
 const host=required(env,'C4G_CLAMAV_HOST'),port=Number(required(env,'C4G_CLAMAV_PORT'));if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw new TypeError('Document scanner must use a valid loopback endpoint.');
 return Object.freeze({r2:Object.freeze({enabled:true,jurisdiction:'eu',endpoint:parsed.origin,documentsBucket,quarantineBucket,bucketAccess:'PRIVATE',capabilities:Object.freeze({layerCValidated:env.C4G_R2_LAYER_C_VALIDATED==='true',multipartConditionalValidated:env.C4G_R2_MULTIPART_CONDITIONAL_VALIDATED==='true'})}),credentials:Object.freeze({accessKeyId:required(env,'C4G_R2_ACCESS_KEY_ID'),secretAccessKey:required(env,'C4G_R2_SECRET_ACCESS_KEY')}),scanner:Object.freeze({host,port})});
}
module.exports={loadApplicationDocumentConfiguration};
