'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
function createProfiler(){
 const storage=new AsyncLocalStorage();
 return Object.freeze({
  middleware(req,res,next){storage.run({start:performance.now(),auth:0,membership:0,controls:0,read:0},next);},
  enter(){const s=storage.getStore();if(s)s.auth=performance.now()-s.start;},
  observe(phase,ms){const s=storage.getStore();if(s&&['membership','controls','read'].includes(phase)&&Number.isFinite(ms)&&ms>=0)s[phase]+=ms;},
  header(){const s=storage.getStore();return s?['auth','membership','controls','read'].map(k=>`${k};dur=${s[k].toFixed(3)}`).join(','):'';}
 });
}
module.exports={createProfiler};
