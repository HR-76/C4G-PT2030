'use strict';

async function stopWorkerCommand(processState,timeoutMs=10000){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new TypeError('Worker stop timeout is invalid.');
 if(!processState?.child||processState.child.exitCode!==null)return;
 const exited=new Promise(resolve=>processState.child.once('exit',resolve));
 processState.child.kill('SIGTERM');
 try{await Promise.race([exited,new Promise((resolve,reject)=>setTimeout(()=>reject(new Error('WORKER_STOP_TIMEOUT')),timeoutMs))]);}
 catch(error){processState.child.kill('SIGKILL');await exited;throw error;}
}

module.exports={stopWorkerCommand};
