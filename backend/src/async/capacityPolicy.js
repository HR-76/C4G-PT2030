'use strict';

// Decision only: the caller must obtain pending and category from trusted state,
// and make the decision and reservation atomically in the same transaction.
function createCapacityPolicy({capacity,reserved}={}) {
 if(!Number.isSafeInteger(capacity)||capacity<1||!Number.isSafeInteger(reserved)||reserved<0||reserved>=capacity)
  throw new TypeError('Invalid durable queue capacity policy.');
 return Object.freeze({decide({pending,category}={}){
  if(!Number.isSafeInteger(pending)||pending<0||!['NORMAL','CRITICAL'].includes(category))
   throw new TypeError('Invalid durable queue capacity observation.');
  const ceiling=category==='CRITICAL'?capacity:capacity-reserved;
  return pending<ceiling?'ACCEPT':'RETRY_LATER';
 }});
}
module.exports={createCapacityPolicy};
