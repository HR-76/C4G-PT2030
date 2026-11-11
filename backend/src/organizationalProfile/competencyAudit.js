'use strict';
const {createTaxonomyAuditWriter}=require('./taxonomyAudit');
function createCompetencyAuditWriter(options){return createTaxonomyAuditWriter({...options,catalogVersion:'f13-competency-events-v1'});}
module.exports={createCompetencyAuditWriter};
