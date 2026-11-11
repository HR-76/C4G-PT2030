const STATES=Object.freeze(['UPLOAD_EXPIRED','MULTIPART_ABANDONED','METADATA_WITHOUT_OBJECT','OBJECT_WITHOUT_METADATA','CHECKSUM_DIVERGED','SCAN_PENDING','VERSION_INCONSISTENT','CONFIRMATION_UNCERTAIN','PROVIDER_TIMEOUT']);
const AUTOMATIC=new Set(['UPLOAD_EXPIRED','MULTIPART_ABANDONED','SCAN_PENDING','CONFIRMATION_UNCERTAIN']);
function classifyFinding(value,telemetryPort=null){if(!value||!STATES.includes(value.code))throw new TypeError('Document reconciliation finding is invalid.');const result=Object.freeze({code:value.code,repair:AUTOMATIC.has(value.code)?'DETERMINISTIC_IDEMPOTENT':'AUTHORITY_REQUIRED'});try{telemetryPort?.record('F11',1,{operation:'reconciliation',result:'error'});}catch{}return result;}
module.exports={STATES,classifyFinding};
