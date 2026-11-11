'use strict';
// Application wiring only. The deployment supplies an admitted runtime and owns
// its dedicated credentials. This module never installs a package or opens a source.
function createCatalogReadConnection({mode='disabled',createRuntime}={}){
 if(!['disabled','controlled'].includes(mode))throw TypeError('INVALID_CATALOG_READ_RUNTIME');
 const deny=(req,res)=>res.status(503).set('Cache-Control','private, no-store').json({error:{code:'CATALOG_UNAVAILABLE'}});
 if(mode==='disabled')return Object.freeze({router:deny,ready:async()=>true,close:async()=>{}});
 if(typeof createRuntime!=='function')throw TypeError('CATALOG_RUNTIME_PROVIDER_REQUIRED');
 const runtime=createRuntime();
 if(runtime?.policyKind!=='durable'||typeof runtime.router!=='function'||typeof runtime.ready!=='function'||typeof runtime.close!=='function')throw TypeError('ADMITTED_DURABLE_CATALOG_RUNTIME_REQUIRED');
 let closed=false;
 return Object.freeze({router(req,res,next){return closed?deny(req,res):runtime.router(req,res,next);},
  async ready(){if(closed||await runtime.ready()!==true)throw Error('CATALOG_CONNECTION_NOT_READY');return true;},
  async close(){if(!closed){closed=true;await runtime.close();}}
 });
}
module.exports={createCatalogReadConnection};
