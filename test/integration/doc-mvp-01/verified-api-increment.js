'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),assert=require('node:assert/strict');
const {replay,KEYS}=require('./shared-r2-budget');
const prior=require('./browser-increment');
// Measured local A/B: 34 provider attempts, 7308 payload bytes. Remote-only
// inventories add four attempts at each boundary. Cleanup: three + two reserve.
const allowance=Object.freeze({functionalRequests:42,cleanupRequests:5,applicationBytes:7308,
 objectIntentions:1,completedObjects:1,multipartIntentions:0,unresolvedMultipart:0});
function derive(baseline){const limits={};for(const key of KEYS){assert(Number.isSafeInteger(baseline[key])&&baseline[key]>=0);limits[key]=baseline[key]+allowance[key];}return{baseline:{...baseline},limits};}
function loadHistory(directory){
 const previous=prior.loadHistory(directory); // Also verifies the immutable incomplete-browser complement.
 const name='authorized-increment-46-5/shared-r2-journal.jsonl',pin='045D88EBDBB665DEE68A839EA85D3666B70106149F0E6014722AFCB0D2E77392';
 const bytes=fs.readFileSync(path.join(directory,name));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),pin);
 const state=replay(bytes.toString('utf8'));assert.equal(state.sequence,121);
 assert.deepEqual(state.budget,{functionalRequests:518,cleanupRequests:68,applicationBytes:60523764,objectIntentions:24,completedObjects:23,multipartIntentions:3,unresolvedMultipart:0});
 const pins={...previous.pins,[name]:pin};
 return {...derive(state.budget),pins,source:JSON.stringify({pins,historicalBrowserTraffic:'UNKNOWN_NOT_RECONCILED',authorization:'VERIFIED_API_A_B_42_FUNCTIONAL_5_CLEANUP_PENDING'})};
}
function checkIncrement(value){for(const key of KEYS)assert(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=allowance[key],`increment:${key}`);return value;}
module.exports={allowance,derive,loadHistory,checkIncrement};
