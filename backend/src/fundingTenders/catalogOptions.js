'use strict';
const {PROGRAMMES}=require('./programmeTaxonomy');
function catalogueProgrammes(observed=[]){
 return [...new Set([...observed,...Object.values(PROGRAMMES).map(p=>p.label)])].sort((a,b)=>a.localeCompare(b,'pt'));
}
const sourceNamespaces=source=>source==='PORTUGAL2030'?['PORTUGAL2030_PLAN','PORTUGAL2030_NOTICE']:[source];
module.exports={catalogueProgrammes,sourceNamespaces};
