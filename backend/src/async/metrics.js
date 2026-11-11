const LABELS=Object.freeze(['jobType','result','errorClass','queueClass','workerRole']);
function metric(labels){if(!labels||Object.keys(labels).some(k=>!LABELS.includes(k))||Object.values(labels).some(v=>typeof v!=='string'||v.length>64||/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(v)))throw new TypeError('Async metric labels are invalid.');return Object.freeze({...labels});}
module.exports={LABELS,metric};
