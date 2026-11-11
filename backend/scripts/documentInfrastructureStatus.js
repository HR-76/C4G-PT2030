'use strict';
const { inspectDocumentInfrastructure } = require('../src/documents/infrastructureStatus');
// Optionally use Node's --env-file before this script. Output is presence-only;
// this command never uploads files, starts services or sets Layer C to validated.
process.stdout.write(JSON.stringify(inspectDocumentInfrastructure(), null, 2) + '\n');
