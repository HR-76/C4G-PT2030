'use strict';
const { createOpportunityCatalogs }=require('./catalogs');let published=null;
function validateOpportunityStartup(factory=createOpportunityCatalogs){const candidate=factory();if(!candidate||candidate.version!=='f12-opportunity-catalogs-v1')throw new TypeError('F12 startup validation failed.');published=candidate;return candidate;}
function currentOpportunityCatalogs(){return published;}
module.exports={currentOpportunityCatalogs,validateOpportunityStartup};
