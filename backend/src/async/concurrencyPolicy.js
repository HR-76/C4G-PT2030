const { CAPS, DEFAULTS } = require('./constants');
function validateConcurrency(input = {}) { const out={...DEFAULTS,...input}; for (const k of Object.keys(CAPS)) if (!Number.isInteger(out[k]) || out[k]<1 || out[k]>CAPS[k]) throw new TypeError(`Invalid async concurrency: ${k}`); if (out.operationalReserve<0 || out.operationalReserve>=out.globalConcurrency) throw new TypeError('Invalid operational reserve.'); return Object.freeze(out); }
class FairScheduler {
  constructor(options) { this.options=validateConcurrency(options); this.queues=new Map(); this.cursor=0; }
  add(item) { const key=item.organizationId; if (!this.queues.has(key)) this.queues.set(key,[]); this.queues.get(key).push(item); }
  take(limit=this.options.globalConcurrency) { const keys=[...this.queues.keys()].sort(); const out=[]; while(out.length<limit && keys.length){ const key=keys[this.cursor%keys.length]; const q=this.queues.get(key); if(q.length) out.push(q.shift()); if(!q.length){this.queues.delete(key); keys.splice(this.cursor%keys.length,1);} else this.cursor=(this.cursor+1)%keys.length; } return out; }
}
class ConcurrencyLimiter {
  constructor(options){this.options=validateConcurrency(options);this.global=0;this.byType=new Map();this.byOrg=new Map();}
  tryAcquire({jobType,organizationId,operational=false}){const normalCap=this.options.globalConcurrency-this.options.operationalReserve;if(this.global>=this.options.globalConcurrency||(!operational&&this.global>=normalCap)||(this.byType.get(jobType)||0)>=this.options.typeConcurrency||(this.byOrg.get(organizationId)||0)>=this.options.organizationConcurrency)return null;this.global++;this.byType.set(jobType,(this.byType.get(jobType)||0)+1);this.byOrg.set(organizationId,(this.byOrg.get(organizationId)||0)+1);let released=false;return Object.freeze({release:()=>{if(released)return false;released=true;this.global--;this.byType.set(jobType,this.byType.get(jobType)-1);this.byOrg.set(organizationId,this.byOrg.get(organizationId)-1);return true;}});}
}
module.exports = { ConcurrencyLimiter, FairScheduler, validateConcurrency };
