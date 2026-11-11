'use strict';
const SHA=/^[a-f0-9]{64}$/;
const SOURCE='EU_FUNDING_TENDERS';
const EXTERNAL='CASCADE:11145';
function fail(code){throw Object.assign(new Error(code),{code});}

// Runs only inside the existing authority/approval transaction, including the
// accepted writer's final verification and receipt replay. The collector proof
// distinguishes a real bounded collection from a legacy or fixture run.
async function verifyExecutor11145Plan(client,row,planDigest){
 if(!SHA.test(planDigest)||row.plan_digest!==planDigest)fail('OPPORTUNITY_V2_APPROVAL_STALE');
 const archive=row.archive_locator;
 if(row.source_code!==SOURCE||!row.expected||archive?.kind!=='FUNDING'||archive.externalIdentifier!==EXTERNAL
   ||Object.keys(archive).length!==3)fail('OPPORTUNITY_V2_11145_SCOPE_INVALID');
 const collected=await require('./collector11145').verifyCollector11145Run(client,{runId:archive.runId,actorId:row.prepared_by});
 if(collected.opportunityId!==row.expected.opportunityId||collected.archive?.kind!=='FUNDING'
   ||collected.archive.runId!==archive.runId||collected.archive.externalIdentifier!==EXTERNAL
   ||collected.payloadDigest!==row.archive_digest)fail('OPPORTUNITY_V2_11145_SCOPE_INVALID');
 return collected;
}
module.exports={verifyExecutor11145Plan};
