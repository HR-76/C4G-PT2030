'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),ref=path.join(root,'.tmp/portugal2030-reference/frontend'),out=path.join(root,'output/playwright/c4g-portugal2030');
const esbuild=require('../../../frontend/node_modules/esbuild'),{chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function main(){
 fs.mkdirSync(out,{recursive:true});fs.cpSync(path.join(root,'.tmp/pilot-visual-reference/frontend'),ref,{recursive:true});
 fs.writeFileSync(path.join(ref,'src/pages/Import.jsx'),execFileSync('git',['show','2fa3b1c:frontend/src/pages/Import.jsx'],{cwd:root,encoding:'utf8',windowsHide:true}));
 const preview={sheet:'Avisos',records_found:4,headers:Array(6).fill('Coluna'),preview:[{title:'Ensaio: investigação e inovação',programme:'NORTE2030',opening_date:'2026-10-18',closing_date:'2026-12-01'},{title:'Ensaio: aviso já existente',programme:'CENTRO2030',opening_date:'2026-10-01',closing_date:'2026-12-31'},{title:'Ensaio: possível correspondência',programme:'ALENTEJO2030',opening_date:'2026-11-01',closing_date:'2027-01-31'}]};
 fs.writeFileSync(path.join(ref,'src/contexts/AuthContext.jsx'),"export const useAuth=()=>({user:{id:1,name:'Referência'},isAdmin:true,logout:()=>{}});");
 fs.writeFileSync(path.join(ref,'src/api/api.js'),'const ok=data=>Promise.resolve({data});export const importsApi={list:()=>ok([]),preview:()=>ok('+JSON.stringify(preview)+')};export const notificationsApi={list:()=>ok({total:0})};');
 fs.writeFileSync(path.join(ref,'entry.jsx'),"import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import Layout from './src/components/Layout/Layout';import Import from './src/pages/Import';import {ToastProvider} from './src/components/ToastProvider';import './src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><ToastProvider><Routes><Route element={<Layout/>}><Route path='/importar' element={<Import/>}/></Route></Routes></ToastProvider></BrowserRouter>);");
 await esbuild.build({entryPoints:[path.join(ref,'entry.jsx')],bundle:true,outfile:path.join(ref,'reference.js'),jsx:'automatic',nodePaths:[path.join(root,'frontend/node_modules')],loader:{'.png':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.name));page.setDefaultTimeout(15000);
  await page.route('**/*',route=>{const pathname=new URL(route.request().url()).pathname;const asset=pathname==='/reference.js'?path.join(ref,'reference.js'):pathname==='/reference.css'?path.join(ref,'reference.css'):path.join(ref,'public',pathname.slice(1));if(fs.existsSync(asset)&&fs.statSync(asset).isFile())return route.fulfill({path:asset});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt"><head><meta charset="UTF-8"><link rel="stylesheet" href="/reference.css"></head><body><div id="root"></div><script src="/reference.js"></script></body></html>'})});
  await page.goto('http://portugal-reference.invalid/importar');await page.locator('input[type=file]').setInputFiles(path.join(out,'synthetic-plan.xlsx'));await page.getByRole('heading',{name:'Pré-visualização',exact:true}).waitFor();
  await page.evaluate(()=>{const notice=document.createElement('p');notice.textContent='REFERÊNCIA DO PILOTO — dados sintéticos; nenhuma importação real.';notice.className='alert';document.querySelector('main').prepend(notice)});
  await page.screenshot({path:path.join(out,'pilot-1440.png'),fullPage:true,animations:'disabled'});if(errors.length)throw Error('REFERENCE_PAGE_FAILED');console.log('PORTUGAL2030_PILOT_REFERENCE_PASS');
 }finally{await browser.close()}
}
main().catch(error=>{console.error('PORTUGAL2030_REFERENCE_FAILED',error.code||error.name,error.message?.slice(0,140));process.exitCode=1});
