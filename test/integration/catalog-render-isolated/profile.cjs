'use strict';
const http=require('node:http'),path=require('node:path');
const esbuild=require('../../../frontend/node_modules/esbuild');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
(async()=>{
 const bundle=await esbuild.build({entryPoints:[path.join(__dirname,'entry.jsx')],bundle:true,write:false,jsx:'automatic',loader:{'.css':'empty'},nodePaths:[path.resolve(__dirname,'../../../frontend/node_modules')],define:{'process.env.NODE_ENV':'"development"'}});
 const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents)}res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button',{name:'Tentar novamente'}).waitFor({timeout:8000});
  await page.waitForTimeout(3500);
  const result=await page.evaluate(()=>({ticks:window.proof.ticks,commits:window.proof.commits,button:document.querySelector('button').textContent,disabled:document.querySelector('button').disabled}));
  console.log(JSON.stringify(result));
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.name,error.message);process.exitCode=1});
