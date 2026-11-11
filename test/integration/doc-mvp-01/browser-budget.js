'use strict';
const crypto=require('node:crypto');
const http=require('node:http');
const {readDownload}=require('./download-response');
async function startBrowserEgressBlocker(){
 const server=http.createServer((req,res)=>{res.writeHead(403);res.end();});let blocked=0;
 server.on('connect',(req,socket)=>{blocked++;socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {proxy:{server:`http://127.0.0.1:${server.address().port}`,bypass:'localhost,127.0.0.1'},blocked:()=>blocked,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
// Chrome pauses every request (including redirect hops) before network dispatch.
// No URL, query string, headers or response body enters the evidence callback.
async function installBrowserBudget({context,page,budget,localOrigins,remoteOrigin,allowedPath,expectedBytes,expectedSha256,record=()=>{}}){
 const session=await context.newCDPSession(page),requests=new Map(),pending=new Set();
 const track=promise=>{pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});};
 session.on('Fetch.requestPaused',event=>track((async()=>{
  const url=new URL(event.request.url),remote=url.origin===remoteOrigin;
  try{
   if(!remote){
    if(!localOrigins.includes(url.origin)&&!['about:','data:','blob:'].includes(url.protocol))throw Error('BROWSER_ORIGIN_DENIED');
    await session.send('Fetch.continueRequest',{requestId:event.requestId});return;
   }
   if(event.request.method!=='GET'||!allowedPath(url.pathname)||!event.networkId)throw Error('BROWSER_SCOPE_DENIED');
   const id=crypto.randomUUID();
   await budget.call({action:'reserve',id,operation:'GetObject',bytes:expectedBytes});
   requests.set(event.networkId,{id,state:'RESERVED'});record({kind:'BROWSER_RESERVED',id});
   await budget.call({action:'STARTED',id});requests.get(event.networkId).state='STARTED';
   // Download-manager retries can bypass page Fetch interception. The browser's
   // external proxy therefore denies direct egress; only this bounded transport
   // may contact the approved origin. It never forwards cookies or authorization.
   record({kind:'BROWSER_TRANSPORT_STARTED',id});
   const response=await readDownload(url,{expectedBytes,expectedSha256,record:value=>record({...value,id})}),length=response.body.length;
   if(response.status>=300&&response.status<400)throw Error('BROWSER_REDIRECT_DENIED');
   await budget.call({action:'CONFIRMED',id});requests.get(event.networkId).state='CONFIRMED';
   record({kind:'BROWSER_TRANSPORT_COMPLETE',id,status:response.status,bytes:length});
   const headers=['content-type','content-disposition','cache-control'].flatMap(name=>response.headers[name]?[{name,value:response.headers[name]}]:[]);
   headers.push({name:'referrer-policy',value:'no-referrer'});
   await session.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:response.status,responseHeaders:headers,body:response.body.toString('base64')});
  }catch(error){const row=requests.get(event.networkId);if(row?.state==='STARTED'){row.state='UNCERTAIN';await budget.call({action:'UNCERTAIN',id:row.id}).catch(()=>{});}record({kind:'BROWSER_BLOCKED',code:/^[A-Z_]+$/.test(error.code||error.message)?error.code||error.message:'BROWSER_INTERCEPTION_FAILED'});await session.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
 })()));
 const finish=async(event,action)=>{const row=requests.get(event.requestId);if(!row||row.state!=='STARTED')return;row.state=action;await budget.call({action,id:row.id});};
 session.on('Network.responseReceived',event=>track((async()=>{const row=requests.get(event.requestId);if(!row)return;record({kind:'BROWSER_RESPONSE',id:row.id,status:event.response.status});await finish(event,'CONFIRMED');})()));
 session.on('Network.loadingFinished',event=>{const row=requests.get(event.requestId);if(row)record({kind:'BROWSER_LOADING_FINISHED',id:row.id});});
 session.on('Network.loadingFailed',event=>track((async()=>{const row=requests.get(event.requestId);if(!row)return;record({kind:'BROWSER_LOADING_FAILED',id:row.id,canceled:!!event.canceled});await finish(event,'UNCERTAIN');})()));
 await session.send('Network.enable');
 await session.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 return {async close(){await Promise.allSettled([...pending]);await session.detach();}};
}
module.exports={installBrowserBudget,startBrowserEgressBlocker};
