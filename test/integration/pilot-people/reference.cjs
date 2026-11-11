'use strict';
// Visual reference components with simulated service responses and no database.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),ref=path.join(root,'.tmp/pilot-people-reference/frontend');
const out=path.join(root,'output/playwright/c4g-pilot-people');
const esbuild=require('../../../frontend/node_modules/esbuild');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function main(){
 fs.mkdirSync(out,{recursive:true});
 fs.cpSync(path.join(root,'.tmp/pilot-visual-reference/frontend'),ref,{recursive:true});
 const areas=require('../../../backend/src/organizationDirectory/thematicAreas').areas;
 const selected=areas.find(a=>a.name==='Educação e Formação Profissional');
 const person={id:1,name:'Pessoa de ensaio visual',email:'pessoa@example.invalid',institution:'Universidade da Beira Interior',department:'Unidade de projetos',bio:'Experiência em projetos de educação e formação.',keywords:'educação, formação',research_areas:[selected],research_centers:[{id:1,name:'Unidade de projetos',faculty_id:1,is_primary:true}]};
 const rows=['Formação e competências — ensaio','Convite privado — ensaio'].map((title,i)=>({id:i+1,title,programme:'Programa de ensaio',source:i?'MANUAL':'EU_FUNDING_TENDERS',closing_date:'2030-01-01',matching_areas:1,matched_area_names:[selected.name]}));
 fs.writeFileSync(path.join(ref,'src/contexts/AuthContext.jsx'),`export const useAuth=()=>({user:${JSON.stringify(person)},isAdmin:location.pathname==='/matching',logout:()=>{}});`);
 fs.writeFileSync(path.join(ref,'src/api/api.js'),`const ok=data=>Promise.resolve({data});export const professorsApi={me:()=>ok(${JSON.stringify(person)}),list:()=>ok([${JSON.stringify(person)}])};export const areasApi={list:()=>ok(${JSON.stringify(areas)})};export const authApi={};export const ubiStructureApi={get:()=>ok([{id:1,name:'Unidade de projetos',centers:[{id:1,name:'Unidade de projetos'}]}])};export const matchingApi={me:()=>ok(${JSON.stringify(rows)}),forProfessor:()=>ok(${JSON.stringify(rows)})};export const notificationsApi={list:()=>ok({total:0})};`);
 fs.writeFileSync(path.join(ref,'entry.jsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import Layout from './src/components/Layout/Layout';import Profile from './src/pages/Profile';import Matching from './src/pages/Matching';import {ToastProvider} from './src/components/ToastProvider';import './src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><ToastProvider><Routes><Route element={<Layout/>}><Route path="/perfil" element={<Profile/>}/><Route path="/matching" element={<Matching/>}/></Route></Routes></ToastProvider></BrowserRouter>);`);
 await esbuild.build({entryPoints:[path.join(ref,'entry.jsx')],bundle:true,outfile:path.join(ref,'reference.js'),jsx:'automatic',nodePaths:[path.join(root,'frontend/node_modules')],loader:{'.png':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const pathname=new URL(route.request().url()).pathname;const asset=pathname==='/reference.js'?path.join(ref,'reference.js'):pathname==='/reference.css'?path.join(ref,'reference.css'):path.join(ref,'public',pathname.slice(1));if(fs.existsSync(asset)&&fs.statSync(asset).isFile())return route.fulfill({path:asset});return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/reference.css"></head><body><div id="root"></div><script src="/reference.js"></script></body></html>'})});
  for(const width of [1440,1008]){await page.setViewportSize({width,height:1000});for(const [name,route] of [['profile','/perfil'],['matching','/matching']]){await page.goto('http://pilot-people-reference.invalid'+route);if(name==='matching'){await page.locator('select').selectOption('1');await page.getByText(rows[0].title,{exact:true}).waitFor()}else await page.getByText(selected.name,{exact:true}).first().waitFor();await page.screenshot({path:path.join(out,`pilot-${name}-${width}.png`),fullPage:true})}}
  if(errors.length)throw Error(errors.join(';'));console.log('PILOT_PEOPLE_REFERENCE_PASS');
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
