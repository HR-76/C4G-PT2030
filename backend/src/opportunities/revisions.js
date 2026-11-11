'use strict';
const { cloneFreeze }=require('./immutability'); const { OpportunityError }=require('./errors');
function createRevision({opportunityId,revisionId,expectedRowVersion,current=null,snapshot,provenance,createdAt}){const actual=current?current.rowVersion:0;if(expectedRowVersion!==actual)throw new OpportunityError('OPPORTUNITY_STALE_REVISION');const revisionNumber=current?current.revisionNumber+1:1;return cloneFreeze({opportunityId,revisionId,revisionNumber,rowVersion:actual+1,snapshot,provenance,createdAt});}
function appendRevision(history,revision){if(!Array.isArray(history)||!Object.isFrozen(revision)||history.some(item=>item.revisionId===revision.revisionId)||history.length&&history.at(-1).revisionNumber+1!==revision.revisionNumber)throw new OpportunityError('OPPORTUNITY_IDENTITY_REUSED');return Object.freeze([...history,revision]);}
module.exports={appendRevision,createRevision};
