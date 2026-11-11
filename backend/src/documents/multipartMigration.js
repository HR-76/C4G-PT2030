'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const version='031_application_document_transport';
const root=path.resolve(__dirname,'../../database/tenant/migrations');
const canonical=value=>value.replace(/\r\n/g,'\n');
const read=direction=>canonical(fs.readFileSync(path.join(root,`${version}.${direction}.sql`),'utf8'));
const sha256=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
function candidate(){const up=read('up'),down=read('down');return Object.freeze({version,ordinal:31,upChecksum:sha256(up),downChecksum:sha256(down),schemaFingerprint:'11b8e09294f53d4acffc9a8be25075930554efb30f429e9df25c28edcada9674',admitted:true,evidence:'GROUP_B_POSTGRES_17_CANONICAL_2026_10_24'});}
module.exports={candidate,canonical,read,sha256,version};
