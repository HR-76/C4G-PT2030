'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApplicationDocumentConfiguration}=require('../src/config/applicationDocuments');
const {createR2Storage}=require('../src/documents/r2Storage');
const env=Object.freeze({C4G_R2_ENDPOINT:'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.eu.r2.cloudflarestorage.com',C4G_R2_DOCUMENTS_BUCKET:'synthetic-documents',C4G_R2_QUARANTINE_BUCKET:'synthetic-quarantine',C4G_R2_ACCESS_KEY_ID:'synthetic',C4G_R2_SECRET_ACCESS_KEY:'synthetic',C4G_R2_LAYER_C_VALIDATED:'true',C4G_R2_MULTIPART_CONDITIONAL_VALIDATED:'true',C4G_CLAMAV_HOST:'127.0.0.1',C4G_CLAMAV_PORT:'53310'});
test('R2 configuration and construction do not contact the provider or mutate frozen credentials',async()=>{
 const configuration=loadApplicationDocumentConfiguration(env),before=JSON.stringify(configuration);let calls=0,destroyed=0;
 const storage=createR2Storage(configuration.r2,{organizationId:'11111111-1111-4111-8111-111111111111',credentials:configuration.credentials,client:{async send(){calls++;throw Error('NETWORK_FORBIDDEN');},destroy(){destroyed++;}}});
 assert.equal(calls,0);assert.equal(JSON.stringify(configuration),before);await storage.shutdown();assert.equal(calls,0);assert.equal(destroyed,1);
});
test('missing document configuration is rejected without storage construction',()=>{
 for(const key of ['C4G_R2_ACCESS_KEY_ID','C4G_R2_SECRET_ACCESS_KEY','C4G_CLAMAV_HOST','C4G_CLAMAV_PORT']){const invalid={...env};delete invalid[key];assert.throws(()=>loadApplicationDocumentConfiguration(invalid),new RegExp(key));}
 assert.throws(()=>loadApplicationDocumentConfiguration({...env,C4G_R2_ENDPOINT:'http://127.0.0.1/'}),/EU jurisdiction/);
});
test('accepted root slash is canonicalized for the adapter; URL credentials and query are refused',()=>{
 const configuration=loadApplicationDocumentConfiguration({...env,C4G_R2_ENDPOINT:env.C4G_R2_ENDPOINT+'/'});
 assert.equal(configuration.r2.endpoint,env.C4G_R2_ENDPOINT);assert.equal(require('../src/documents/r2Adapter').validateR2Configuration(configuration.r2),true);
 for(const suffix of ['?token=synthetic','#fragment',':9443'])assert.throws(()=>loadApplicationDocumentConfiguration({...env,C4G_R2_ENDPOINT:env.C4G_R2_ENDPOINT+suffix}),/EU jurisdiction/);
 assert.throws(()=>loadApplicationDocumentConfiguration({...env,C4G_R2_ENDPOINT:env.C4G_R2_ENDPOINT.replace('https://','https://synthetic@')}),/EU jurisdiction/);
});
