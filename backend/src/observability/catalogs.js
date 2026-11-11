'use strict';
const SERVICES=Object.freeze(['c4g-api','c4g-worker']);
const LEVELS=Object.freeze(['debug','info','warn','error']);
const SIGNALS=Object.freeze(['c4g.api.started','c4g.api.lifecycle','c4g.api.failed','c4g.job.completed','c4g.job.failed','c4g.config.warning','c4g.http.failed','c4g.telemetry.dropped','c4g.shutdown.failed','c4g.opportunity.operation.failed','c4g.opportunity.reconciliation.required']);
const OPERATIONS=Object.freeze(['api.start','api.shutdown','http.request','job.execute','health.probe','telemetry.export','opportunity.create','opportunity.update','opportunity.archive','opportunity.restore','opportunity.read','opportunity.duplicate.scan','opportunity.reconcile']);
const HEALTH_STATES=Object.freeze(['READY','DEGRADED','UNAVAILABLE']);
const ALERTS=Object.freeze([
  ['c4g.alert.readiness_unavailable','CRITICAL','context/runbooks/observability/readiness-unavailable.md'],
  ['c4g.alert.schema_incompatible','CRITICAL','context/runbooks/observability/schema-incompatible.md'],
  ['c4g.alert.circuit_open','WARNING','context/runbooks/observability/circuit-open.md'],
  ['c4g.alert.f9_dead_letter','WARNING','context/runbooks/observability/f9-dead-letter.md'],
  ['c4g.alert.f9_reconciliation_late','WARNING','context/runbooks/observability/f9-reconciliation.md'],
  ['c4g.alert.f7_integrity_mismatch','CRITICAL','context/runbooks/observability/f7-integrity.md'],
  ['c4g.alert.f11_scan_unavailable','WARNING','context/runbooks/observability/f11-scan.md'],
  ['c4g.alert.f11_orphan','WARNING','context/runbooks/observability/f11-orphan.md'],
  ['c4g.alert.telemetry_drop','WARNING','context/runbooks/observability/telemetry-drop.md'],
  ['c4g.alert.shutdown_failure','WARNING','context/runbooks/observability/shutdown-failure.md']
].map(([code,severity,runbook])=>Object.freeze({code,severity,runbook,state:'ACTIVE_LOCAL'})));
function validateCatalogs(){
  for(const [name,values] of Object.entries({SERVICES,LEVELS,SIGNALS,OPERATIONS,HEALTH_STATES})){
    if(!Object.isFrozen(values)||new Set(values).size!==values.length||values.some(v=>typeof v!=='string'||!v)) throw new TypeError(`${name} catalog is invalid.`);
  }
  if(new Set(ALERTS.map(a=>a.code)).size!==ALERTS.length||ALERTS.some(a=>!/^c4g\.alert\./.test(a.code)||!['INFO','WARNING','CRITICAL'].includes(a.severity)||!a.runbook.endsWith('.md'))) throw new TypeError('Alert catalog is invalid.');
  return Object.freeze({version:1,opportunityCatalogVersion:'f12-opportunity-observability-v1',SERVICES,LEVELS,SIGNALS,OPERATIONS,HEALTH_STATES,ALERTS:Object.freeze(ALERTS)});
}
module.exports={...validateCatalogs(),validateCatalogs};
