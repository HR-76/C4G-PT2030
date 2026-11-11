'use strict';
// These historical A/B observer tests exercise the frozen four-stage protocol.
// Current production routing is covered by httpDashboard* and integration tests.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const entry=JSON.parse(fs.readFileSync(path.join(root,'test/integration/page-performance/before/manifest.json')))
 .find(row=>row.path==='backend/src/routes/organizationDashboardRoutes.js');
const bytes=fs.readFileSync(path.join(root,entry.snapshot));
if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('HISTORICAL_DASHBOARD_BASELINE_CHANGED');
const filename=path.join(root,entry.path),instance=new Module(filename,module);
instance.filename=filename;instance.paths=Module._nodeModulePaths(path.dirname(filename));instance._compile(bytes.toString('utf8'),filename);
module.exports=instance.exports;
