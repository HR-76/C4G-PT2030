'use strict';
const {PACKAGE_ID,CENTRAL_BASELINE,entry}=require('../src/security/platformAccountLifecycleMigrationPackage');
// Explicit maintenance entrypoint. Never provisions or changes runtime logins.
async function install(pool,{expectedDatabase,apply=false}={}){
 if(typeof expectedDatabase!=='string'||!/^[a-z][a-z0-9_]{2,62}$/.test(expectedDatabase)||/staging/i.test(expectedDatabase))throw Error('PRODUCTION_TARGET_REQUIRED');
 if(typeof apply!=='boolean')throw Error('PRODUCTION_ARGUMENT_INVALID');
 if((await pool.query('SELECT current_database() AS name')).rows[0]?.name!==expectedDatabase)throw Error('PRODUCTION_TARGET_MISMATCH');
 const {currentVersion}=await require('../src/security/centralMigrationPreflight').preflightCentral(pool);
 if(![CENTRAL_BASELINE,entry.version].includes(currentVersion))throw Error('PLATFORM_ACCOUNT_LIFECYCLE_BASELINE_REQUIRED');
 const plan={apply,package:PACKAGE_ID,currentVersion,targetVersion:entry.version};
 if(!apply)return plan;
 const applied=await require('./runCentralMigrations').applyRegisteredPlatformAccountLifecyclePackage(pool,PACKAGE_ID);
 return {...plan,applied};
}
function parseArguments(args){
 const options={};
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(!['--apply','--expected-database'].includes(key)||Object.hasOwn(options,key))throw Error('PRODUCTION_ARGUMENT_INVALID');
  if(key==='--apply')options[key]=true;
  else {if(!args[i+1]||args[i+1].startsWith('--'))throw Error('PRODUCTION_ARGUMENT_INVALID');options[key]=args[++i];}
 }
 return {expectedDatabase:options['--expected-database'],apply:options['--apply']===true};
}
async function main(){
 const options=parseArguments(process.argv.slice(2));
 if(!process.env.PRODUCTION_INSTALL_DATABASE_URL)throw Error('PRODUCTION_INSTALL_DATABASE_REQUIRED');
 const pool=new (require('pg').Pool)({...require('../src/config/databaseConfig').databasePoolOptions(process.env,'PRODUCTION_INSTALL_DATABASE_URL','CENTRAL_DB'),max:1});
 try{process.stdout.write(JSON.stringify(await install(pool,options))+'\n');}finally{await pool.end();}
}
if(require.main===module)main().catch(()=>{process.stderr.write('PLATFORM_ACCOUNT_LIFECYCLE_INSTALL_FAILED\n');process.exitCode=1;});
module.exports={install,parseArguments};
