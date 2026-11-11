'use strict';
const {createTaxonomyAuditWriter}=require('./taxonomyAudit');
function createAuthoringAuditWriter(options){return createTaxonomyAuditWriter({...options,catalogVersion:'f13-authoring-events-v1'});}
module.exports={createAuthoringAuditWriter};
