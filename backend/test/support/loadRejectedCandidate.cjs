'use strict';
// Historical candidate tests only. Never imported by the service.
module.exports=function load(relative){
 const path=require('node:path'),Module=require('node:module');
 const source=require('./c1c2Rejected.json').source[relative];if(typeof source!=='string')throw Error('UNKNOWN_ARCHIVED_CANDIDATE');
 const filename=path.resolve(__dirname,'../..',relative.replace(/^backend\//,''));
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(source,filename);return m.exports;
};
