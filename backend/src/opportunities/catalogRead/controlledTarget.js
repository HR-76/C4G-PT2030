'use strict';
const { createHash } = require('node:crypto');
const admissions = new WeakSet();
const fail = () => { throw Error('CATALOG_CONTROLLED_TARGET_NOT_ADMITTED'); };
const hash = v => createHash('sha256').update(v).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9-]{27}$/;
function isControlledAdmission(value) { return Boolean(value && admissions.has(value)); }
function matchesTarget(value, target) { return isControlledAdmission(value) && ['host','port','database'].every(k => value.target[k] === target?.[k]); }
function matchesAdmin(value, admin) { return isControlledAdmission(value) && value.organizationId === admin.organizationId && value.userId === admin.userId; }
async function admitControlledTarget({ pool, target, expected, organizationId, userId, validationOnly = false }) {
  if (!target || !['localhost','127.0.0.1'].includes(target.host) || !Number.isInteger(target.port) || !uuid.test(organizationId) || !uuid.test(userId)
    || !/^[a-f0-9]{64}$/.test(expected?.clusterIdentityHash) || !/^\d+$/.test(expected?.databaseOid)) fail();
  if (validationOnly ? target.port === 5432 || !/^(gcni_catalog_[a-f0-9]{12}|c4g_f13_authority_synthetic_central)$/.test(target.database)
    : target.port !== 5432 || target.database !== 'c4g_central_dev') fail();
  const options = pool?.options || {}; let configured = options;
  if (options.connectionString) { const url=new URL(options.connectionString);configured={host:url.hostname,port:Number(url.port||5432),database:decodeURIComponent(url.pathname.slice(1))}; }
  if (['host','port','database'].some(k => configured[k] !== target[k])) fail();
  const c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const row=(await c.query("SELECT current_database() AS database,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS cluster,NOT pg_is_in_recovery() AS primary")).rows[0];
    if (!row.primary || row.database!==target.database || row.oid!==expected.databaseOid || hash(row.cluster)!==expected.clusterIdentityHash) fail();
    const source=(await c.query('SELECT state FROM opportunity_catalog.eu_source_control_v2')).rows;
    if(source.length!==1 || source[0].state!=='QUIESCED') fail();
    const member=await c.query("SELECT m.id FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id JOIN public.organization o ON o.id=m.organization_id WHERE m.global_user_id=$1 AND m.organization_id=$2 AND m.base_role_code='ORG_ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())",[userId,organizationId]);
    if(member.rowCount!==1) fail();
    await c.query('COMMIT');
    const result=Object.freeze({target:Object.freeze({...target}),organizationId,userId,validationOnly});admissions.add(result);return result;
  } catch(error) { await c.query('ROLLBACK');throw error; }
  finally { c.release(); }
}
module.exports={admitControlledTarget,isControlledAdmission,matchesTarget,matchesAdmin};
