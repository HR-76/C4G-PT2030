'use strict';
const PHASES=new Set(['membership','controls','read']);
function createPhaseTiming(observe){
 return async function timed(phase,work){
  if(typeof observe!=='function')return work();
  if(!PHASES.has(phase))throw TypeError('Unknown read phase');
  const start=performance.now();
  try{return await work();}finally{try{const result=observe(phase,performance.now()-start);result?.catch?.(()=>{});}catch{/* Diagnostics never replace the original outcome. */}}
 };
}
module.exports={createPhaseTiming};
