'use strict';
const assert=require('node:assert/strict');
const {frozenSnapshotExpressions}=require('../../../backend/src/applications/opportunitySnapshot');
const date=value=>({at:{precision:'DATE',value}}),instant=value=>({at:{precision:'INSTANT',value}});
const period=(start,end)=>({at:{precision:'PERIOD',start,end,periodKind:'CUSTOM',label:'Synthetic period'}});
const snapshot=deadlines=>({schemaVersion:2,schedule:{deadlines:{state:'PRESENT',value:deadlines}}});
module.exports=async function parity(pool,report){
 const cases=[null,{schemaVersion:1,title:'Legacy',closingDate:'2026-11-09'},snapshot([]),
  snapshot([date('2026-11-09')]),snapshot([date('0000-02-29')]),snapshot([instant('0000-02-29T23:59:59.999Z')]),
  snapshot([date('2026-11-09'),date('2026-11-09')]),snapshot([date('2026-11-09'),{...date('2026-11-09'),phase:'SECOND'}]),
  snapshot([date('2026-11-09'),date('2026-11-10')]),snapshot([instant('2026-03-29T00:59:59.999Z'),instant('2026-03-29T01:00:00.000Z')]),
  snapshot([period('2026-11-01','2026-11-30'),date('2026-11-10')]),snapshot([period('2026-11-01','2026-11-30'),date('2026-12-01')]),
  {schemaVersion:2,schedule:{deadlines:{state:'CONFLICT',value:null},plannedClosing:{state:'PRESENT',value:{precision:'DATE',value:'2027-01-01'}}}},
  {schemaVersion:2,schedule:{deadlines:{state:'NOT_COLLECTED',value:null}}}];
 const old=frozenSnapshotExpressions('a.central_snapshot'),current=frozenSnapshotExpressions('a.central_snapshot',{finalDeadlineOnly:true});
 const sql=expression=>`SELECT ${expression.deadline} AS deadline,v2_schedule.final_deadline_at FROM (SELECT $1::jsonb AS central_snapshot) a ${expression.join}`;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const timezone of ['UTC','Europe/Lisbon']){
   await client.query("SELECT set_config('TimeZone',$1,true)",[timezone]);
   for(const value of cases){const a=(await client.query(sql(old),[value])).rows,b=(await client.query(sql(current),[value])).rows;assert.deepEqual(b,a);}
  }
  report.checks.push({temporalParity:cases.length*2,timezones:['UTC','Europe/Lisbon'],includes:['legacy','absent','duplicate','phase','ambiguous period','year zero','DST']});
 }finally{await client.query('ROLLBACK');client.release();}
};
