// Last directory context, units and first page of people confirmed by the
// server for the current user and organization, kept in memory only. It lets
// the three organization pages render at once when the user moves between
// them; every entry still reads them again and replaces or discards what is
// shown. It never outlives a failed read, a save, a logout or a change of user
// or organization.
let held=null,epoch=0
const flights=new Map()
export const directoryCacheKey=(userId,organizationId)=>`${userId}:${organizationId}`
export const peopleQueryKey=query=>JSON.stringify([query.search||'',query.status||'',query.unitId||'',query.areaId||'',query.interestAreaId||''])
export const defaultPeopleQuery=Object.freeze({search:'',status:'ACTIVE',unitId:''})
// Only an entry holding a confirmed context is usable.
export function readDirectoryCache(key){return held?.key===key&&held.context?held:null}
export function writeDirectoryCache(key,patch){held={...(held?.key===key?held:{}),...patch,key}}
export function clearDirectoryCache(){held=null;epoch++;flights.clear()}
export const directoryCacheEpoch=()=>epoch
// Keeps `patch` only if nothing was discarded since `since` was read.
export function keepDirectoryRead(key,since,patch){if(since===epoch&&readDirectoryCache(key))writeDirectoryCache(key,patch)}
// One request serves a background read and the page that needs the same data.
export function sharedDirectoryRead(key,name,start){
 const id=`${key}\n${name}`;let flight=flights.get(id)
 if(!flight){flight=Promise.resolve().then(start).finally(()=>{if(flights.get(id)===flight)flights.delete(id)});flights.set(id,flight)}
 return flight
}
