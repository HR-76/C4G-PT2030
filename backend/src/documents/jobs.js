const {createJobRegistry}=require('../async/jobRegistry');
const JOBS=Object.freeze(['document.scan','document.reconcile','document.expire_upload']);
const SERVICE_ACTORS=Object.freeze({
  'document.scan':Object.freeze({code:'F11_DOCUMENT_SCAN',operation:'document.scan'}),
  'document.reconcile':Object.freeze({code:'F11_DOCUMENT_RECONCILIATION',operation:'document.reconcile'}),
  'document.expire_upload':Object.freeze({code:'F11_UPLOAD_EXPIRATION',operation:'document.expire_upload'})
});
function createDocumentJobRegistry(handlers){if(!handlers||Reflect.ownKeys(handlers).some(key=>!JOBS.includes(key))||JOBS.some(key=>typeof handlers[key]!=='function'))throw new TypeError('F11 job handlers are incomplete or open.');return createJobRegistry(JOBS.map(type=>({type,version:1,payloadVersion:1,handler:handlers[type]})));}
module.exports={JOBS,SERVICE_ACTORS,createDocumentJobRegistry};
