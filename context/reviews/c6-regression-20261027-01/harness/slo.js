'use strict';
const round=n=>Number.isFinite(n)?Math.round(n*100)/100:null;
function evaluateAdmissionSlo(runs,slo,acquireTimeoutMs=5000){
 if(slo.approvalStatus!=='APPROVED_BY_USER')throw Error('SLO_NOT_APPROVED');
 const waits=runs.flatMap(r=>r.admissionSlo.waits),valid=waits.filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
 const dataComplete=runs.length>0&&runs.every(r=>r.admissionSlo.dataComplete&&r.admissionSlo.waits.length>0)&&valid.length===waits.length;
 const environmentValid=runs.length>0&&runs.every(r=>r.host.controlledChecksPass);
 const admissionErrors=runs.reduce((n,r)=>n+r.admissionSlo.failures.length,0),httpErrors=runs.reduce((n,r)=>n+r.errors,0);
 const p95Raw=valid.length?valid[Math.ceil(valid.length*.95)-1]:null,maxRaw=valid.length?valid.at(-1):null;
 const headroomRaw=maxRaw===null?null:acquireTimeoutMs-maxRaw;
 const p95Ms=round(p95Raw),maxMs=round(maxRaw),minHeadroomMs=round(headroomRaw);
 const observedCriteriaPass=dataComplete&&admissionErrors<=slo.admissionErrorsMaximum&&httpErrors<=slo.httpFailuresMaximum
  &&p95Raw<=slo.p95WaitMsMaximum&&maxRaw<=slo.maxWaitMsMaximum&&headroomRaw>=slo.minObservedHeadroomMs;
 return {admissions:waits.length,dataComplete,environmentValid,admissionErrors,httpErrors,p95Ms,maxMs,minHeadroomMs,
  observedCriteriaPass,verdict:!dataComplete?'INCOMPLETE_EVIDENCE':!environmentValid?'INVALID_ENVIRONMENT':observedCriteriaPass?'PASS':'FAIL',
  burstsExceedingMax:runs.filter(r=>r.admissionSlo.waits.some(ms=>ms>slo.maxWaitMsMaximum)).map(r=>r.index)};
}
module.exports={evaluateAdmissionSlo};
