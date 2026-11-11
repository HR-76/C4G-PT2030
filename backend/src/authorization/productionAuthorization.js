const { createProductionCatalogs } = require('./catalogs');

function validateProductionAuthorizationBootstrap() {
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' });
  const approved = ['billing.read','opportunity_interest.read','opportunity_interest.register','opportunity_interest.manage','notification.read','organization_notice.manage','audit_event.read', 'audit_event.verify', 'audit_event.export', 'audit_event.read_cross_organization',
    'async_job.replay', 'async_job.replay_approve',
    'document.upload.initiate', 'document.upload.confirm', 'document.read', 'document.version.create',
    'document.version.list', 'document.download.request', 'document.quarantine.manage',
    'opportunity.criteria.read','opportunity.criteria.edit','opportunity.criteria.confirm','opportunity.read', 'opportunity.private.create', 'opportunity.private.update', 'opportunity.archive',
    'opportunity.restore', 'opportunity.duplicate.review', 'opportunity.duplicate.scan',
    'opportunity.catalog.reconcile', 'opportunity.central.manage',
    'opportunity_import.upload','opportunity_import.preview','opportunity_import.confirm','opportunity_import.read',
    'opportunity_import.cancel','opportunity_import.review','opportunity_import.download_report',
    'organizational_scope.read', 'organizational_scope.create', 'organizational_scope.rename',
    'organizational_scope.reparent', 'organizational_scope.archive',
    'profile_taxonomy.read', 'profile_taxonomy.release.create', 'profile_taxonomy.local_concept.create',
    'profile_taxonomy.local_concept.approve', 'profile_taxonomy.relation.create',
    'profile_taxonomy.mapping.create', 'profile_taxonomy.release.publish',
    'organization_profile.draft.create','organization_profile.draft.edit','organization_profile.submit',
    'organization_profile.read','organization_profile.approve','organization_profile.publish','organization_profile.activate','prequalification.evaluate','prequalification.read','prequalification.decide',
    'profile_assertion.revoke','profile_evidence.attach','profile_evidence.link.read','profile_competency.verify',
    'profile_financial.create','profile_financial.edit','profile_financial.read','profile_financial.submit',
    'profile_financial.verify','profile_financial.reject','profile_financial.dispute','profile_financial.revoke',
    'profile_operational.create','profile_operational.edit','profile_operational.read','profile_operational.submit',
    'profile_operational.verify','profile_operational.reject','profile_operational.dispute','profile_operational.revoke',
    'profile_population.create','profile_population.edit','profile_population.read','profile_population.submit','profile_population.verify','profile_population.reject','profile_population.dispute','profile_population.revoke',
    'application.read','application.create','application.edit','application.transition','application.review.decide',
    'organization_directory.read','organization_directory.edit','personal_profile.read','personal_profile.edit','organization_membership.read','organization_membership.manage'];
  if (catalogs.permissionCatalog.size !== approved.length || catalogs.operationCatalog.size !== approved.length+14
      || approved.some(code => !catalogs.permissionCatalog.resolve(code))
      || !catalogs.serviceOperationCatalog || catalogs.serviceOperationCatalog.bindings.length !== 2
      || catalogs.profileCatalog.profiles.some(profile => profile.permissions.length !== 0)) {
    throw new Error('F13 productive authorization catalog is invalid.');
  }
  return catalogs;
}

module.exports = { validateProductionAuthorizationBootstrap };
