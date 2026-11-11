const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const ROOT=path.resolve(__dirname,'../../database');
const manifest=Object.freeze({
 central:Object.freeze({version:'004_f9_async_execution',schemaVersion:45,packageVersion:'12.37.0',planDigest:'e0cc78ee2a2fed4b42d479a9ae2af65e2ca5b21f980afa41fb880e2eb6ffebbb'}),
 tenant:Object.freeze({version:'001_f9_async_execution'})
});
const lineageManifest=Object.freeze({
 central:Object.freeze({version:'007_f9_execution_lineage',checksum:'6accfe1a084ed188a52a33e6994e0b1463ba2a6575aa95c09795c5b6ed7a4669'}),
 tenant:Object.freeze({version:'005_f9_execution_lineage',checksum:'dd4e4be2bb57c56361275146450448197db1bde32ee269931c8f11892a207991'})
});
function canonical(s){return s.replace(/\r\n/g,'\n');}function digest(s){return crypto.createHash('sha256').update(canonical(s)).digest('hex');}
function load(scope,direction){if(!['central','tenant'].includes(scope)||!['up','down'].includes(direction))throw new TypeError('F9 migration key is invalid.');const entry=manifest[scope];const own=canonical(fs.readFileSync(path.join(ROOT,scope,'migrations',`${entry.version}.${direction}.sql`),'utf8'));if(scope==='central'&&direction==='up'){const vendor=canonical(fs.readFileSync(path.join(ROOT,'central','pgboss','045_pg_boss_12_37_0.sql'),'utf8'));if(!vendor.includes(`Upstream plan SHA-256 before whitespace normalization: ${entry.planDigest}`))throw new Error('Pinned pg-boss migration plan is incompatible.');return Object.freeze({sql:`${vendor}\n${own}`,checksum:digest(`${vendor}\n${own}`),entry});}return Object.freeze({sql:own,checksum:digest(own),entry});}
function loadLineage(scope,direction='up'){if(!['central','tenant'].includes(scope)||!['up','down'].includes(direction))throw new TypeError('F9 lineage migration key is invalid.');const entry=lineageManifest[scope],sql=canonical(fs.readFileSync(path.join(ROOT,scope,'migrations',`${entry.version}.${direction}.sql`),'utf8')),checksum=digest(sql);if(direction==='up'&&checksum!==entry.checksum)throw new Error('F9 lineage migration checksum mismatch.');return Object.freeze({sql,checksum,entry});}
module.exports={digest,lineageManifest,load,loadLineage,manifest};
