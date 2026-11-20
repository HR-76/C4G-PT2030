'use strict';
// Own local cluster only: deliberately no connection URL or target argument.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{execFileSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),bin='C:/Program Files/PostgreSQL/18/bin';
const mode=process.argv[2]||'full';if(!['full','fresh'].includes(mode))throw Error('ISOLATED_GATE_MODE_INVALID');
const base=path.join(root,'.tmp','production-bootstrap-'+mode+'-'+Date.now());
const run=(name,args)=>execFileSync(path.join(bin,name+'.exe'),args,{windowsHide:true,stdio:'ignore',timeout:120000});
async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
(async()=>{
 fs.mkdirSync(base,{recursive:true});
 const port=await freePort(),data=path.join(base,'data'),pwfile=path.join(base,'init-password'),password=randomBytes(32).toString('hex');let started=false;
 try{
  fs.writeFileSync(pwfile,password,{mode:0o600,flag:'wx'});
  run('initdb',['-D',data,'-U','bootstrap_admin','-A','scram-sha-256','--pwfile='+pwfile,'--encoding=UTF8','--locale=C']);
  fs.unlinkSync(pwfile);
  run('pg_ctl',['-D',data,'-l',path.join(base,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  const pool=new (require('../../../backend/node_modules/pg').Pool)({host:'127.0.0.1',port,user:'bootstrap_admin',password,database:'postgres',max:5});
  try{await require('./probe.cjs').run({pool,base,port,password,mode});}finally{await pool.end();}
  console.log(JSON.stringify({pass:true,mode,evidence:base}));
 }finally{
  if(fs.existsSync(pwfile))fs.unlinkSync(pwfile);
  if(started&&fs.existsSync(path.join(data,'postmaster.pid')))run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(!fs.existsSync(path.join(data,'postmaster.pid'))&&path.resolve(data)===path.join(path.resolve(base),'data')&&path.dirname(path.resolve(base))===path.join(root,'.tmp'))fs.rmSync(data,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
