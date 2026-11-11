'use strict';

class OpportunityV2Error extends TypeError {
  constructor(code = 'OPPORTUNITY_V2_INVALID_INPUT', path = '') {
    super('Opportunity v2 input is invalid.');
    this.name = 'OpportunityV2Error';
    this.code = code;
    // Paths are structural diagnostics only; never attach the rejected payload.
    this.path = path;
  }
}

function fail(code, path) { throw new OpportunityV2Error(code, path); }

module.exports = { OpportunityV2Error, fail };
