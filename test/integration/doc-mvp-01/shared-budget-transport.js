'use strict';
// This adapter never creates a client or owns credentials. Every physical SDK
// attempt must use maxAttempts=1; redirect following is disabled for signed GET.
function instrumentBudgetClient(client,budget,{objectIdFor=()=>undefined}={}) {
  const send=client.send.bind(client);
  return Object.freeze({config:client.config,async send(command,options){
    const attempts=typeof client.config?.maxAttempts==='function'?await client.config.maxAttempts():client.config?.maxAttempts;
    if(attempts!==1||client.config?.followRegionRedirects===true)throw new Error('BUDGET_RETRIES_FORBIDDEN');
    const operation=command.constructor.name.replace(/Command$/,''),input=command.input||{};
    let bytes=0;
    if(operation==='PutObject')bytes=input.ContentLength;
    if(operation==='GetObject'){
      const range=/^bytes=(\d+)-(\d+)$/.exec(input.Range||'');
      if(!range)throw new Error('BUDGET_GET_BOUND_REQUIRED');
      bytes=Number(range[2])-Number(range[1])+1;
    }
    return budget.perform(operation,bytes,()=>send(command,options),{objectId:objectIdFor(input)});
  }});
}
async function budgetFetch(budget,fetchFunction,url,{origin,expectedBytes,headers={}}){
  if(new URL(url).origin!==origin||!Number.isSafeInteger(expectedBytes)||expectedBytes<1)throw new Error('BUDGET_FETCH_SCOPE_INVALID');
  return budget.perform('GetObject',expectedBytes,async()=>{
    const response=await fetchFunction(url,{method:'GET',headers,redirect:'error'});
    return response;
  });
}
module.exports={instrumentBudgetClient,budgetFetch};
