'use strict';
// Compatibility facade: the launcher and API use the same bounded drain.
const {createResourceDrain,trackPool,watchServer,trackExpress}=require('../../../backend/src/resourceDrain');
module.exports={createLauncherDrain:createResourceDrain,trackPool,watchServer,trackExpress};
