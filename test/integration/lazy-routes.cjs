'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('../../backend/node_modules/express');
const {chromium} = require('../../frontend/test-harness/node_modules/playwright');
async function run() {
  const app=express(), root=path.resolve(__dirname,'../../frontend/dist');
  app.use(express.static(root)); app.use((req,res)=>res.sendFile(path.join(root,'index.html')));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
  let browser;
  try {
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const page=await browser.newPage(), chunks=[], errors=[];
    page.on('request',r=>{if(r.url().endsWith('.js'))chunks.push(r.url())});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().includes('/auth/organizations') ? {organizations:[]} : route.request().url().includes('/auth/session') ? {user:{id:'synthetic',name:'Synthetic',role:'MEMBER'},organization:null} : [])}));
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.goto(origin+'/pre-qualificacao', {waitUntil:'domcontentloaded'});
    await page.getByText('Selecione uma organização para continuar.',{exact:true}).waitFor();
    assert(chunks.some(u=>u.includes('/Prequalification-')));
    assert(!chunks.some(u=>/\/(Pq1Profile|Dashboard|Users|Login)-/.test(u)));
    await page.getByRole('link',{name:'Publicação multidomínio',exact:true}).click();
    await page.getByText('Selecione uma organização no cabeçalho para continuar.',{exact:true}).waitFor();
    assert(chunks.some(u=>u.includes('/Pq1Profile-')));
    await page.goto(origin+'/utilizadores');
    await page.waitForURL(url=>!url.pathname.startsWith('/utilizadores'));
    assert(!chunks.some(u=>u.includes('/Users-')));
    assert.deepEqual(errors,[]);
    console.log('PASS production build: route chunks fetched on demand, direct URL, client navigation, admin guard before module load. Synthetic session; no backend writes.');
  } finally {await browser?.close(); await new Promise(resolve=>server.close(resolve))}
}
run().catch(e=>{console.error(e);process.exitCode=1});
