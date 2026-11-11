'use strict';
// Private provisioner journal. The encryption key belongs to the worker/vault,
// never the API. Immutable reservations survive worker restarts and lost replies.
const fs=require('node:fs/promises'),path=require('node:path'),{randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {uuid,hash,fail}=require('./contracts');
function createEncryptedJournal({directory,key}){
 if(!path.isAbsolute(directory)||!/^[a-f0-9]{64}$/.test(key||''))fail('PROVISIONING_JOURNAL_INVALID');
 const material=Buffer.from(key,'hex');
 async function load(id){uuid(id);const encoded=JSON.parse(await fs.readFile(path.join(directory,id+'.enc'),'utf8')),decipher=createDecipheriv('aes-256-gcm',material,Buffer.from(encoded.iv,'hex'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(encoded.tag,'hex'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encoded.data,'hex')),decipher.final()]).toString());}
 return {async get(id){return (await load(id)).value;},async reserve(id,intention,create){
  uuid(id);const filename=path.join(directory,id+'.enc'),digest=hash(JSON.stringify(intention));
  await fs.mkdir(directory,{recursive:true});
  async function read(){const encoded=JSON.parse(await fs.readFile(filename,'utf8')),decipher=createDecipheriv('aes-256-gcm',material,Buffer.from(encoded.iv,'hex'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(encoded.tag,'hex'));const stored=JSON.parse(Buffer.concat([decipher.update(Buffer.from(encoded.data,'hex')),decipher.final()]).toString());if(stored.digest!==digest)fail('PROVISIONING_INTENT_CONFLICT');return stored.value;}
  try{return await read();}catch(e){if(e.code!=='ENOENT')throw e;}
  const value=await create(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',material,iv);cipher.setAAD(Buffer.from(id));
  const data=Buffer.concat([cipher.update(JSON.stringify({digest,value})),cipher.final()]);
  // Unique temp file + hard link publishes a complete reservation without overwrite.
  const tmp=path.join(directory,id+'.'+randomBytes(8).toString('hex')+'.tmp');
  await fs.writeFile(tmp,JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')}),{flag:'wx',mode:0o600});
  try{await fs.link(tmp,filename);}catch(e){if(e.code!=='EEXIST')throw e;}finally{await fs.unlink(tmp);}
  return read();
 }};
}
module.exports={createEncryptedJournal};
