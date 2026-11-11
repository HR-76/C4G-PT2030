'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function main(){
 const folder=path.resolve(__dirname,'../../../output/playwright/c4g-pilot-parity');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const page=await browser.newPage({viewport:{width:2200,height:1200}});
 await page.goto(pathToFileURL(path.join(folder,'comparacao.html')).href);await page.waitForLoadState('networkidle');
 for(const width of ['1440','1008']){await page.locator('#width').selectOption(width);await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));}
 await page.locator('#width').selectOption('1440');await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
 for(const id of ['dashboard','catalogo','detalhe'])await page.locator('#'+id).screenshot({path:path.join(folder,'comparacao-'+id+'.png')});
 console.log('COMPARISON_RENDER_PASS');
 }finally{await browser.close();}
}main().catch(e=>{console.error(e.message);process.exitCode=1});
