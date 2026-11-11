'use strict';
const {fail}=require('./contracts');
const requested=input=>['unitIds','sourceInterestId','sourceInterestRevision','includeResponsibleInTeam'].some(key=>Object.hasOwn(input,key));
const helpers=()=>require('../opportunityInterests/repository');
async function currentUnits(client,org,id){
 const ids=(await client.query('SELECT scope_id FROM opportunity_catalog.application_unit WHERE organization_id=$1 AND application_id=$2 AND active ORDER BY scope_id',[org,id])).rows.map(r=>r.scope_id);
 return {unitIds:ids,units:await helpers().unitsForIds(client,org,ids)};
}
async function hydratePageUnits(client,org,rows){
 // Only receive the already authorized page; old schemas have no unit columns.
 const page=rows.filter(row=>Object.hasOwn(row,'source_interest_id'));
 if(!page.length)return rows;
 const byApplication=new Map(page.map(row=>[row.application_id,[]]));
 const links=(await client.query('SELECT application_id,scope_id FROM opportunity_catalog.application_unit WHERE organization_id=$1 AND application_id=ANY($2::uuid[]) AND active ORDER BY application_id,scope_id',[org,[...byApplication.keys()]])).rows;
 for(const link of links)byApplication.get(link.application_id)?.push(link.scope_id);
 const ids=[...new Set(links.map(link=>link.scope_id))];
 const directory=new Map((await helpers().unitsForIds(client,org,ids)).map(unit=>[unit.unitId,unit]));
 return rows.map(row=>{
  const unitIds=byApplication.get(row.application_id);
  return unitIds?{...row,unit_ids:unitIds,units:unitIds.map(id=>directory.get(id))}:row;
 });
}
async function prepare(client,org,input,{current=null,centralCurrent=null}={}){
 if(!requested(input)&&!current)return null;
 await helpers().acquireUnitTreeLock(client,org);
 if(input.sourceInterestId){
  await helpers().loadInterestForConversion(client,{organizationId:org,interestId:input.sourceInterestId,expectedRevision:input.sourceInterestRevision,opportunityId:input.opportunityId,centralRevisionId:input.centralRevisionId});
  if(!centralCurrent)fail('RESOURCE_NOT_AVAILABLE');
  const latest=await centralCurrent(input.opportunityId);
  if(latest.revisionId!==input.centralRevisionId)fail('STALE_OPPORTUNITY_REVISION');
 }
 const existing=current?await currentUnits(client,org,current.application_id):{unitIds:[],units:[]};
 if(!Object.hasOwn(input,'unitIds'))return existing;
 await helpers().validateUnitIds(client,org,input.unitIds,{existingIds:existing.unitIds});
 return {unitIds:input.unitIds,units:await helpers().unitsForIds(client,org,input.unitIds)};
}
async function storeUnits(client,org,id,ids){
 await client.query('UPDATE opportunity_catalog.application_unit SET active=false WHERE organization_id=$1 AND application_id=$2 AND active AND NOT(scope_id=ANY($3::uuid[]))',[org,id,ids]);
 for(const unitId of ids)await client.query('INSERT INTO opportunity_catalog.application_unit(organization_id,application_id,scope_id) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM opportunity_catalog.application_unit WHERE organization_id=$1 AND application_id=$2 AND scope_id=$3 AND active) ON CONFLICT(organization_id,application_id,scope_id) DO UPDATE SET active=true',[org,id,unitId]);
}
async function includeResponsible(client,org,id,membershipId,actor){
 // Only called for a freshly created application after cumulative APPLICATION_WORK_EDIT authorization.
 await client.query('INSERT INTO opportunity_catalog.application_work(organization_id,application_id,revision) VALUES($1,$2,2)',[org,id]);
 await client.query('INSERT INTO opportunity_catalog.application_participant(organization_id,application_id,membership_id) VALUES($1,$2,$3)',[org,id,membershipId]);
 await client.query("INSERT INTO opportunity_catalog.application_work_change(organization_id,application_id,revision,kind,membership_id,actor_subject_id) VALUES($1,$2,2,'PARTICIPANT_ADDED',$3,$4)",[org,id,membershipId,actor.id]);
}
module.exports={requested,currentUnits,hydratePageUnits,prepare,storeUnits,includeResponsible};
