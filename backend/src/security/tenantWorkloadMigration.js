const {migrationSql}=require('./centralMigrationManifest');
const VERSION='008_f44_tenant_workload_identity';
function load(direction='up'){const migration=migrationSql(VERSION,direction);return Object.freeze({version:VERSION,direction,sql:migration.sql,checksum:migration.checksum});}
module.exports={VERSION,load};
