'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),assert=require('node:assert/strict');
const {replay,KEYS}=require('./shared-r2-budget');
const allowance=Object.freeze({functionalRequests:46,cleanupRequests:5,applicationBytes:68264,objectIntentions:1,completedObjects:1,multipartIntentions:0,unresolvedMultipart:0});
function derive(baseline){const limits={};for(const key of KEYS){assert(Number.isSafeInteger(baseline[key])&&baseline[key]>=0);limits[key]=baseline[key]+allowance[key];}return{baseline:{...baseline},limits};}
function loadHistory(directory){
 const pins={'r2-phase-journal.jsonl':'6E87A494A96868CC291120CE0F257E24B0CABE3BD0B390577CDE98A78FB71DF1','shared-r2-journal.jsonl':'C77F0BC83AC11AD6F22F04ECA99599DC565A8A852C1EBF44BB282DEC3ABC8B38','browser-accounting-complement.json':'344B8C246AEE6AE9D42C900B9141913FF8CCCF387A1B13EF2C96063D45DC7221'};
 for(const [name,hash] of Object.entries(pins))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex').toUpperCase(),hash);
 const previous=replay(fs.readFileSync(path.join(directory,'shared-r2-journal.jsonl'),'utf8'));assert.equal(previous.sequence,121);
 assert.deepEqual(previous.budget,{functionalRequests:482,cleanupRequests:65,applicationBytes:60516456,objectIntentions:23,completedObjects:22,multipartIntentions:3,unresolvedMultipart:0});
 return{...derive(previous.budget),source:JSON.stringify({pins,historicalBrowserTraffic:'UNKNOWN_NOT_RECONCILED',authorization:'ONE_EXECUTION_46_FUNCTIONAL_5_CLEANUP'}),pins};
}
function checkIncrement(value){for(const key of KEYS)assert(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=allowance[key],`increment:${key}`);return value;}
module.exports={allowance,derive,loadHistory,checkIncrement};
