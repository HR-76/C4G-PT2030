'use strict';
const { randomUUID } = require('node:crypto');
const { CentralOpportunityRepository } = require('../opportunities/centralRepository');
const { createIdentityFactory } = require('../opportunities/identity');
const { createCentralCommand, mutationReceipt, uuid } = require('../opportunities/httpContracts');
const { validateCreateCommand } = require('../opportunities/contracts');
const { createPlatformAudit } = require('./audit');

function createCentralManualAuthoring({ pool, repository, audit = createPlatformAudit({source:'API'}), clock = () => new Date() }) {
  const catalog = new CentralOpportunityRepository({ pool, identityFactory:createIdentityFactory(),
    auditWriter:{ async append(client, event) {
      await client.query('RESET ROLE');
      await audit(client, {actor:{type:'HUMAN',id:event.actor.reference},eventCode:event.eventCode,
        requestId:event.idempotencyKey,resourceId:event.resourceId,detailCode:'MANUAL_CREATED'});
      await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');
    } },
  });
  return Object.freeze({ async create(userId, input) {
    uuid(userId);
    return repository.transaction(async client => {
      // Lock current authority through commit, including idempotent retries.
      await repository.administrator(client,userId,true);
      const command=createCentralCommand(input,clock().toISOString());
      const central=validateCreateCommand({...command,
        requestId:`manual:${userId}:${command.requestId}`,
        snapshot:{...command.snapshot,provenanceId:randomUUID()},
        provenance:{...command.provenance,sourceType:'C4G_MANUAL',sourceNamespace:'C4G_MANUAL_HTTP',
          ...(command.snapshot.officialUrl?{sourceUrl:command.snapshot.officialUrl}:{})},
      });
      const result=await catalog.withTransactionClient(client,()=>catalog.create(central,
        {actor:{type:'HUMAN',reference:userId},audit:{correlationId:randomUUID()}}));
      await client.query('RESET ROLE');
      return mutationReceipt(result);
    });
  } });
}
module.exports={createCentralManualAuthoring};
