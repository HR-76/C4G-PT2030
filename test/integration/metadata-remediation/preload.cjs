'use strict';
// Test-only frozen-source comparator. Never loaded by an application entrypoint.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
assert(['A','B'].includes(process.env.METADATA_VARIANT));
const root=path.resolve(__dirname,'../../..');
const sources=[['authoritySecurityManifest.js','authority.before.cjs.txt','d7d6f25f81da869b1c42d6e80ffa011086022e303cb54bd3d93947ac2554e6bc'],
 ['catalogMetadataTransport.js','transport.before.cjs.txt','f9f5b35beda9ddc390ba789e9d1ab78fc8a1dc038d4d2b78121af3db3b38e349'],
 ['centralSchemaManifest.js','core.before.cjs.txt','a4afa589387f5be9852c28b8a221b16b8a6be9b05bfa97f6569b1eb50434d61e']];
for(const [,file,hash] of sources)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex'),hash);
if(process.env.METADATA_VARIANT==='A'){
 const original=Module._extensions['.js'];
 Module._extensions['.js']=(module,filename)=>{
  const entry=sources.find(([name])=>filename===path.join(root,'backend/src/security',name));
  if(entry)return module._compile(fs.readFileSync(path.join(__dirname,entry[1]),'utf8'),filename);
  return original(module,filename);
 };
}
if(process.env.METADATA_PROOF==='1'){
 assert.equal(process.env.METADATA_VARIANT,'B');
 const fixture=require('../http-oidc/fixture');
 const original=fixture.databaseFixture;
 fixture.databaseFixture=async(...args)=>{
  const db=await original(...args);
  try{
   const result=await require('./proof.cjs').run(db.central);
   const report=process.env.HTTP_PROOF_REPORT;assert.match(report,/^[a-z0-9-]+$/);
   const folder=path.join(root,'context/reviews',report);fs.mkdirSync(folder,{recursive:true});
   fs.writeFileSync(path.join(folder,'metadata-proof.json'),JSON.stringify(result,null,2)+'\n');
   console.log('PASS metadata byte parity, drift and alternating microbenchmark');
   return db;
  }catch(error){await db.close();throw error;}
 };
}
