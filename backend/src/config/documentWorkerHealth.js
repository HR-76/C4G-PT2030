'use strict';
const http=require('node:http');
async function startWorkerHealth({port,check}){
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('DOCUMENT_WORKER_HEALTH_PORT_INVALID');
 const server=http.createServer((req,res)=>{if(req.method!=='GET'||req.url!=='/health/ready'){res.writeHead(404);res.end();return;}let ready=false;try{ready=check()?.ready===true;}catch{ready=false;}res.writeHead(ready?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ready}));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 let stopping;return Object.freeze({close(){return stopping||=(async()=>{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));})();}});
}
module.exports={startWorkerHealth};
