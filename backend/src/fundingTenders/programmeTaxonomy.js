'use strict';
const snapshot = require('./programmeTaxonomy.json');
const VERSION = snapshot.version;
const PROGRAMMES = Object.freeze(Object.fromEntries(snapshot.programmes.map(p => [p.id, Object.freeze({ ...p })])));
// Only codes present in the recorded official FACET response are accepted.
function programmeFor(id) { return typeof id === 'string' && Object.hasOwn(PROGRAMMES, id) ? { ...PROGRAMMES[id] } : null; }
module.exports = { VERSION, PROGRAMMES, programmeFor };
