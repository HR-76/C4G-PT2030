'use strict';
const {NEXT,currentStatus,fail,uuid}=require('./contracts');
const SORTS=['title','opportunityTitle','status','statusChangedAt','responsibleName','totalBudget','organizationBudget','opportunityClosingDate'];
function parse(value){
 if(Object.keys(value).some(k=>!['q','status','sort','direction','opportunityId','unitId','cursor'].includes(k))||Object.values(value).some(v=>typeof v!=='string'))fail();
 const q=(value.q||'').trim(),status=currentStatus(value.status)||null,sort=value.sort||'title',direction=value.direction||'asc';
 if(q.length>200||status&&!Object.hasOwn(NEXT,status)||!SORTS.includes(sort)||!['asc','desc'].includes(direction)||value.cursor?.length>4096)fail();
 return {q,status,sort,direction,opportunityId:value.opportunityId?uuid(value.opportunityId):null,cursor:value.cursor||null,...(value.unitId?{unitId:value.unitId==='NONE'?'NONE':uuid(value.unitId)}:{})};
}
module.exports={parse};
