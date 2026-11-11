'use strict';
// Historical pilot source with projected public run data, no legacy server/DB.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),ref=path.join(root,'.tmp/integrations-reference/frontend'),out=path.join(root,'output/playwright/c4g-integrations');
const esbuild=require('../../../frontend/node_modules/esbuild'),{chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function main(){
 fs.mkdirSync(out,{recursive:true});fs.cpSync(path.join(root,'.tmp/pilot-visual-reference/frontend'),ref,{recursive:true});
 fs.writeFileSync(path.join(ref,'src/pages/Integrations.jsx'),execFileSync('git',['show','3a79b25539040c2024051cf9ab6295680b760277:frontend/src/pages/Integrations.jsx'],{cwd:root,encoding:'utf8',windowsHide:true}));
 const current=JSON.parse(fs.readFileSync(path.join(out,'history-reference.json')));
 const rows=current.map(r=>({id:r.runId,source_name:'EU Funding & Tenders',status:r.status,started_at:r.startedAt||r.createdAt,finished_at:r.finishedAt,records_found:r.received,records_created:r.created,records_updated:r.updated}));
 fs.writeFileSync(path.join(ref,'src/contexts/AuthContext.jsx'),"export const useAuth=()=>({user:{id:1,name:'Referência'},isAdmin:true,logout:()=>{}});");
 fs.writeFileSync(path.join(ref,'src/api/api.js'),'const ok=data=>Promise.resolve({data});export const integrationsApi={runs:()=>ok('+JSON.stringify(rows)+')};export const notificationsApi={list:()=>ok({total:0})};');
 fs.writeFileSync(path.join(ref,'entry.jsx'),"import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import Layout from './src/components/Layout/Layout';import Integrations from './src/pages/Integrations';import {ToastProvider} from './src/components/ToastProvider';import './src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><ToastProvider><Routes><Route element={<Layout/>}><Route path='/integracoes' element={<Integrations/>}/></Route></Routes></ToastProvider></BrowserRouter>);");
 await esbuild.build({entryPoints:[path.join(ref,'entry.jsx')],bundle:true,outfile:path.join(ref,'reference.js'),jsx:'automatic',nodePaths:[path.join(root,'frontend/node_modules')],loader:{'.png':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.name));
  await page.route('**/*',route=>{const pathname=new URL(route.request().url()).pathname;const asset=pathname==='/reference.js'?path.join(ref,'reference.js'):pathname==='/reference.css'?path.join(ref,'reference.css'):path.join(ref,'public',pathname.slice(1));if(fs.existsSync(asset)&&fs.statSync(asset).isFile())return route.fulfill({path:asset});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt"><head><meta charset="UTF-8"><link rel="stylesheet" href="/reference.css"></head><body><div id="root"></div><script src="/reference.js"></script></body></html>'})});
  await page.goto('http://integrations-reference.invalid/integracoes');await page.getByRole('heading',{name:'EU Funding & Tenders',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'pilot-1440.png'),fullPage:true,animations:'disabled'});if(errors.length)throw Error('REFERENCE_PAGE_FAILED');
  fs.writeFileSync(path.join(out,'comparison.html'),'<!doctype html><html lang="pt"><meta charset="UTF-8"><title>Integrações — piloto e C4G</title><style>body{font:14px Segoe UI,sans-serif;margin:24px;background:#f6f8f8;color:#20262b}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #ccc}article{min-width:0}a{color:#075b59}</style><h1>Integrações: piloto e C4G</h1><p>Primeiro incremento da entrega 4. A referência usa o componente original e os mesmos contadores públicos projetados para o formato antigo; não prova o funcionamento dos conectores legacy.</p><p>C4G: cinco fontes visíveis, quatro pendentes, atualização Funding &amp; Tenders limitada a cinco registos e histórico central real. Configuração dos anexos adiada para o final por indicação do utilizador. Nenhuma recolha externa foi disparada nesta validação.</p><div class="pair"><article><h2>Piloto · referência 1440 px</h2><img src="pilot-1440.png"></article><article><h2>C4G · ambiente habitual 1440 px</h2><img src="native-1440.png"></article></div><p><a href="native-390.png">C4G móvel</a> · <a href="native-verification.json">Prova OIDC/API e preservação</a></p></html>');
  console.log('INTEGRATIONS_PILOT_REFERENCE_PASS');
 }finally{await browser.close()}
}
main().catch(error=>{console.error('INTEGRATIONS_REFERENCE_FAILED',error.code||error.name);process.exitCode=1});
