'use strict';
const {Pool}=require('pg');
async function main(){
 if(process.env.DOCUMENT_QUEUE_INSTALL_CONFIRM!=='PROVISION_DOCUMENT_QUEUE_PROFILE'||!process.env.DOCUMENT_QUEUE_INSTALL_URL)throw Error('INSTALL_CONFIGURATION_REQUIRED');
 const pool=new Pool({connectionString:process.env.DOCUMENT_QUEUE_INSTALL_URL,max:1,connectionTimeoutMillis:5000});let client;
 try{client=await pool.connect();const result=await require('../src/security/documentQueueProfile').provisionDocumentQueueProfile(client,{login:process.env.DOCUMENT_QUEUE_LOGIN,password:process.env.DOCUMENT_QUEUE_PASSWORD});process.stdout.write(JSON.stringify(result)+'\n');}
 finally{client?.release();await pool.end();}
}
if(require.main===module)main().catch(()=>{process.stderr.write('DOCUMENT_QUEUE_PROVISION_FAILED\n');process.exitCode=1;});
module.exports={main};
