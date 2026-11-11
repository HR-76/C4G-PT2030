'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
module.exports=function install(){
 const root=path.resolve(__dirname,'../../..'),manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'before/manifest.json'))),restore=[];
 for(const [file,factory] of [['backend/src/organizationDirectory/composition.js','createDirectoryComposition'],['backend/src/applications/composition.js','createApplicationComposition']]){
  const entry=manifest.find(r=>r.path===file),bytes=fs.readFileSync(path.join(root,entry.snapshot));
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('BASELINE_CHANGED');
  const filename=path.join(root,file),historical=new Module(filename,module);historical.filename=filename;historical.paths=Module._nodeModulePaths(path.dirname(filename));historical._compile(bytes.toString('utf8'),filename);
  const current=require(filename),original=current[factory];restore.push(()=>{current[factory]=original});
  current[factory]=options=>{
   const a=historical.exports[factory](options),b=original(options);
   return {execute(...args){return (args.at(-1)?.headers?.['x-profile-baseline']==='1'?a:b).execute(...args)}};
  };
 }
 return ()=>restore.forEach(fn=>fn());
};
