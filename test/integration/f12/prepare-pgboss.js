'use strict';
async function main(){
 const {PgBoss}=await import('../../../backend/node_modules/pg-boss/dist/index.js');
 const boss=new PgBoss({connectionString:process.env.F9_TEST_DATABASE_URL,schema:'pgboss',createSchema:true,migrate:true,supervise:false,schedule:false});
 await boss.start({supervise:false,schedule:false});
 try{/* start() performs the disposable, package-pinned migration. */}
 finally{await boss.stop({graceful:true,timeout:30000});}
}
main().catch(error=>{process.stderr.write(`${error.code||error.name}: ${error.message}\n`);process.exitCode=1;});
