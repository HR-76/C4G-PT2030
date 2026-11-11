const {RETENTION_MS}=require('./constants');
function cutoffs(now=new Date()){const at=now.getTime();return Object.freeze(Object.fromEntries(Object.entries(RETENTION_MS).map(([k,v])=>[k,new Date(at-v)])));}
module.exports={cutoffs};
