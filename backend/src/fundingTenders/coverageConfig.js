'use strict';
function coverageConfig(mode,currentVersion,enrichmentMode){
 if(mode!==undefined&&!['disabled','durable-v1'].includes(mode))throw Error('FUNDING_COVERAGE_CONFIG_INVALID');
 const supported=require('../security/centralMigrationManifest').supportsCentralVersion(currentVersion,'033_funding_coverage');
 const enabled=mode==='durable-v1';
 if(enabled&&!supported)throw Error('FUNDING_COVERAGE_SCHEMA_REQUIRED');
 const resolutionSupported=require('../security/centralMigrationManifest').supportsCentralVersion(currentVersion,'035_funding_source_resolution');
 if(enrichmentMode!==undefined&&enrichmentMode!=='verified-v1')throw Error('FUNDING_ENRICHMENT_CONFIG_INVALID');
 if(enrichmentMode&&!enabled||enrichmentMode&&!resolutionSupported)throw Error('FUNDING_ENRICHMENT_REQUIRES_COVERAGE_AND_RESOLUTION');
 return {supported,enabled,...(require('../security/centralMigrationManifest').supportsCentralVersion(currentVersion,'034_funding_temporal_refresh')?{temporalSupported:true}:{}),...(resolutionSupported?{resolutionSupported:true}:{}),...(enrichmentMode?{enrichmentEnabled:true}:{})};
}
module.exports={coverageConfig};
