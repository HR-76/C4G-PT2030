'use strict';
const statuses={INVALID_QUERY:400,INVALID_CURSOR:400,INVALID_SNAPSHOT:400,SESSION_REQUIRED:401,ACCESS_DENIED:403,SNAPSHOT_SCOPE_MISMATCH:403,OPPORTUNITY_NOT_FOUND:404,RESOURCE_NOT_FOUND:404,CURSOR_CONTEXT_MISMATCH:409,SNAPSHOT_EXPIRED:410,SNAPSHOT_UNAVAILABLE:410,FILTER_VALUE_UNKNOWN:422,CATALOG_UNAVAILABLE:503,PROJECTION_ITEM_TOO_LARGE:503,INTERNAL_ERROR:500};
function fail(code){throw Object.assign(new Error(code),{code,status:statuses[code]||500});}
function errorResponse(error,requestId){const code=Object.hasOwn(statuses,error.code)?error.code:'INTERNAL_ERROR';return {status:statuses[code],body:{error:{code,message:code==='SESSION_REQUIRED'?'É necessária uma sessão válida.':'Não foi possível concluir a leitura.',requestId,fields:[],retryable:code==='CATALOG_UNAVAILABLE'}}};}
module.exports={fail,errorResponse};
