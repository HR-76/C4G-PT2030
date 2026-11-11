'use strict';
// Labels already used by canonical call nature and catalogue presentation.
const OPPORTUNITY_TYPES=Object.freeze(['Concurso','Convite','Financiamento em cascata','Aviso planeado']);
function manualPresentation(snapshot){
 return snapshot.opportunityType?{presentation:{typification:{value:snapshot.opportunityType,source:'editorial',sourceUrl:null,sourcePointer:'/opportunityType'}}}:null;
}
module.exports={OPPORTUNITY_TYPES,manualPresentation};
