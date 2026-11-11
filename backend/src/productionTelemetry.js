'use strict';

const { createObservability } = require('./observability');
const { createFeatureMetricAdapter } = require('./observability/featureAdapters');

function createProductionTelemetry(logger) {
  const observability = createObservability({ service: 'c4g-api' });
  const featureTelemetry = createFeatureMetricAdapter({ registry: observability.metrics });
  const selectedLogger = logger || observability.logger;
  const httpFailureObserver = event => selectedLogger.error('c4g.http.failed', {
    component: event.component, errorCode: event.code, operation: 'http.request', outcome: 'error'
  });
  return { observability, featureTelemetry, logger: selectedLogger, httpFailureObserver };
}

module.exports = { createProductionTelemetry };
