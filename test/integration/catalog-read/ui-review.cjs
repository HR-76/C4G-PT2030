// Test harness only: never imported by the application server.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const signature=require('../../../backend/node_modules/cookie-signature');
async function prepare({app,express,pool,secret,seedActor,mutation,directory,setClock}){
 const root=path.resolve(directory),dist=path.join(root,'dist');
 if(!fs.existsSync(path.join(dist,'catalog-isolated.html')))throw new Error('Missing owned UI build');
 const actor=await seedActor(pool);
 app.get('/__isolated/start',(req,res)=>{res.cookie('gcni-read-test','s:'+signature.sign(actor.sid,secret),{httpOnly:true,sameSite:'strict',path:'/'});res.redirect('/catalogo');});
 app.get('/api/auth/session',(req,res)=>req.sessionID===actor.sid?res.json({user:{id:actor.id,displayName:'Validação isolada'},organization:{id:actor.organizationId,displayName:'Instituição sintética'}}):res.status(401).json({error:{code:'SESSION_EXPIRED'}}));
 app.use(express.static(dist,{index:false,setHeaders:res=>res.set('Cache-Control','no-store')}));
 app.get(/^\/(catalogo(?:\/[^/]+)?|login)?$/,(req,res)=>res.sendFile(path.join(dist,'catalog-isolated.html')));
 return {async run(port){
  const ready=path.join(root,'ready.json'),command=path.join(root,'command.json'),ack=path.join(root,'ack.json');
  fs.writeFileSync(ready,JSON.stringify({url:`http://127.0.0.1:${port}/__isolated/start`}));
  let last;const deadline=Date.now()+900000;
  try{while(Date.now()<deadline){
   if(fs.existsSync(command)){const task=JSON.parse(fs.readFileSync(command,'utf8'));if(task.id!==last){last=task.id;
    if(task.action==='expire')setClock(Date.parse('2027-01-20T12:16:00Z'));
    else if(task.action==='reset-clock')setClock(Date.parse('2027-01-20T12:00:00Z'));
    else if(task.action==='revoke')await mutation(pool,actor,"UPDATE public.organization_membership SET status='SUSPENDED',suspended_at=clock_timestamp(),status_reason='UI isolated test',membership_version=membership_version+1 WHERE id=$1",[actor.membershipId]);
    else if(task.action==='unavailable')await pool.query('GRANT UPDATE ON catalog_read.revision_projection TO c4g_catalog_projection_reader');
    else if(task.action==='restore')await pool.query('REVOKE UPDATE ON catalog_read.revision_projection FROM c4g_catalog_projection_reader');
    else if(task.action!=='finish')throw new Error('Unknown review command');
    fs.writeFileSync(ack,JSON.stringify({id:last,action:task.action,status:'PASS'}));if(task.action==='finish')break;
   }}
   await new Promise(resolve=>setTimeout(resolve,200));
  }}finally{setClock(Date.parse('2027-01-20T12:00:00Z'));await pool.query('REVOKE UPDATE ON catalog_read.revision_projection FROM c4g_catalog_projection_reader');fs.writeFileSync(path.join(root,'closed.json'),JSON.stringify({closed:true}));}
 }};
}
module.exports={prepare};
