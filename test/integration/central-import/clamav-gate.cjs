'use strict';
// Isolated real ClamAV proof. No application settings, database or R2 credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const {createClamavScanner}=require('../../../backend/src/documents/clamavScanner');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--isolated']);
 const id=randomUUID(),name='c4g-import-clamav-'+id,root=path.resolve(__dirname,'../../..');
 const report={status:'RUNNING',realClamav:true,realR2:false,applicationActivated:false,checks:[],cleanup:false};
 const folder=path.join(root,'output',name);fs.mkdirSync(folder,{recursive:true});
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
 let container,attempted=false;
 const owned=()=>{assert.match(container,/^[a-f0-9]{64}$/);assert.equal(docker(['inspect','--format','{{index .Config.Labels "c4g.import-clamav"}}',container]),id);assert.equal(docker(['inspect','--format','{{.Name}}',container]),'/'+name);};
 try{
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe:\/\/|unix:\/\/)/);
  if(process.env.DOCKER_HOST)assert.match(process.env.DOCKER_HOST,/^(npipe:\/\/|unix:\/\/)/);
  const image=docker(['image','inspect','clamav/clamav:stable','--format','{{.Id}}']);assert.match(image,/^sha256:[a-f0-9]{64}$/);report.image=image;
  attempted=true;container=docker(['run','-d','--name',name,'--label','c4g.import-clamav='+id,'-p','127.0.0.1::3310',image]);owned();
  const binding=docker(['port',container,'3310/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);const port=Number(binding.split(':')[1]);
  let bytes=Buffer.from('C4G clean scanner fixture'),objectId=randomUUID();
  const sha=()=>createHash('sha256').update(bytes).digest('hex');
  const storage={async head(){return {size:bytes.length,sha256:sha(),etag:'isolated'}},async readRange({start,end}){return [bytes.subarray(start,end+1)]}};
  const scanner=createClamavScanner({authority:'CENTRAL',storage,host:'127.0.0.1',port,timeoutMs:3000});
  let ready=false;for(let i=0;i<120;i++){if((await scanner.health()).ready){ready=true;break;}await new Promise(r=>setTimeout(r,1000));if(i%20===0)console.log('Waiting for owned ClamAV daemon');}assert(ready,'CLAMAV_NOT_READY');
  report.version=docker(['exec',container,'clamdscan','--version']);
  const scan=()=>scanner.scan({authority:'CENTRAL',objectId,expectedSize:bytes.length,expectedSha256:sha()});
  bytes=fs.readFileSync(path.join(root,'backend/test/fixtures/portugal2030/PlanoAnualAvisos_download_140926-1.xlsx'));
  assert.equal((await scan()).status,'CLEAN');report.checks.push('REFERENCE_XLSX_CLEAN');
  // Standard harmless EICAR test string, held in memory only.
  bytes=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$'+'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  assert.equal((await scan()).status,'INFECTED');report.checks.push('EICAR_INFECTED');
  assert.equal((await scanner.scan({authority:'CENTRAL',objectId,expectedSize:bytes.length,expectedSha256:'0'.repeat(64)})).status,'ERROR');report.checks.push('INTEGRITY_MISMATCH_REJECTED');
  docker(['stop','--time','3',container]);assert.equal((await scanner.health()).ready,false);assert.equal((await scan()).status,'ERROR');report.checks.push('DAEMON_UNAVAILABLE_FAILS_CLOSED');
  report.status='PASS';
 }catch(e){report.status='FAIL';report.failure={code:e.code||e.name,message:String(e.message).slice(0,400)};}
 finally{
  try{if(attempted){if(!container){const found=docker(['ps','-aq','--no-trunc','--filter','label=c4g.import-clamav='+id]).split(/\r?\n/).filter(Boolean);assert.equal(found.length,1);container=found[0];}owned();docker(['rm','-f',container]);}report.cleanup=true;}catch{report.status='FAIL';}
  fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cleanup:report.cleanup,evidence:folder}));
 }
 if(report.status!=='PASS')process.exitCode=1;
}
if(require.main===module)main();
