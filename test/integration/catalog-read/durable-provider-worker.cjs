 'use strict';
const fs=require('node:fs');
const {Pool}=require('../../../backend/node_modules/pg');
(async()=>{let runtime;try{
 const input=JSON.parse(fs.readFileSync(0,'utf8'));
 runtime=require('../../../backend/src/opportunities/catalogRead/isolatedDurableProvider').createIsolatedDurableReaderProvider({...input,key:Buffer.from(input.key,'hex'),Pool,express:require('../../../backend/node_modules/express')})();
 await runtime.ready();process.stdout.write(JSON.stringify({ready:true,mode:runtime.mode}));
 }catch(e){process.stdout.write(JSON.stringify({ready:false,reason:e.reason,code:e.databaseCode}));process.exitCode=1;}finally{if(runtime)await runtime.close();}})().catch(()=>{process.exitCode=1;});
