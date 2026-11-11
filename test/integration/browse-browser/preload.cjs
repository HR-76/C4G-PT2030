'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
if(!['A','B'].includes(process.env.PAGE_VARIANT))throw Error('EXPLICIT_PAGE_VARIANT_REQUIRED');
if(process.env.PAGE_VARIANT==='A'){
 const root=path.resolve(__dirname,'../../..'),filename=path.join(root,'backend/src/applications/browseSql.js');
 const bytes=fs.readFileSync(path.join(root,'context/reviews/browse-full-20261109/browseSql-before.js'));
 const expected=JSON.parse(fs.readFileSync(path.join(root,'context/reviews/browse-full-20261109/results.json'))).sourceHash;
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('BROWSE_BASELINE_CHANGED');
 const original=Module._extensions['.js'];Module._extensions['.js']=(instance,file)=>file===filename?instance._compile(bytes.toString('utf8'),file):original(instance,file);
}
