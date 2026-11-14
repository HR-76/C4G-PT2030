'use strict';
const scope = require('../organizationalScopes/contracts');
function fail(code='INVALID_INPUT'){throw Object.assign(new Error(code),{code});}
function uuid(value){if(!scope.uuid(value))fail();return value;}
function exact(value,keys){if(!scope.exact(value,keys))fail();}
function text(value,max,required=false){
 if(typeof value!=='string'||value.length>max||value!==value.trim()||value!==value.normalize('NFC')||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||(required&&!value))fail();return value;
}
function email(value){text(value,254);if(value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))fail();return value;}
function revision(value,min=1){if(!Number.isSafeInteger(value)||value<min)fail();return value;}
function areaIds(values){
 const {ids}=require('./thematicAreas');
 if(!Array.isArray(values)||values.length>30||new Set(values).size!==values.length||values.some(id=>!ids.has(id)))fail();
 return [...values].sort();
}
function parseStrategy(raw){
 exact(raw,['areaIds','interests','objectives','expectedRevision','idempotencyKey']);
 revision(raw.expectedRevision,0);uuid(raw.idempotencyKey);
 const selected=areaIds(raw.areaIds);
 if(!Array.isArray(raw.interests)||raw.interests.length>30||new Set(raw.interests).size!==raw.interests.length)fail();
 const interests=raw.interests.map(value=>text(value,256,true));
 if(!Array.isArray(raw.objectives)||raw.objectives.length>30)fail();
 const objectives=raw.objectives.map(objective=>{
  exact(objective,['id','title','target','deadline','areaIds']);
  const {id,title,target,deadline}=objective;
  uuid(id);text(title,256,true);text(target,1000);
  if(deadline!==null){
   if(typeof deadline!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||deadline.startsWith('0000-'))fail();
   const date=new Date(deadline);
   if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==deadline)fail();
  }
  const related=areaIds(objective.areaIds);
  if(related.some(area=>!selected.includes(area)))fail();
  return {id,title,target,deadline,areaIds:related};
 });
 if(new Set(objectives.map(objective=>objective.id)).size!==objectives.length)fail();
 return Object.freeze({...raw,areaIds:selected,interests,objectives});
}
function parse(method,raw){
 // Existing hierarchies remain readable; the directory no longer changes parents.
 if(method==='unitMove')fail();
 if(['context','units','person','self','memberships','areas'].includes(method)){exact(raw,[]);return {};}
 if(method==='descriptionEdit'){
  exact(raw,['description','expectedRevision','idempotencyKey']);text(raw.description,4000);revision(raw.expectedRevision,0);uuid(raw.idempotencyKey);return Object.freeze({...raw});
 }
 if(method==='strategyEdit')return parseStrategy(raw);
 if(['personProfileEdit','selfEdit','personLinkEdit'].includes(method)){
  const link=method==='personLinkEdit',hasInterests=!link&&raw&&Object.hasOwn(raw,'interestAreaIds');
  exact(raw,[...(link?['membershipId']:['biography','keywords','areaIds',...(hasInterests?['interestAreaIds']:[])]),'expectedRevision','idempotencyKey']);
  uuid(raw.idempotencyKey);revision(raw.expectedRevision,0);
  if(link){if(raw.membershipId!==null)uuid(raw.membershipId);}else{
   text(raw.biography,4000);text(raw.keywords,1000);
   return Object.freeze({...raw,areaIds:areaIds(raw.areaIds),...(hasInterests?{interestAreaIds:areaIds(raw.interestAreaIds)}:{})});
  }
  return Object.freeze({...raw});
 }
 if(method==='people'||method==='peopleWithResearchAreas'){
  const areaFilters=method==='people'?['areaId','interestAreaId']:['areaId'];
  if(!raw||Object.keys(raw).some(k=>!['search','unitId','status','cursor',...areaFilters].includes(k)))fail();
  const input={search:text(raw.search||'',100),unitId:raw.unitId?uuid(raw.unitId):null,status:raw.status||'ACTIVE',cursor:raw.cursor||null};
  for(const key of areaFilters){
   const value=raw[key];
   if(value===undefined||value==='')continue;
   if(!require('./thematicAreas').ids.has(value))fail();
   input[key]=value;
  }
  if(!['ACTIVE','INACTIVE','ALL'].includes(input.status)||input.cursor!==null&&(typeof input.cursor!=='string'||input.cursor.length>4000))fail();return input;
 }
 const fields={profileEdit:['description','email','website'],unitCreate:['label','parentScopeId','stableCode'],unitRename:['label'],unitMove:['parentScopeId'],personCreate:['name','email','functionLabel','active','unitIds','primaryUnitId'],personEdit:['name','email','functionLabel','active','unitIds','primaryUnitId']}[method];
 if(!fields)fail();
 const create=method.endsWith('Create');exact(raw,[...fields,'idempotencyKey',...(create?[]:['expectedRevision'])]);uuid(raw.idempotencyKey);
 if(!create)revision(raw.expectedRevision,method==='profileEdit'?0:1);
 if(method==='profileEdit'){
  text(raw.description,4000);email(raw.email);text(raw.website,500);
  if(raw.website){let u;try{u=new URL(raw.website)}catch{fail()};if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail();}
 }else if(method.startsWith('unit')){
  if('label'in raw&&!scope.label(raw.label))fail();
  if(method==='unitCreate'&&raw.parentScopeId!==null)fail();
  if('stableCode'in raw&&!scope.stableCode(raw.stableCode))fail();
 }else{
  if(!scope.label(raw.name))fail();email(raw.email);text(raw.functionLabel,256);
  if(typeof raw.active!=='boolean'||!Array.isArray(raw.unitIds)||raw.unitIds.length>50||new Set(raw.unitIds).size!==raw.unitIds.length)fail();raw.unitIds.forEach(uuid);
  if(raw.unitIds.length? !raw.unitIds.includes(raw.primaryUnitId):raw.primaryUnitId!==null)fail();
 }
 return Object.freeze({...raw,...(raw.unitIds?{unitIds:[...raw.unitIds].sort()}: {})});
}
module.exports={parse,uuid,fail};
