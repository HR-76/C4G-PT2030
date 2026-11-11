const { assertObjectStoragePort } = require('./objectStoragePort');
function validateR2Configuration(configuration) {
  const keys = ['enabled', 'jurisdiction', 'endpoint', 'documentsBucket', 'quarantineBucket', 'bucketAccess', 'capabilities'];
  if (!configuration || Reflect.ownKeys(configuration).length !== keys.length || keys.some(key => !Object.hasOwn(configuration, key))) throw new TypeError('R2 configuration is incomplete.');
  if (configuration.enabled !== true) throw new Error('R2_LAYER_C_DISABLED');
  if (configuration.jurisdiction !== 'eu' || !/^https:\/\/[a-z0-9-]+\.eu\.r2\.cloudflarestorage\.com$/.test(configuration.endpoint)) throw new Error('R2_EU_JURISDICTION_REQUIRED');
  if (![configuration.documentsBucket, configuration.quarantineBucket].every(value => /^[a-z0-9][a-z0-9-]{2,62}$/.test(value)) || configuration.documentsBucket === configuration.quarantineBucket) throw new Error('R2_PRIVATE_BUCKET_CONFIGURATION_INVALID');
  if (configuration.bucketAccess !== 'PRIVATE') throw new Error('R2_PRIVATE_BUCKET_REQUIRED');
  if (!configuration.capabilities || configuration.capabilities.layerCValidated !== true) throw new Error('R2_LAYER_C_NOT_VALIDATED');
  return true;
}
function createR2AdapterBoundary(configuration, options) {
  validateR2Configuration(configuration);
  return require('./r2Storage').createR2Storage(configuration, options);
}
module.exports = { createR2AdapterBoundary, validateR2Configuration, assertObjectStoragePort };
