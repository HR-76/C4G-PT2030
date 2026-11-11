'use strict';
const {startCoordinator}=require('./shared-r2-budget');
startCoordinator(JSON.parse(process.env.SYNTHETIC_BUDGET_CONFIGURATION)).then(server=>process.stdout.write(JSON.stringify({port:server.port})+'\n')).catch(()=>{process.stderr.write('BUDGET_START_FAILED\n');process.exitCode=1;});
