'use strict';
const {isAuthorityCoordinator}=require('../security/authorityCoordinator');
const {uuid}=require('./contracts');
const queries=require('./responsibleQueries');
function rows(result,limit,names){
 if(!result||!Array.isArray(result.rows)||result.rowCount!==result.rows.length||result.rows.length>limit)throw Error('RESPONSIBLE_RESULT_INVALID');
 let previous=null;
 for(const row of result.rows){
  const keys=names?['display_name','membership_id']:['membership_id'];
  if(!row||Object.keys(row).sort().join()!==keys.join()||typeof row.membership_id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(row.membership_id)||
   (names&&typeof row.display_name!=='string')||(previous&&previous>=row.membership_id))throw Error('RESPONSIBLE_RESULT_INVALID');
  previous=row.membership_id;
 }
 return result.rows;
}
function createResponsibleAuthority({coordinator,organizationId,assertAuthorized}){
 if(!isAuthorityCoordinator(coordinator)||typeof assertAuthorized!=='function')throw TypeError('Responsible authority and guard required');
 const org=uuid(organizationId);
 async function read(sql,parameters,limit,names){
  await assertAuthorized();
  return coordinator.withAuthority(async()=>rows(await coordinator.pool.query(sql,[org,...parameters]),limit,names));
 }
 return Object.freeze({
  async list(cursor=null){
   if(cursor!==null)cursor=uuid(cursor);
   const found=await read(queries.list,[cursor],26,true);
   if(cursor&&found.some(row=>row.membership_id<=cursor))throw Error('RESPONSIBLE_RESULT_INVALID');
   return {items:found.slice(0,25).map(row=>({membershipId:row.membership_id,name:row.display_name})),nextCursor:found.length>25?found[24].membership_id:null};
  },
  async validate(id){
   id=uuid(id);const found=await read(queries.validate,[id],1,false);
   if(found.length&&found[0].membership_id!==id)throw Error('RESPONSIBLE_RESULT_INVALID');
   return found.length===1;
  },
  async names(ids){
   if(!Array.isArray(ids)||ids.length>10000)throw Error('RESPONSIBLE_INPUT_INVALID');
   const unique=[...new Set(ids.map(uuid))],result=new Map();
   for(let offset=0;offset<unique.length;offset+=100){
    const batch=unique.slice(offset,offset+100),found=await read(queries.names,[batch],100,true);
    for(const row of found){if(!batch.includes(row.membership_id))throw Error('RESPONSIBLE_RESULT_INVALID');result.set(row.membership_id,row.display_name);}
   }
   return result;
  }
 });
}
module.exports={createResponsibleAuthority,validateResponsibleRows:rows};
