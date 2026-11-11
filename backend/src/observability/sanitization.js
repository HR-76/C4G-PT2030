'use strict';
const PROHIBITED=/(password|secret|token|cookie|authorization|session|claim|credential|dsn|connection|string|signed.?url|object.?key|filename|email|payload|body|query|stack|message|organization|tenant|user|resource|job|document|cause)/i;
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
function safeString(v){const s=String(v).normalize('NFC');return Buffer.byteLength(s)>256?Buffer.from(s).subarray(0,256).toString('utf8'):s;}
function sanitizeAttributes(input,allowed,depth=0,seen=new WeakSet()){if(input==null)return {};if(typeof input!=='object'||depth>4||seen.has(input))return {};seen.add(input);const out={};for(const key of Object.keys(input)){if(Object.keys(out).length>=24||!allowed.includes(key)||PROHIBITED.test(key))continue;const value=input[key];if(['string','number','boolean'].includes(typeof value)){const clean=typeof value==='string'?safeString(value):value;if(typeof clean==='string'&&(UUID.test(clean)||PROHIBITED.test(clean)))continue;out[key]=clean;}else if(value&&typeof value==='object'&&depth<4)out[key]=sanitizeAttributes(value,allowed,depth+1,seen);}return out;}
function sanitizeError(error){const code=error&&typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)?error.code:'INTERNAL_ERROR';return Object.freeze({errorCode:code});}
module.exports={sanitizeAttributes,sanitizeError,PROHIBITED};
