'use strict';
const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {fail}=require('./readErrors');
function createTokens(key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw new TypeError('Private 256-bit token key required');
 const secret=Buffer.from(key);
 return Object.freeze({
  seal(type,value){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(Buffer.from('gcni-read/1:'+type));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]).toString('base64url');},
  open(type,token){try{if(typeof token!=='string'||token.length>4096||!/^[A-Za-z0-9_-]+$/.test(token))throw Error();const raw=Buffer.from(token,'base64url');if(raw.toString('base64url')!==token||raw.length<29)throw Error();const decipher=createDecipheriv('aes-256-gcm',secret,raw.subarray(0,12));decipher.setAAD(Buffer.from('gcni-read/1:'+type));decipher.setAuthTag(raw.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));}catch{fail(type==='snapshot'?'INVALID_SNAPSHOT':'INVALID_CURSOR');}}
 });
}
module.exports={createTokens};
