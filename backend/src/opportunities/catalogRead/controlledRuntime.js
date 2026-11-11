'use strict';
const {createExposureControl,createPolicyStore}=require('./exposureControl');
const {createRehearsalMonitor}=require('./rehearsalMonitor');
const {createReadRuntime}=require('./readRuntime');
// Deliberately not imported/mounted by the ordinary GCNI composition.
function createControlledReadRuntime({isolated,policyStore=createPolicyStore(),sink,clock=()=>Date.now(),...dependencies}){
 if(isolated!==true)throw TypeError('Explicit isolated rehearsal required');
 const monitor=createRehearsalMonitor({sink,clock});monitor.heartbeat();
 const factory=policyStore.durable===true?require('./pgPolicyStore').createDurableExposureControl:createExposureControl;
 const control=factory({store:policyStore,clock,healthy:monitor.healthy});
 const runtime=createReadRuntime({...dependencies,clock,exposure:control.reader,observe:monitor.observe});
 const operator=Object.freeze({...Object.fromEntries(['enable','disable','withdraw',...(control.operator.resume?['resume']:[])].map(action=>[action,async args=>{if(['enable','resume'].includes(action)&&monitor.snapshot().alerts.length)throw Error('CONTROL_MONITOR_NOT_READY');const receipt=await control.operator[action](args);monitor.control(action,receipt);return receipt;}])),status:control.operator.status});
 return Object.freeze({...runtime,operator,monitor});
}
module.exports={createControlledReadRuntime};
