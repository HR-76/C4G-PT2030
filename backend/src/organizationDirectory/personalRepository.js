'use strict';
const {fail}=require('./contracts');
const {areas,version}=require('./thematicAreas');
const projection=r=>({biography:r?.biography||'',keywords:r?.keywords||'',areaIds:r?.area_ids||[],
 membershipId:r?.membership_id||null,revision:Number(r?.revision||0)});
function createPersonalRepository({org,actor,guarded,receipt,finish,memberships,authorize,root,supportsStrategy}){
 const project=row=>({...projection(row),...(supportsStrategy?{interestAreaIds:row?.interest_area_ids||[]}: {})});
 async function personId(client,id,self){
  if(!self)return id;
  const row=(await client.query('SELECT person_id FROM organizational_scope.person_profile WHERE organization_id=$1 AND membership_id=$2',[org,actor.membershipId])).rows[0];
  return row?.person_id||null;
 }
 async function read(client,id,self=false){
  await guarded(self?'self':'person',null,id||org,[],null,self?'PERSONAL_PROFILE_READ':null);
  id=await personId(client,id,self);
  if(!id){if(self)return {person:null,areas,areaCatalogVersion:version};fail('RESOURCE_NOT_AVAILABLE');}
  const row=(await client.query('SELECT * FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[org,id])).rows[0];
  if(!row||self&&!row.active)fail('RESOURCE_NOT_AVAILABLE');
  const profile=(await client.query('SELECT * FROM organizational_scope.person_profile WHERE organization_id=$1 AND person_id=$2',[org,id])).rows[0];
  const units=(await client.query(`SELECT s.scope_id AS "scopeId",s.label,u.is_primary AS "isPrimary"
   FROM organizational_scope.person_unit u JOIN organizational_scope.scope s USING(organization_id,scope_id)
   WHERE u.organization_id=$1 AND u.person_id=$2 ORDER BY u.is_primary DESC,s.label`,[org,id])).rows;
  const availableUnits=self?(await client.query(`SELECT scope_id AS "scopeId",label FROM organizational_scope.scope
   WHERE organization_id=$1 AND scope_type='UNIT' AND lifecycle='ACTIVE' ORDER BY label,scope_id LIMIT 201`,[org])).rows:null;
  return {person:{personId:id,name:row.name,email:row.email,functionLabel:row.function_label,active:row.active},profile:project(profile),units,...(self?{availableUnits}:{}),
   areas,areaCatalogVersion:version,permissions:{edit:await authorize(self?'PERSONAL_PROFILE_EDIT':'ORGANIZATION_DIRECTORY_EDIT',root)}};
 }
 async function write(client,method,input,id){
  const self=method==='selfEdit';
  id=await personId(client,id,self);if(!id)fail('RESOURCE_NOT_AVAILABLE');
  await guarded(method,input,id,[],null,self?'PERSONAL_PROFILE_EDIT':null);
  if(Object.hasOwn(input,'interestAreaIds')&&!supportsStrategy)fail('RESOURCE_NOT_AVAILABLE');
  const prior=await receipt(client,method,input,id);if(prior.previous)return prior.previous;
  const person=(await client.query('SELECT active FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2 FOR UPDATE',[org,id])).rows[0];
  if(!person||self&&!person.active)fail('RESOURCE_NOT_AVAILABLE');
  const current=(await client.query('SELECT * FROM organizational_scope.person_profile WHERE organization_id=$1 AND person_id=$2 FOR UPDATE',[org,id])).rows[0];
  if(Number(current?.revision||0)!==input.expectedRevision)fail('STALE_REVISION');
  const next={...project(current),...input};
  if(method==='personLinkEdit'&&input.membershipId!==null){
   const member=(await memberships()).find(m=>m.membershipId===input.membershipId);
   if(!member||!['ACTIVE','SUSPENDED'].includes(member.status))fail('MEMBERSHIP_UNAVAILABLE');
  }
  if(self&&Object.hasOwn(input,'name')){
   // The person changes her own name, function and units. Units must be active units of this organization.
   if(input.unitIds.length){
    const found=(await client.query(`SELECT scope_id FROM organizational_scope.scope WHERE organization_id=$1 AND scope_type='UNIT' AND lifecycle='ACTIVE' AND scope_id=ANY($2::uuid[]) FOR SHARE`,[org,input.unitIds])).rows.length;
    if(found!==input.unitIds.length)fail('RESOURCE_NOT_AVAILABLE');
   }
   await client.query('UPDATE organizational_scope.person SET name=$3,function_label=$4 WHERE organization_id=$1 AND person_id=$2',[org,id,input.name,input.functionLabel]);
   await client.query('DELETE FROM organizational_scope.person_unit WHERE organization_id=$1 AND person_id=$2',[org,id]);
   if(input.unitIds.length)await client.query('INSERT INTO organizational_scope.person_unit(organization_id,person_id,scope_id,is_primary) SELECT $1,$2,u,(u=$4::uuid) FROM unnest($3::uuid[]) AS u',[org,id,input.unitIds,input.primaryUnitId]);
  }
  const saved=(await client.query(`INSERT INTO organizational_scope.person_profile(organization_id,person_id,membership_id,biography,keywords,area_ids,updated_by${supportsStrategy?',interest_area_ids':''})
   VALUES($1,$2,$3,$4,$5,$6,$7${supportsStrategy?',$8':''}) ON CONFLICT(organization_id,person_id) DO UPDATE SET membership_id=$3,biography=$4,keywords=$5,
   area_ids=$6${supportsStrategy?',interest_area_ids=$8':''},revision=person_profile.revision+1,updated_at=transaction_timestamp(),updated_by=$7 RETURNING *`,
   [org,id,next.membershipId,next.biography,next.keywords,next.areaIds,actor.id,...(supportsStrategy?[next.interestAreaIds]:[])])).rows[0];
  return finish(client,method,input,id,prior.digest,{personId:id,...project(saved)});
 }
 async function members(client){await guarded('memberships',null,org,[],null,'ORGANIZATION_DIRECTORY_EDIT');return {items:await memberships(),canManage:await authorize('ORGANIZATION_MEMBERSHIP_MANAGE',root)};}
 return {read,write,members};
}
module.exports={createPersonalRepository};
