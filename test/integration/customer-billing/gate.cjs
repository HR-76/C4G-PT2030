'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),net=require('node:net');
const root=path.resolve(__dirname,'../../..'),bin='C:/Program Files/PostgreSQL/18/bin',base=path.join(root,'.tmp','billing-pdf-pg-'+Date.now());
const run=(name,args)=>execFileSync(path.join(bin,name+'.exe'),args,{windowsHide:true,stdio:'ignore',timeout:120000});
(async()=>{fs.mkdirSync(base,{recursive:true});const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});let started=false;try{
 run('initdb',['-D',path.join(base,'data'),'-U','c4g_f12_admin','-A','trust','--encoding=UTF8','--locale=C']);
 run('pg_ctl',['-D',path.join(base,'data'),'-l',path.join(base,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
 const {Pool}=require('../../../backend/node_modules/pg'),pool=new Pool({host:'127.0.0.1',port,user:'c4g_f12_admin',database:'postgres'});
 try{await require('./probe.cjs').run({pool,base,port})}finally{await pool.end()}
 console.log(JSON.stringify({pass:true,evidence:base}));
}finally{if(started&&fs.existsSync(path.join(base,'data','postmaster.pid')))run('pg_ctl',['-D',path.join(base,'data'),'-m','fast','-w','stop'])}})().catch(error=>{console.error(error.stack);process.exitCode=1});
