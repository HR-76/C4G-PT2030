'use strict';
function observed(dependencies){
 const control={mode:null};
 const poolManager={...dependencies.poolManager,async acquire(request){const allocation=await dependencies.poolManager.acquire(request),client=allocation.client;let lose=false,pause=false,observation=false;
  return {...allocation,client:{on:(...a)=>client.on(...a),removeListener:(...a)=>client.removeListener(...a),async query(sql,values){
   if(sql==='BEGIN TRANSACTION READ ONLY')observation=true;
   if(sql.includes('audit.append_event_v1')&&['OPPORTUNITY_CRITERIA_REVISION_CREATED','OPPORTUNITY_CRITERIA_REVISION_CONFIRMED'].includes(values?.[2])){
    if(control.mode==='F7'){control.mode=null;throw Error('SYNTHETIC_F7_FAILURE');}
    if(control.mode==='COMMIT'){control.mode=null;lose=true;}
    if(control.mode==='PAUSE'){control.mode=null;pause=true;}
   }
   if(sql==='COMMIT'&&pause){control.reached();await control.barrier;}
   let result;try{result=await client.query(sql,values);}catch(e){console.error('CRITERIA_SQL_FAILURE',e.code,sql.slice(0,100));throw e;}
   // Release after the lookup has computed its result, before the HTTP session
   // touch waits for the source guard. This is synchronization, not a sleep.
   if(sql==='ROLLBACK'&&observation&&control.releaseOnObservation){control.releaseOnObservation=false;control.release();}
   if(sql==='COMMIT'&&lose){lose=false;throw Error('SYNTHETIC_COMMIT_ACK_LOST');}
   return result;
  }}};
 }};
 return {control,dependencies:{...dependencies,poolManager}};
}
module.exports={observed};
