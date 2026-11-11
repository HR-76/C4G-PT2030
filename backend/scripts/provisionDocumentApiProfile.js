'use strict';
// Explicit installation command. Credentials are supplied only through the environment.
const {Pool}=require('pg');
const {provisionDocumentApiProfile}=require('../src/security/documentApiProfile');
async function main(){
 if(process.env.DOCUMENT_API_INSTALL_CONFIRM!=='PROVISION_DOCUMENT_API_PROFILE'||!process.env.DOCUMENT_API_INSTALL_URL)throw Error('INSTALL_CONFIGURATION_REQUIRED');
 const pool=new Pool({connectionString:process.env.DOCUMENT_API_INSTALL_URL,max:1,connectionTimeoutMillis:5000});let client;
 try{client=await pool.connect();const result=await provisionDocumentApiProfile(client,{login:process.env.DOCUMENT_API_LOGIN,password:process.env.DOCUMENT_API_PASSWORD});process.stdout.write(JSON.stringify(result)+'\n');}
 finally{client?.release();await pool.end();}
}
if(require.main===module)main().catch(()=>{process.stderr.write('DOCUMENT_API_PROFILE_PROVISION_FAILED\n');process.exitCode=1;});
module.exports={main};
