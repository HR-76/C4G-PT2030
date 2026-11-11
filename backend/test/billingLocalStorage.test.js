'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{Readable}=require('node:stream');
const {createLocalBillingStorage}=require('../src/customerBilling/localStorage');
test('local PDFs are immutable, scoped, integrity checked and bounded',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'c4g-billing-test-')),organizationId=randomUUID();
 const storage=createLocalBillingStorage({root,organizationId,environment:'development'}),objectId=randomUUID(),b=Buffer.from('%PDF-1.7 local storage fixture'),sha256=createHash('sha256').update(b).digest('hex');
 const input={objectId,storageClass:'QUARANTINE',expectedSize:b.length,expectedSha256:sha256,conditionalCreate:true,declaredMime:'application/pdf'};
 const put=async()=>{const h=await storage.beginWrite(input);await storage.write(h,Readable.from([b]));return storage.commit(h,{size:b.length,sha256,mime:'application/pdf'})};
 await put();await assert.rejects(put,{code:'EEXIST'});assert.equal((await storage.head(input)).sha256,sha256);
 const range=await storage.readRange({...input,start:0,end:b.length-1,etag:sha256});const out=[];for await(const c of range)out.push(c);assert.deepEqual(Buffer.concat(out),b);
 await assert.rejects(()=>storage.readRange({...input,start:0,end:b.length-1,etag:'wrong'}));
 await assert.rejects(()=>storage.head({...input,objectId:'../outside'}));
 const other=createLocalBillingStorage({root,organizationId:randomUUID(),environment:'development'});await assert.rejects(()=>other.head(input),{code:'ENOENT'});
 assert.throws(()=>createLocalBillingStorage({root,organizationId,environment:'production'}));
 await assert.rejects(()=>storage.beginWrite({...input,expectedSize:10485761}));await storage.shutdown();await assert.rejects(()=>storage.head(input));
});
