const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const entry=Object.freeze({version:'003_f11_private_document_storage',checksum:'f5e982129d57bd78728673ba10c2edd51e6d2fbc752c8f3da999281ba64d5075',schemaFingerprint:'f11-document-schema-v1-f5e982129d57bd78'});
function canonical(sql){return sql.replace(/\r\n/g,'\n');}function digest(sql){return crypto.createHash('sha256').update(canonical(sql),'utf8').digest('hex');}
function load(direction='up'){if(!['up','down'].includes(direction))throw new TypeError('F11 migration direction is invalid.');const sql=canonical(fs.readFileSync(path.resolve(__dirname,`../../database/tenant/migrations/${entry.version}.${direction}.sql`),'utf8'));if(direction==='up'&&digest(sql)!==entry.checksum)throw new Error('F11 migration checksum mismatch.');return Object.freeze({entry,sql,checksum:digest(sql)});}
module.exports={canonical,digest,entry,load};
