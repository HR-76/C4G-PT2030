'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validate,validateProfile,validNif,command,profileCommand}=require('../src/entityAdmission/registrationContract');
const fields={legalName:'Entidade Exemplo',displayName:'Exemplo',typeCode:'COMPANY',nif:'500000000',address:'Rua da Escola',postalCode:'1000-001',locality:'Lisboa',institutionalEmail:'admin@example.com',institutionalPhone:'+351 210 000 000',administratorProfessionalPhone:'+44 7700 900123',workerCount:0,workerReferenceDate:'2026-01-31'};
test('PT NIF checksum, zeros and fixed jurisdiction cannot be forged',()=>{
 assert(validNif('500000000'));assert(!validNif('500000005'));assert(!validNif('000000000'));assert(!validNif('000000019'));
 assert.throws(()=>validate({...fields,country:'ES'}));assert.throws(()=>validate({...fields,adminEmail:'other@example.com'}));
});
test('empty draft allowed but complete ficha and individual steps require their fields',()=>{
 assert(validate({}).valid);assert.equal(Object.keys(validate({},{step:0}).errors).length,4);
 assert.equal(validate({},{complete:true}).valid,false);assert(validate(fields,{complete:true,now:new Date('2026-02-01T00:00:00Z')}).valid);
});
test('zero workers retained, invalid numeric types and dates rejected, international phones normalized',()=>{
 const result=validate(fields,{complete:true,now:new Date('2026-02-01T00:00:00Z')});assert.equal(result.fields.workerCount,0);assert.equal(result.fields.institutionalPhone,'+351210000000');
 for(const workerCount of [-1,1.5,'0',true,Infinity])assert(validate({...fields,workerCount}).errors.workerCount);
 for(const workerReferenceDate of ['2026-02-30','2026-13-01','2026-02-02','0000-01-01'])assert(validate({...fields,workerReferenceDate},{now:new Date('2026-02-01T00:00:00Z')}).errors.workerReferenceDate);
 assert(!validate({...fields,workerReferenceDate:'2024-02-29'}).errors.workerReferenceDate);
});
test('present invalid values rejected in partial draft; arbitrary type and unsafe website refused',()=>{
 for(const field of [{postalCode:'1234567'},{institutionalEmail:'bad'},{institutionalPhone:'123'},{website:'javascript:alert(1)'},{website:'https://user:password@example.com'},{typeCode:'NEW_TYPE'},{legalName:'x'.repeat(201)}])assert.equal(validate(field).valid,false);
 assert(validate({website:'https://example.com',address:'Sem número',institutionalEmail:'contact@example.org'}).valid);
});
test('closed save command requires revision and UUID intent',()=>{
 assert.throws(()=>command({fields:{},expectedRevision:-1,requestId:'a'}));assert.throws(()=>command({fields:{},expectedRevision:0,requestId:'a'}));
});
test('description command cannot carry contact or administrative identity changes',()=>{
 const {parse}=require('../src/organizationDirectory/contracts'),body={description:'Texto',expectedRevision:1,idempotencyKey:require('node:crypto').randomUUID()};
 assert.deepEqual(parse('descriptionEdit',body),body);assert.throws(()=>parse('descriptionEdit',{...body,email:'overwrite@example.org'}));assert.throws(()=>parse('descriptionEdit',{...body,nif:'500000000'}));
});
test('existing entity profile has one closed canonical command without caller-supplied identity',()=>{
 const profileFields={nif:fields.nif,acronym:'EX',address:fields.address,addressComplement:'',postalCode:fields.postalCode,locality:fields.locality,institutionalEmail:fields.institutionalEmail,institutionalPhone:fields.institutionalPhone,website:'https://example.org',responsibleName:'Ana Responsável',responsibleEmail:'ANA@example.org',responsiblePhone:'+351 910 000 000',responsibleJobTitle:'Diretora',workerCount:fields.workerCount,workerReferenceDate:fields.workerReferenceDate};
 const body={expectedRevision:0,requestId:require('node:crypto').randomUUID(),fields:profileFields};
 assert.deepEqual(profileCommand(body),body);
 for(const extra of ['legalName','displayName','typeCode','country','currency','organizationId'])assert.throws(()=>profileCommand({...body,fields:{...profileFields,[extra]:'forged'}}));
 const result=validateProfile(profileFields,{legalName:'Entidade Exemplo',displayName:'Exemplo',typeCode:'COMPANY'},{now:new Date('2026-02-01T00:00:00Z')});
 assert.equal(result.valid,true);assert.equal(result.fields.responsibleEmail,'ana@example.org');assert.equal(result.fields.responsiblePhone,'+351910000000');assert.equal(result.fields.workerCount,0);assert.equal(result.fields.legalName,'Entidade Exemplo');assert.equal(result.fields.administratorProfessionalPhone,undefined);
});
test('complete entity profile requires an operational responsible distinct from membership',()=>{
 const profile={nif:fields.nif,acronym:'',address:fields.address,addressComplement:'',postalCode:fields.postalCode,locality:fields.locality,institutionalEmail:fields.institutionalEmail,institutionalPhone:fields.institutionalPhone,website:'',responsibleName:'',responsibleEmail:'invalid',responsiblePhone:'123',responsibleJobTitle:'',workerCount:0,workerReferenceDate:fields.workerReferenceDate};
 const result=validateProfile(profile,{legalName:'Entidade Exemplo',displayName:'Exemplo',typeCode:'COMPANY'},{now:new Date('2026-02-01T00:00:00Z')});
 assert.equal(result.valid,false);assert(result.errors.responsibleName);assert(result.errors.responsibleEmail);assert(result.errors.responsiblePhone);
});
module.exports={fields};
