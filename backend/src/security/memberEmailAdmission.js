'use strict';
// Exact additive variant rehearsed against the admitted 048 schema. No wildcard,
// runtime-learned fingerprint or modification to the historical migration ledger.
const version = '048_catalog_read_service_v1';
const fingerprints = Object.freeze({
  schema: 'f3af40232a286ba6040bc7b2d3f60c618dc218a39f13259faa2ce8708e54ef49',
  authority: '02061d724234e23d186cf266f93ea459f309766342a66ae468c4a020762f2117',
});
const later=Object.freeze({
 '049_pt2030_document_upload':Object.freeze({schema:'767e49642e9976b8a8b99c20be1e8e43fadaf390efe8869192b30fc10f30b4b8',authority:fingerprints.authority}),
 '050_billing_private_documents':Object.freeze({schema:'060c07f21a4cbee846e9a6b3a2737b5d176639337cbb8bf858ee093b11e1cd04',authority:'0d27d56b2ec45f7970c07a46bb4cd8a3f32b1248af02c7e2fdb23d7f5a069e76'}),
 '051_email_templates':Object.freeze({schema:'b78f8ea62dd7a7e5cf4a213f89c9ee57d6f72dae1e7d577bd04c7416c9824415',authority:'89a20e2c69f4d9f4ba57351b3c1fac15ca7b9030ffa645c6c7e4f0157db3fa7c'})
});
function admits(candidateVersion, kind, fingerprint) {
 const accepted=candidateVersion===version?fingerprints:later[candidateVersion];
 return Boolean(accepted&&Object.hasOwn(accepted,kind)&&fingerprint===accepted[kind]);
}
module.exports = { version, fingerprints, admits };
