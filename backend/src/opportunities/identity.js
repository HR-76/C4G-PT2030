'use strict';
const crypto = require('node:crypto');
const { createUuidV7, isUuidV7 } = require('../audit/uuidV7');
const { OpportunityError } = require('./errors');
function createIdentityFactory({ clock = Date.now, randomBytes = crypto.randomBytes } = {}) { let last = -1; const issued = new Set(); return Object.freeze({ next() { const now=clock(); if(!Number.isSafeInteger(now)||now<0||now<last) throw new OpportunityError('OPPORTUNITY_INVALID_INPUT'); last=now; const id=createUuidV7({now:()=>now,randomBytes}); if(issued.has(id)) throw new OpportunityError('OPPORTUNITY_IDENTITY_REUSED'); issued.add(id); return id; }, owns(value){return isUuidV7(value)&&issued.has(value);} }); }
module.exports={createIdentityFactory};
