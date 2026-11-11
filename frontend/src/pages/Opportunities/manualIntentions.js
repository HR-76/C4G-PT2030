const PREFIX='c4g.central-manual.intention.v1:'
const FIELDS=['title','funderName','programmeName','summary','callReference','officialUrl','openingDate','closingDate','fundingAmountMin','fundingAmountMax','currencyCode','geographySummary','eligibleGroups','eligibilitySummary','opportunityType','interventionArea']
const CALL_TEXT_LIMITS={geographySummary:2000,eligibleGroups:4000,eligibilitySummary:4000}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
function validate(value,userId){
 if(!value || !userId || value.userId!==userId || Object.keys(value).some(key=>!['userId','requestId','fields','receipt'].includes(key))
  || !uuid.test(value.requestId) || !value.fields || Array.isArray(value.fields)
  || Object.keys(value.fields).some(key=>!FIELDS.includes(key)) || Object.values(value.fields).some(field=>typeof field!=='string')
  || Object.entries(CALL_TEXT_LIMITS).some(([key,limit])=>value.fields[key]?.length>limit)
  || (value.receipt && (Object.keys(value.receipt).some(key=>key!=='opportunityId') || !uuid.test(value.receipt.opportunityId)))) throw Error('Invalid manual recovery intention')
 return value
}
export function readManualIntention(userId,storage=sessionStorage){
 if(!userId)throw Error('Missing actor')
 const raw=storage.getItem(PREFIX+userId)
 return raw===null?null:validate(JSON.parse(raw),userId)
}
export function saveManualIntention(value,storage=sessionStorage){
 validate(value,value?.userId)
 storage.setItem(PREFIX+value.userId,JSON.stringify(value))
}
export function removeManualIntention(userId,storage=sessionStorage){storage.removeItem(PREFIX+userId)}
