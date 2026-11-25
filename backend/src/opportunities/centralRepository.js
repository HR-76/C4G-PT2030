'use strict';const {createRepository}=require('./repositorySupport');
class CentralOpportunityRepository{constructor({pool,identityFactory,statementTimeoutMs,auditWriter=null,clock}){return createRepository({pool,identityFactory,statementTimeoutMs,auditWriter,clock,authority:'CENTRAL',runtimeRole:pool.productionRole||'c4g_opportunity_central_runtime'});}}
module.exports={CentralOpportunityRepository};
