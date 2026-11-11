const PREFIX='c4g.criteria.intention.v1:'
const fields=['userId','organizationId','opportunityId','requestId','operation','resourceId']
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
function valid(v){return v&&Object.keys(v).length===fields.length&&Object.keys(v).every(k=>fields.includes(k))&&fields.filter(k=>k!=='operation').every(k=>uuid.test(v[k]))&&['SAVE_REVISION','CONFIRM'].includes(v.operation)}
export function saveIntention(v,storage=sessionStorage){if(!valid(v))throw Error('Invalid intention');storage.setItem(PREFIX+v.requestId,JSON.stringify(v))}
export function removeIntention(id,storage=sessionStorage){storage.removeItem(PREFIX+id)}
export function findIntention(identity,storage=sessionStorage){for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key.startsWith(PREFIX))continue;try{const v=JSON.parse(storage.getItem(key));if(valid(v)&&Object.entries(identity).every(([k,value])=>v[k]===value))return v}catch{}}return null}
