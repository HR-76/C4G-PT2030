'use strict';
const {createTaxonomyAuditWriter}=require('./taxonomyAudit');
function createFinancialAuditWriter(options){return createTaxonomyAuditWriter({...options,catalogVersion:'f13-financial-events-v1'});}
module.exports={createFinancialAuditWriter};
