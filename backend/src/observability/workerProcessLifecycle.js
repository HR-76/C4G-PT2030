'use strict';
function installProcessHandlers(runtime,{processLike=process,signals=['SIGINT','SIGTERM']}={}){
  if(!runtime||typeof runtime.shutdown!=='function')throw new TypeError('Worker runtime is invalid.');
  let installed=true,stopping=null;const handlers=new Map();
  const stop=()=>{if(stopping)return stopping;stopping=Promise.resolve(runtime.shutdown()).then(result=>{if(result?.errorCode)processLike.exitCode=1;return result;},()=>{processLike.exitCode=1;return {errorCode:'SHUTDOWN_FAILURE'};});return stopping;};
  for(const signal of signals){const handler=()=>{void stop();};handlers.set(signal,handler);processLike.on(signal,handler);}
  return Object.freeze({stop,uninstall(){if(!installed)return;installed=false;for(const [signal,handler] of handlers)processLike.removeListener(signal,handler);handlers.clear();}});
}
module.exports={installProcessHandlers};
