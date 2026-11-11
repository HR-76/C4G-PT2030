'use strict';
// Read-only diagnostic against the explicitly created disposable fixture only.
const {Pool}=require('../../../backend/node_modules/pg');
async function run(){
 if(process.env.F13_EDITORIAL_DISPOSABLE_PROOF!=='C4G_F13_EDITORIAL_DISPOSABLE_V1'||!process.env.PQ1_DIAGNOSTIC_PASSWORD)throw Error('DISPOSABLE_PROOF_REQUIRED');
 const pool=new Pool({host:'127.0.0.1',port:5590,database:'c4g_f13_editorial_0',user:'c4g_f12_admin',password:process.env.PQ1_DIAGNOSTIC_PASSWORD});
 const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const row=(await c.query("SELECT * FROM organization_profile.profile_draft WHERE lifecycle='DRAFT' ORDER BY head_revision DESC LIMIT 1")).rows[0];
  await c.query("SELECT set_config('app.organization_id',$1,true)",[row.organization_id]);
  const history=await require('../../../backend/src/organizationalProfile/editorialSource').loadEditorialHistory(c,row.organization_id,row.draft_id,Number(row.head_revision));
  const extracted=await require('../../../backend/src/organizationalProfile/pq1Source').loadPq1Material(c,row.organization_id,history.at(-1),new Date().toISOString());
  let authorsError=null;try{require('../../../backend/src/organizationalProfile/pq1Material').deriveAuthors(history,history[0].actorSubjectId,extracted.content);}catch(error){if(error instanceof TypeError&&error.message.startsWith('F13 canonical'))authorsError=error.message;else throw error;}
  console.log(JSON.stringify({revision:Number(row.head_revision),collections:Object.fromEntries(['items','assertions','experiences','links','verifications'].map(k=>[k,extracted.content[k].length])),materialBytes:Buffer.byteLength(JSON.stringify(extracted.content)),historyBytes:Buffer.byteLength(JSON.stringify(history)),canonicalLimit:262144,authorsError,diagnosticOnly:true}));
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
}
run().catch(error=>{console.error(error.code||error.name);process.exitCode=1;});
