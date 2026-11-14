'use strict';
// Exact candidate on top of generic 053 + member-email. No runtime-learned admission.
const version='053_opportunity_complement';
const fingerprints=Object.freeze({schema:'4fff1cdf64ea28699d91a0afe945da6f024a680c27f78708798ebd8f8b540a1e',authority:'c6aeb90ef8191df253b55ad39e469006807805dd59d638144ecf96938e50a15c'});
function admits(candidateVersion,kind,fingerprint){return candidateVersion===version&&typeof fingerprint==='string'&&Object.hasOwn(fingerprints,kind)&&fingerprints[kind]===fingerprint;}
module.exports={version,fingerprints,admits};
