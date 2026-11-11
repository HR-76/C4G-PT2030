'use strict';
const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const ROOT=path.resolve(__dirname,'../../database');
const manifest=Object.freeze({
 central:Object.freeze({version:'006_f12_opportunity_catalog',checksum:'584cf87b735a29b881690a00bf1ba114ab47cf4ac92ee82ca1441d8e4e17c1e1',schemaFingerprint:'f12-central-opportunity-v2-584cf87b735a29b8'}),
 tenant:Object.freeze({version:'004_f12_opportunity_catalog',checksum:'e36a00d4d8ae05a5fe37fe91e32806a4aa4e67926a90f9d409e3ec89862a816b',schemaFingerprint:'f12-tenant-opportunity-v2-e36a00d4d8ae05a5'})
});
function canonical(sql){if(typeof sql!=='string')throw new TypeError('F12 migration SQL is invalid.');return sql.replace(/\r\n/g,'\n');}
function digest(sql){return crypto.createHash('sha256').update(canonical(sql),'utf8').digest('hex');}
function load(scope,direction='up'){if(!['central','tenant'].includes(scope)||!['up','down'].includes(direction))throw new TypeError('F12 migration key is invalid.');const entry=manifest[scope];const sql=canonical(fs.readFileSync(path.join(ROOT,scope,'migrations',`${entry.version}.${direction}.sql`),'utf8'));if(direction==='up'&&digest(sql)!==entry.checksum)throw new Error('F12 migration checksum mismatch.');return Object.freeze({entry,sql,checksum:digest(sql)});}
module.exports={canonical,digest,load,manifest};
