'use strict';
// Exact candidate on top of generic 053 + member-email. No runtime-learned admission.
const version='053_opportunity_complement';
const fingerprints=Object.freeze({schema:'4fff1cdf64ea28699d91a0afe945da6f024a680c27f78708798ebd8f8b540a1e',authority:'c6aeb90ef8191df253b55ad39e469006807805dd59d638144ecf96938e50a15c'});
// Reproduced from migrations in the isolated billing validation --user-deletion gate.
const later=Object.freeze({
 '055_entity_type_edit':Object.freeze({schema:'e73000207d362a93e357b021d834a67b19e2cc08c619b005c93493a3cad28d1a',authority:'601f026fde1837d57fbb123d56f2bc2b35b64fdd6162bf2375a63acf735f2346'}),
 '054_billing_account_validation':Object.freeze({schema:'8a03bd8aeb397b675d63f9bb34604310f52c1f21752f01cda7dcab02375d48cb',authority:'3f33533c197c06d0a2c5ff1f8176858ef26932a399ffea7329d3b47c19f95b1b'})
});
function admits(candidateVersion,kind,fingerprint){const accepted=candidateVersion===version?fingerprints:later[candidateVersion];return Boolean(accepted&&typeof fingerprint==='string'&&Object.hasOwn(accepted,kind)&&accepted[kind]===fingerprint);}
module.exports={version,fingerprints,later,admits};
