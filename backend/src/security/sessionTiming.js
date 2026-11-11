"use strict";
function createTiming(observer){
 const record=(name,ms)=>{if(typeof observer!=="function")return;try{const p=observer(name,ms);p?.catch?.(()=>{});}catch{}};
 return {record,async measure(name,work){if(typeof observer!=="function")return work();const start=performance.now();try{return await work();}finally{record(name,performance.now()-start);}}};
}
module.exports={createTiming};
