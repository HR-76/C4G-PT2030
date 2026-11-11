'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {mountPdfRoutes}=require('../src/customerBilling/pdfHttp');
test('private PDF HTTP returns attachment without cache and validates upload headers',async()=>{
 const app=express(),router=express.Router();let uploads=0;
 mountPdfRoutes(router,{express,service:{list:async()=>({items:[]}),download:async()=>({filename:'fatura.pdf',bytes:Buffer.from('%PDF-test')}),upload:async()=>{uploads++;return {version:1}}}});app.use(router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/documents/doc/pdf';
 try{let r=await fetch(url+'/version');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-disposition'),/^attachment/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(await r.text(),'%PDF-test');
 r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/pdf','X-PDF-Revision':'-1'},body:'%PDF-test'});assert.equal(r.status,400);assert.equal(uploads,0);
 r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/pdf','X-PDF-Revision':'0','X-PDF-Filename':'fatura.pdf'},body:'%PDF-test'});assert.equal(r.status,201);assert.equal(uploads,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
test('PDF package preserves previous package boundaries and accepts complete catalog ledger',()=>{
 const m=require('../src/security/centralMigrationManifest'),pdf=require('../src/security/billingPdfMigrationPackage').entry,l=require('../src/opportunities/catalogRead/ledgerContract');assert.equal(m.knownManifest.at(-1),pdf);assert.equal(m.centralImportManifest.at(-1).version,'049_pt2030_document_upload');assert.equal(m.migrationSql(pdf.version,'up').checksum,pdf.upChecksum);assert.throws(()=>m.migrationSql(pdf.version,'down'),/irreversible/);
 const rows=m.knownManifest.map(e=>({version:e.version,checksum_sha256:m.migrationSql(e.version,'up').checksum,irreversible:e.irreversible}));l.assertLedgerRows(rows);assert.throws(()=>l.assertLedgerRows(rows.filter(r=>r.version!=='049_pt2030_document_upload')),/DRIFT/);
});
