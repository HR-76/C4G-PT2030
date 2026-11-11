'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
async function bundle(){
 const root=path.resolve(__dirname,'../../../frontend');
 const source=`import React from 'react';import {createRoot} from 'react-dom/client';
 import api,{authApi} from './src/api/api';import {AuthProvider,useAuth} from './src/contexts/AuthContext';
 function Probe(){const auth=useAuth();window.proof={api,authApi,auth};return <output id="auth-state">{JSON.stringify({loading:auth.loading,user:auth.user?.id,organization:auth.organization?.id})}</output>}
 createRoot(document.getElementById('proof-root')).render(<AuthProvider><Probe/></AuthProvider>);`;
 const result=await require('../../../frontend/node_modules/esbuild').build({stdin:{contents:source,loader:'jsx',resolveDir:root},bundle:true,format:'esm',jsx:'automatic',write:false,define:{'import.meta.env.VITE_API_URL':'"/api"','process.env.NODE_ENV':'"production"'}});
 return result.outputFiles[0].text;
}
async function verify({client,origin,tenant,http,holds,events,check,report}){
 const page=client.page,org=tenant.organizationId;
 await page.waitForFunction(()=>window.proof?.auth&&!window.proof.auth.loading);
 const select=async()=>{await page.evaluate(id=>window.proof.auth.selectOrganization(id),org);await page.waitForFunction(id=>window.proof.auth.organization?.id===id,org);};
 let revalidationAttempts=0;
 await page.route('**/api/auth/session',route=>{revalidationAttempts++;return route.fulfill({status:503,contentType:'application/json',body:'{"code":"SERVICE_UNAVAILABLE"}'});});
 await select();assert.equal(revalidationAttempts,0,'POST must not require session GET');
 assert.equal(await page.evaluate(()=>window.proof.auth.organization.id),org);
 await page.evaluate(()=>window.proof.authApi.me().catch(()=>null));
 assert.equal(revalidationAttempts,1);assert.equal(await page.evaluate(()=>window.proof.auth.organization.id),org);
 await page.unroute('**/api/auth/session');check('actual AuthProvider applies POST despite failed optional session revalidation');
 const startIndex=events.length;
 // Rotate through an independent HTTP client sharing this browser cookie jar.
 assert.equal((await http(client,'/api/auth/organization','POST',{organizationId:org})).status,200);
 await select();
 const attempts=events.slice(startIndex).filter(e=>e.path==='/api/auth/organization'&&e.method==='POST');
 report.csrfRecoveryStatuses=attempts.map(e=>e.status);
 assert.deepEqual(attempts.map(e=>e.status),[200,403,200]);check('real CSRF_INVALID refreshes cached token and retries exactly once');
 const twiceStart=events.length;
 await page.route('**/api/auth/organization',route=>route.continue({headers:{...route.request().headers(),'x-csrf-token':'invalid-proof-token'}}));
 const rejected=await page.evaluate(id=>window.proof.authApi.selectOrganization(id).then(()=>false,()=>true),org);assert(rejected);
 await page.unroute('**/api/auth/organization');
 report.csrfDoubleRejectionStatuses=events.slice(twiceStart).filter(e=>e.path==='/api/auth/organization'&&e.method==='POST').map(e=>e.status);
 assert.deepEqual(report.csrfDoubleRejectionStatuses,[403,403]);
 check('second real CSRF rejection stops retries');
 for(const operation of ['organization','logout']){
  // Hold the response AFTER the real session route, leaving SQL/auth unchanged.
  await page.evaluate(()=>{window.heldRead=window.proof.api.get('/auth/session',{headers:{'X-HTTP-Proof-Hold':'1'}}).then(()=>null,e=>e.code);});
  const deadline=Date.now()+15000;while(!holds.size){if(Date.now()>deadline)throw Error('HELD_READ_NOT_STARTED');await new Promise(r=>setTimeout(r,20));}
  const start=performance.now();
  if(operation==='organization')await select();else await page.evaluate(()=>window.proof.authApi.logout());
  const elapsed=performance.now()-start;
  assert.equal(await page.evaluate(()=>window.heldRead),'ERR_CANCELED');assert(elapsed<9500,'rotation bounded below HTTP timeout');
  report.sessionRotations ||= [];report.sessionRotations.push({operation,heldReadCanceled:true,durationMs:Math.round(elapsed)});
  check('held real session GET canceled before '+operation+' POST');
 }
 assert.equal((await http(client,'/api/auth/session')).status,401);check('logout invalidates the real persisted session');
}
module.exports={bundle,verify};
