"use strict";
function createDiagnostics(){
 let active=false,values={},dropped=0;
 return {observe(name,ms){if(!active)return;if(!/^(sessionRead|authority)\.(pool|admission|lock|verify)$|^touch\.(get|validate|set|total|joined)$/.test(name)||!Number.isFinite(ms)||ms<0)throw Error('INVALID_DIAGNOSTIC');const a=values[name]??=[];if(a.length>=10000){dropped++;return;}a.push(ms);},start(){values={};dropped=0;active=true;},finish(){active=false;return {dropped,phases:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{count:v.length,totalMs:v.reduce((a,b)=>a+b,0),meanMs:v.reduce((a,b)=>a+b,0)/v.length,p95Ms:v.slice().sort((a,b)=>a-b)[Math.ceil(v.length*.95)-1],samplesMs:v}]))};}};
}
module.exports={createDiagnostics};
