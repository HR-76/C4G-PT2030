'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
module.exports=function manifest(build){
 const rows=[];
 function visit(file){
  if(fs.statSync(file).isDirectory())for(const name of fs.readdirSync(file).sort())visit(path.join(file,name));
  else rows.push({path:path.relative(root,file).replaceAll('\\','/'),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
 }
 for(const relative of ['backend/src','backend/database','frontend/src','backend/package-lock.json','frontend/package-lock.json','test/integration/page-performance'])visit(path.join(root,relative));
 visit(build);return rows;
};
