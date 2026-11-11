// Last answers the server confirmed for the current user and organization,
// kept in memory only, so a page already visited renders at once while it
// reads the same data again. A page always replaces what it shows with the new
// answer and removes it when the read is refused. Nothing here outlives a
// successful write, a logout, an expired session or a change of organization,
// and nothing is ever shown to another user or organization.
const held=new Map(),LIMIT=60
let epoch=0
const id=(scope,name)=>`${scope}\n${name}`
export const readScope=(userId,organizationId)=>`${userId||''}:${organizationId||''}`
export const confirmedReadsEpoch=()=>epoch
export function confirmedRead(scope,name){return held.get(id(scope,name))?.value??null}
// `since` is the epoch read before the request started: an answer that crossed
// a write or a logout is not kept.
export function keepConfirmedRead(scope,name,value,since=epoch){
 if(since!==epoch||value==null)return
 const key=id(scope,name);held.delete(key);held.set(key,{value})
 while(held.size>LIMIT)held.delete(held.keys().next().value)
}
export function dropConfirmedRead(scope,name){held.delete(id(scope,name))}
export function clearConfirmedReads(){held.clear();epoch++}
// One read by a page: what is already held, and how to keep or drop the new
// answer. Without a scope or a name (cursor pages, tests) nothing is kept.
export function startConfirmedRead(scope,name){
 const since=epoch,usable=Boolean(scope&&name)
 return {held:usable?confirmedRead(scope,name):null,
  keep:value=>{if(usable)keepConfirmedRead(scope,name,value,since)},drop:()=>{if(usable)dropConfirmedRead(scope,name)}}
}
