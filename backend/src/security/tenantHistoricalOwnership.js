'use strict';
const {createHash}=require('node:crypto');
const BASELINE=Object.freeze({
  version:'030_organization_notices',
  ledgerDigest:'4dc1dc0d4b91d822c27b5a996b4a8ca051bc621edc5122970aeee9d572c4c46d',
  fingerprint:'e39a77c76efb85ce9e19fe17f2e92057739681ded45601cb3e2c1374fca6a623',
  canonicalFingerprint:'518daabb394601fe785442c80ea83349135908c1331c60fe9f59e56683dd5712'
});
function ledgerDigest(rows){
  return createHash('sha256').update(JSON.stringify(rows.map(r=>({
    migration_id:r.migration_id,ordinal:Number(r.ordinal),checksum_sha256:r.checksum_sha256,
    irreversible:r.irreversible,resulting_fingerprint:r.resulting_fingerprint
  })))).digest('hex');
}
function isHistoricalOwnershipLedger(rows){
  return Array.isArray(rows)&&rows.length===30&&rows.every(r=>r&&typeof r==='object')
    &&ledgerDigest(rows)===BASELINE.ledgerDigest;
}
module.exports={BASELINE,ledgerDigest,isHistoricalOwnershipLedger};
