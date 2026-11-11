'use strict';
const {createFundingRepository}=require('./repository');
const {assertReaderLogin,assertReaderSession}=require('../security/catalogReaderSecurity');
const VERSION='029_catalog_reader';
function readerOptions(env) {
  const value=env.CATALOG_DATABASE_URL;
  let url;
  try { url=new URL(value); } catch { throw new Error('CATALOG_CONFIGURATION_REQUIRED'); }
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password||url.pathname.length<2)
    throw new Error('CATALOG_CONFIGURATION_REQUIRED');
  // Pool identity is server configuration only; never accepted from requests.
  return {connectionString:value,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:30000};
}
function createCatalogReader({env,Pool=require('pg').Pool}) {
  const pool=require('../config/poolResilience').guardPool(new Pool(readerOptions(env)),'catalog-reader');
  let closed=false,closing=null,verified=null;
  async function ready(){
    if(closed)throw new Error('CATALOG_READER_CLOSED');
    const client=await pool.connect();
    try {await assertReaderLogin(client);const admission=await require('../security/catalogReaderSchema').createReaderSchemaAdmission(client);await assertReaderSession(client,admission);return admission;}
    finally{client.release();}
  }
  const guardedPool={async connect(){
    if(closed)throw new Error('CATALOG_READER_CLOSED');
    if(!verified)verified=ready().catch(error=>{verified=null;throw error;});
    const admission=await verified;
    const client=await pool.connect();
    try{await assertReaderSession(client,admission);return client;}catch(error){client.release();throw error;}
  }};
  const repository=createFundingRepository({pool:guardedPool,readRole:true});
  return Object.freeze({list:repository.list,get:repository.get,revision:repository.revision,dashboardSummary:repository.dashboardSummary,ready,
    close(){closed=true;return closing||(closing=pool.end());}});
}
module.exports={createCatalogReader,readerOptions,VERSION};
