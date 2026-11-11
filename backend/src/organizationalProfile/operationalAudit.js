'use strict';
const {createTaxonomyAuditWriter}=require('./taxonomyAudit');
function createOperationalAuditWriter(options){return createTaxonomyAuditWriter({...options,catalogVersion:'f13-operational-events-v1'});}
module.exports={createOperationalAuditWriter};
