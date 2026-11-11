 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyInterventionAreas}=require('../src/opportunities/interventionAreas');
const areas=(title)=>classifyInterventionAreas({schemaVersion:1,title}).areas.map(a=>a.code);
test('classifies explicit domains without the legacy substring false positives',()=>{
 assert.deepEqual(areas('Digitalização da Administração Pública'),['DIGITAL','PUBLIC_ADMINISTRATION']);
 assert.deepEqual(areas('Infraestruturas de cuidados de saúde primários'),['HEALTH']);
 assert.deepEqual(areas('Formação em Inteligência Artificial para as empresas'),['DIGITAL','EDUCATION','BUSINESS']);
 assert.ok(!areas('Qualificação de pessoas com deficiência').includes('ENERGY'));
 assert.ok(!areas('Proteção e defesa do litoral').includes('DEFENCE'));
 assert.ok(!areas('Núcleos de I&DT em ambiente empresarial').includes('ENVIRONMENT'));
 assert.ok(!areas('Habitação na Região Alentejo Litoral').includes('ENVIRONMENT'));
 assert.ok(!areas('Propriedade Intelectual e Industrial').includes('INDUSTRY'));
 assert.deepEqual(areas('Biotecnologia'),['BIOTECHNOLOGY']);
});
test('keeps insufficient evidence unclassified and does not change input',()=>{
 const input={schemaVersion:1,title:'Apoio a Infraestruturas de Base Tecnológica – Regulamento STEP'},before=JSON.stringify(input);
 const result=classifyInterventionAreas(input);assert.equal(result.status,'UNCLASSIFIED');assert.deepEqual(result.areas,[]);assert.equal(JSON.stringify(input),before);
 assert.equal(classifyInterventionAreas({schemaVersion:1,title:'Aviso 123'}).status,'UNCLASSIFIED');
});

test('objective mapping requires the published source and scheme, and ambiguous codes stay unclassified',()=>{
 const snapshot={schemaVersion:2,sourceRecords:[{namespace:'PORTUGAL2030_PLAN'}],classification:{specificObjectives:{state:'PRESENT',value:[{code:'RSO4.5',scheme:'PT2030_SPECIFIC_OBJECTIVE',label:'Saúde'}]}}};
 assert.deepEqual(classifyInterventionAreas(snapshot).areas.map(a=>a.code),['HEALTH']);
 snapshot.classification.specificObjectives.value[0].scheme='OTHER';assert.equal(classifyInterventionAreas(snapshot).status,'UNCLASSIFIED');
 snapshot.classification.specificObjectives.value[0]={code:'HSO9.3',scheme:'PT2030_SPECIFIC_OBJECTIVE',label:'Voltar'};assert.equal(classifyInterventionAreas(snapshot).status,'UNCLASSIFIED');
});
