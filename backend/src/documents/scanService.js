const { assertMalwareScanPort, RESULTS } = require('./malwareScanPort');
const { createOoxmlStructuralInspector } = require('./ooxmlStructuralInspector');
const { transition } = require('./stateMachine');
function createScanService({ scanner, repository, storage, audit, structuralInspector = null, telemetryPort = null }) {
  assertMalwareScanPort(scanner);
  const ooxmlInspector = structuralInspector || createOoxmlStructuralInspector();
  return Object.freeze({ async scan({ record, actor, fencingToken, signal = null, assertFence = async()=>true }) {
    if (!record || !fencingToken) throw new TypeError('Fenced scan context is required.');
    if(typeof assertFence!=='function')throw new TypeError('Fenced scan assertion is invalid.');
    const active=()=>{if(signal?.aborted)throw Object.assign(new Error('WORKER_DRAINING'),{code:'WORKER_DRAINING'});};
    active();
    const result=await scanner.scan({objectId:record.objectId,organizationId:record.organizationId,
      expectedSize:record.observedSize??record.expectedSize,expectedSha256:record.sha256??record.expectedSha256,signal});
    active();
    if(!result||!RESULTS.includes(result.status)) throw new Error('MALWARE_SCAN_INVALID_RESULT');
    if(result.status==='ERROR') throw new Error('MALWARE_SCANNER_UNAVAILABLE');
    let structural=null;
    if(result.status==='CLEAN'&&record.expectedFileClass==='OOXML'){
      structural=await ooxmlInspector.inspect({record,storage,signal});
      active();
      if(!structural||!['APPROVED','REJECTED'].includes(structural.status)||typeof structural.code!=='string')throw new Error('OOXML_INSPECTION_INVALID_RESULT');
      if(structural.status==='APPROVED'&&structural.contentSha256!==(record.sha256??record.expectedSha256))throw new Error('OOXML_INSPECTION_BINDING_MISMATCH');
    }
    const deepInspectionBlocked=record.expectedFileClass==='OOXML'&&structural?.status!=='APPROVED';
    const next=result.status==='CLEAN'&&!deepInspectionBlocked?'AVAILABLE':'QUARANTINED'; transition('SCANNING',next,{scanState:result.status});
    await assertFence();active();
    const updated=await repository.transition({organizationId:record.organizationId,versionId:record.versionId,fromState:'SCANNING',toState:next,scanState:result.status,lockVersion:record.lockVersion,
      scanResult:{result:result.status,code:structural?.code||`ANTIVIRUS_${result.status}`,inputDigest:record.sha256??record.expectedSha256}});
    await audit.emit('DOCUMENT_SCAN_COMPLETED',{organizationId:record.organizationId,versionId:record.versionId,result:result.status,
      ...(structural?{detailCode:structural.code}:{}),actor}); try { telemetryPort?.record('F11',1,{operation:'scan',result:structural?.status==='REJECTED'?'invalid':result.status.toLowerCase()}); } catch {} return updated;
  }});
}
module.exports = { createScanService };
