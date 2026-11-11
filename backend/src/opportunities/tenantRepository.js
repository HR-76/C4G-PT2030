'use strict';const {createRepository}=require('./repositorySupport');
class TenantOpportunityRepository{constructor({pool,organizationId,identityFactory,statementTimeoutMs,auditWriter=null,clock}){return createRepository({pool,organizationId,identityFactory,statementTimeoutMs,auditWriter,clock,authority:'ORGANIZATION',runtimeRole:'c4g_opportunity_tenant_runtime'});}}
module.exports={TenantOpportunityRepository};
