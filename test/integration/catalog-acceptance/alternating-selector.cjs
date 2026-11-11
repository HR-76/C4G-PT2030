'use strict';
const assert=require('node:assert/strict');
function createSelector({core,reader,session,baselineReader}){
 let arm='BOTH',active=0;const counts={};
 const originalCore=core.centralSchemaSnapshot,originalReader=reader.admitReader,originalSession=session.coordinateSessionStore;
 async function track(kind,work){const selected=arm;active++;counts[selected+':'+kind]=(counts[selected+':'+kind]||0)+1;try{return await work(selected);}finally{active--;}}
 core.centralSchemaSnapshot=(client,options)=>track('core',selected=>{const next={...options};if(selected==='A'||selected==='C2')delete next.constraintVersion;if(next.constraintVersion!==undefined)counts[selected+':localVersion']=(counts[selected+':localVersion']||0)+1;return originalCore(client,next);});
 reader.admitReader=(...args)=>track('reader',selected=>{const old=selected==='A'||selected==='C1';const key=selected+':'+(old?'baselineReader':'combinedReader');counts[key]=(counts[key]||0)+1;return (old?baselineReader:originalReader)(...args);});
 session.coordinateSessionStore=(...args)=>{
  const store=originalSession(...args),touch=store.touch;
  store.touch=(...values)=>{active++;const callback=typeof values.at(-1)==='function'?values.pop():()=>{};let done=false;const finish=(...v)=>{if(done)return;done=true;active--;callback(...v);};try{return touch.call(store,...values,finish);}catch(error){finish(error);throw error;}};
  return store;
 };
 return {set(next){assert(['A','C1','C2','BOTH'].includes(next));assert.equal(active,0,'VARIANT_OPERATIONS_PENDING');arm=next;},get active(){return active;},get arm(){return arm;},counts:()=>({...counts}),restore(){assert.equal(active,0);core.centralSchemaSnapshot=originalCore;reader.admitReader=originalReader;session.coordinateSessionStore=originalSession;}};
}
function install(){
 const fs=require('node:fs'),crypto=require('node:crypto'),root=require('node:path').resolve(__dirname,'../../..');
 for(const [file,hash] of Object.entries(require('../../../backend/test/support/c1c2Rejected.json').sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require('node:path').join(root,file))).digest('hex'),hash,'HISTORICAL_COMPARATOR_RUNTIME_MISMATCH');
 assert.match(process.env.HTTP_PROOF_RUN||'',/^[a-f0-9]{32}$/);assert.equal(process.env.CATALOG_DURABLE_LOAD,'1');
 const path=require('node:path'),Module=require('node:module'),filename=path.resolve(__dirname,'../../../backend/src/opportunities/catalogRead/readSchema.js');
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(require('../../../backend/test/support/c1c2Baseline.json').readSchema,filename);
 return createSelector({core:require('../../../backend/src/security/centralSchemaManifest'),reader:require('../../../backend/src/opportunities/catalogRead/readSchema'),session:require('../../../backend/src/security/coordinatedSessionStore'),baselineReader:m.exports.admitReader});
}
module.exports={createSelector,install};
