import {clearDirectoryCache} from './directoryCache'
const PREFIX='c4g.directory.intention.v1:'
export const directoryIntentKey=(userId,organizationId)=>`${PREFIX}${userId}:${organizationId}`
export function clearDirectoryIntentions(storage=sessionStorage){
 clearDirectoryCache()
 try{for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(PREFIX))storage.removeItem(key)}}catch{/* Logout remains authoritative. */}
}
