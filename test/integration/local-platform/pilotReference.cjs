'use strict';
// Visual reference only: original components, isolated mock services, no database.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'), ref=path.join(root,'.tmp/pilot-visual-reference/frontend');
const out=path.join(root,'output/playwright/c4g-pilot-parity');
const esbuild=require('../../../frontend/node_modules/esbuild');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function main(){
 const rows=[
  ['DIGITAL-2023-SKILLS-05-SPECIALEDU','Gnomon Internships Offer','DIGITAL','2027-01-03'],
  ['DIGITAL-2025-BESTUSE-08-FACTCHECKERS','EFCSN Permanent Call for Protection Grants','DIGITAL','2028-05-31'],
  ['EDF-EDIP-P-2026-2027-FNLC-SA-SEAP','Support for the functioning of SEAPs, including for the purpose of establishing, managing and maintaining defence industrial readiness pools','EDF','2026-11-12'],
  ['HORIZON-WIDERA-2025-04-ACCESS-01','R&I Policy Support for Enlargement Countries','HORIZON','2026-11-12']
 ].map(([reference_code,title,programme,closing_date],i)=>({id:i+1,reference_code,title,programme,closing_date,source:'EU_FUNDING_TENDERS',status:'',opening_date:null,budget:null,description:'Referência visual: dados públicos adaptados ao contrato do piloto. Não representa uma sessão histórica nem prova uma integração operacional.',areas:[]}));
 const publicRows=JSON.parse(fs.readFileSync(path.join(out,'public-catalog.json')));
 rows.forEach((row,index)=>{const source=publicRows[index]; row.opening_date=source.openingDate;row.raw_payload={identifier:row.reference_code,frameworkProgramme:row.programme};});
 const detail=JSON.parse(fs.readFileSync(path.join(out,'public-detail.json'))).snapshot;
 rows[0].created_at=JSON.parse(fs.readFileSync(path.join(out,'public-detail.json'))).createdAt;
 rows[0].raw_payload={...rows[0].raw_payload,descriptionByte:detail.summary,url:detail.officialUrl};
 const dashboard={role:'ADMIN',opportunities:{total:9,open:4,closing_soon:0},applications:{total:0,active:0,by_status:{}},budget:{},notifications:{total:0},deadlines:[],source_totals:[{source:'EU_FUNDING_TENDERS',total:9,open:4}],recent_opportunities:rows};
 fs.writeFileSync(path.join(ref,'src/contexts/AuthContext.jsx'),`export const useAuth=()=>({user:{name:'Referência visual',role:'ADMIN'},isAdmin:true,logout:()=>{}});`);
 fs.writeFileSync(path.join(ref,'src/api/api.js'),`const rows=${JSON.stringify(rows)}; const ok=data=>Promise.resolve({data}); export const dashboardApi={get:()=>ok(${JSON.stringify(dashboard)})}; export const opportunitiesApi={list:()=>ok({data:rows,total:rows.length}),get:id=>ok(rows.find(r=>r.id===Number(id)))}; export const applicationsApi={list:()=>ok([])}; export const notificationsApi={list:()=>ok({total:0})};`);
 fs.writeFileSync(path.join(ref,'entry.jsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import Layout from './src/components/Layout/Layout';import Dashboard from './src/pages/Dashboard';import List from './src/pages/Opportunities/OpportunitiesList';import Detail from './src/pages/Opportunities/OpportunityDetail';import {ToastProvider} from './src/components/ToastProvider';import './src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><ToastProvider><Routes><Route element={<Layout/>}><Route path="/dashboard" element={<Dashboard/>}/><Route path="/oportunidades" element={<List/>}/><Route path="/oportunidades/:id" element={<Detail/>}/></Route></Routes></ToastProvider></BrowserRouter>);`);
 await esbuild.build({entryPoints:[path.join(ref,'entry.jsx')],bundle:true,outfile:path.join(ref,'reference.js'),jsx:'automatic',nodePaths:[path.join(root,'frontend/node_modules')],loader:{'.png':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const pathname=new URL(route.request().url()).pathname;const asset=pathname==='/reference.js'?path.join(ref,'reference.js'):pathname==='/reference.css'?path.join(ref,'reference.css'):path.join(ref,'public',pathname.slice(1));if(fs.existsSync(asset)&&fs.statSync(asset).isFile())return route.fulfill({path:asset});return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/reference.css"></head><body><div id="root"></div><script src="/reference.js"></script></body></html>'});});
 for(const width of [1440,1008]){await page.setViewportSize({width,height:900});for(const [name,route] of [['dashboard','/dashboard'],['catalog','/oportunidades'],['detail','/oportunidades/1']]){await page.goto('http://pilot-reference.invalid'+route);if(name==='dashboard')await page.getByRole('button',{name:'Indicadores operacionais',exact:true}).click();await page.waitForTimeout(300);await page.screenshot({path:path.join(out,`pilot-${name}-${width}.png`),fullPage:true});}}
 if(errors.length)throw Error(errors.join(';'));console.log('PILOT_REFERENCE_PASS');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
