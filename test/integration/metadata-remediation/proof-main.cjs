'use strict';
const fs=require('node:fs'),path=require('node:path');
async function main(){
 let db;const report={};
 try{
  db=await require('../http-oidc/fixture').databaseFixture(report);
  const proof=await require('./proof.cjs').run(db.central);
  const destination=path.join(__dirname,'../../../context/reviews/metadata-remediation-final-proof-20261106');
  fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(path.join(destination,'results.json'),JSON.stringify({...proof,postgres:report.postgres},null,2)+'\n');
  console.log('PASS '+proof.checks.join(', '));
 }finally{await db?.close();}
}
main().catch(error=>{console.error('METADATA_PROOF_FAILED',error.code||error.name);console.error(String(error.stack).split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,3).join('\n'));process.exitCode=1;});
