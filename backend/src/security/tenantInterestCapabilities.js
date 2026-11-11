'use strict';

const { tenantMigrationFailure } = require('./tenantMigrationErrors');
const refuse = code => { throw tenantMigrationFailure(code); };

async function validateInterestCapabilities(client) {
    const names=['opportunity_interest','interest_unit','interest_change','interest_receipt','application_unit'];
    const rows=(await client.query(`SELECT c.relname,
      (has_table_privilege('c4g_opportunity_tenant_runtime',c.oid,'SELECT') AND has_table_privilege('c4g_opportunity_tenant_runtime',c.oid,'INSERT')) AS usable,
      has_table_privilege('c4g_opportunity_tenant_runtime',c.oid,'DELETE,TRUNCATE') AS destructive,
      has_any_column_privilege('c4g_opportunity_tenant_runtime',c.oid,'UPDATE') AS mutable
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='opportunity_catalog' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,[names])).rows;
    if(rows.length!==names.length||rows.some(row=>!row.usable||row.destructive
      ||(['interest_change','interest_receipt'].includes(row.relname)&&row.mutable)))refuse('CAPABILITY_EVIDENCE_MISMATCH');
    const references=(await client.query(`SELECT
      has_column_privilege('c4g_opportunity_tenant_runtime',c.oid,'source_interest_id','UPDATE') AS mutable_id,
      has_column_privilege('c4g_opportunity_tenant_runtime',c.oid,'source_interest_revision','UPDATE') AS mutable_revision
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='opportunity_catalog' AND c.relname='application'`)).rows[0];
    if(!references||references.mutable_id!==false||references.mutable_revision!==false)refuse('CAPABILITY_EVIDENCE_MISMATCH');
}

module.exports = { validateInterestCapabilities };
