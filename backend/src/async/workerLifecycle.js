'use strict';

const drainingError=()=>Object.assign(new Error('WORKER_DRAINING'),{code:'WORKER_DRAINING'});

class WorkerLifecycle {
  constructor({queue,run,graceMs=30000,forcedCancelMs=5000,telemetry=null,telemetryPort=null}){
    if(!queue||typeof queue.shutdown!=='function'||typeof run!=='function'||!Number.isInteger(graceMs)||graceMs<0
      ||!Number.isInteger(forcedCancelMs)||forcedCancelMs<0)throw new TypeError('Worker lifecycle configuration is invalid.');
    this.queue=queue;this.run=run;this.graceMs=graceMs;this.forcedCancelMs=forcedCancelMs;this.telemetry=telemetry;
    this.telemetryPort=telemetryPort;this.controller=new AbortController();this.admissionController=new AbortController();
    this.pending=new Set();this.state='ACCEPTING';this.shutdownPromise=null;
  }
  accepting(){return this.state==='ACCEPTING'&&!this.admissionController.signal.aborted;}
  track(promise){const p=Promise.resolve(promise);this.pending.add(p);p.finally(()=>this.pending.delete(p)).catch(()=>{});return p;}
  async start(){if(!this.accepting())throw drainingError();return this.run({signal:this.admissionController.signal,track:p=>this.track(p)});}
  async execute(envelope,effect,delivery={}){
    if(!this.accepting()||this.controller.signal.aborted)throw drainingError();
    const run=async()=>{try{const value=await effect({signal:this.controller.signal});try{this.telemetryPort?.record('F9',1,{jobType:envelope.jobType,result:'SUCCESS',errorClass:'none',queueClass:'functional',workerRole:'worker'});}catch{}return value;}catch(error){try{this.telemetryPort?.record('F9',1,{jobType:envelope.jobType,result:'RETRYABLE',errorClass:error?.code==='WORKER_DRAINING'?'cancelled':'internal',queueClass:'functional',workerRole:'worker'});}catch{}throw error;}};
    const operation=this.telemetry?this.telemetry.run({name:'process async_job',kind:4,envelope,...delivery},run):run();
    return this.track(operation);
  }
  async waitForDrain(timeoutMs){
    const drain=(async()=>{while(this.pending.size){await Promise.race([...this.pending].map(item=>item.catch(()=>undefined)));}return true;})();
    if(timeoutMs===0)return this.pending.size===0;
    let timer;const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);});
    try{return await Promise.race([drain,deadline]);}finally{clearTimeout(timer);}
  }
  async shutdown(){
    if(this.shutdownPromise)return this.shutdownPromise;
    this.shutdownPromise=(async()=>{
      this.state='DRAINING';this.admissionController.abort(drainingError());
      let mode='GRACEFUL',drained=await this.waitForDrain(this.graceMs);
      if(!drained){mode='FORCED';this.controller.abort(drainingError());drained=await this.waitForDrain(this.forcedCancelMs);}
      await this.queue.shutdown();this.state='STOPPED';
      return Object.freeze({mode,errorCode:drained?null:'WORKER_SHUTDOWN_INCOMPLETE',pending:this.pending.size});
    })();
    return this.shutdownPromise;
  }
}
module.exports={WorkerLifecycle};
