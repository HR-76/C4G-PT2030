'use strict';
const {createBudgetClient}=require('./shared-r2-budget');
const crypto=require('node:crypto');
const budget=createBudgetClient({port:Number(process.env.PROOF_BUDGET_PORT),token:process.env.PROOF_BUDGET_TOKEN});
(async()=>{
  if(process.env.PROOF_MODE==='reserve-only'){
    await budget.call({action:'reserve',id:crypto.randomUUID(),operation:'HeadObject',bytes:0});
    process.exit(17);
  }
  if(process.env.PROOF_MODE==='send-then-die'){
    const id=crypto.randomUUID();await budget.call({action:'reserve',id,operation:'HeadObject',bytes:0});
    await budget.call({action:'STARTED',id});process.stdout.write('SENT\n');process.exit(18);
  }
  await budget.perform('HeadObject',0,async()=>{process.stdout.write('SENT\n');});
  process.stdout.write('CONFIRMED\n');
})().catch(error=>{process.stdout.write(`${error.code||'FAILED'}\n`);process.exitCode=1;});
