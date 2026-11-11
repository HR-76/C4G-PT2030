'use strict';
const {createTaxonomyAuditWriter}=require('./taxonomyAudit');
function createPopulationAuditWriter(options){return createTaxonomyAuditWriter({...options,catalogVersion:'f13-population-events-v1'});}
module.exports={createPopulationAuditWriter};
