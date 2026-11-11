'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const version='034_application_status_emails';
const checksum='460f4c7427621cddc5a7cd9dca81f2a06ce628f9af52b2ef12b2ab6f829c3e9b';
function load(){const sql=fs.readFileSync(path.join(__dirname,'../../../database/tenant/migrations',version+'.up.sql'),'utf8').replace(/\r\n/g,'\n');if(crypto.createHash('sha256').update(sql).digest('hex')!==checksum)throw Error('STATUS_EMAIL_MIGRATION_CHECKSUM');return {version,checksum,sql};}
module.exports={load};
