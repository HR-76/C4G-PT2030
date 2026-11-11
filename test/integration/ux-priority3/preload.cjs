'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
if(!['A','B'].includes(process.env.PAGE_VARIANT))throw Error('EXPLICIT_PAGE_VARIANT_REQUIRED');
if(process.env.PAGE_VARIANT==='A'){
 const root=path.resolve(__dirname,'../../..'),sources=new Map();
 for(const row of JSON.parse(fs.readFileSync(path.join(__dirname,'before/manifest.json')))){
  if(!row.path.startsWith('backend/src/'))continue;
  const bytes=fs.readFileSync(path.join(root,row.snapshot));
  if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('BASELINE_CHANGED');
  sources.set(path.resolve(root,row.path),bytes.toString('utf8'));
 }
 const original=Module._extensions['.js'];
 Module._extensions['.js']=(instance,filename)=>sources.has(filename)?instance._compile(sources.get(filename),filename):original(instance,filename);
}
