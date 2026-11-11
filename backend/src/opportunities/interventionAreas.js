 'use strict';
const {createHash}=require('node:crypto');
const {areas:existingAreas}=require('../organizationDirectory/thematicAreas');
const taxonomyVersion='c4g-intervention-areas-v1',rulesVersion='2026-11-02.1';
// References preserve existing subarea identifiers; they do not reclassify people or matching.
const definitions=[
 ['DIGITAL','Digital',[4,6,7,16,21,22]],['HEALTH','Saúde',[15,27]],['BIOTECHNOLOGY','Biotecnologia',[2]],
 ['ENERGY','Energia',[12,14]],['ENVIRONMENT','Ambiente e Clima',[1,10,28]],['INDUSTRY','Indústria e Materiais',[18,20,23,25,26]],
 ['EDUCATION','Educação e Formação',[11]],['EMPLOYMENT','Emprego e Inclusão',[19]],['AGRICULTURE','Agricultura',[0]],
 ['SEA','Mar e Oceanos',[3]],['TRANSPORT','Mobilidade e Transportes',[24]],['CULTURE','Cultura e Património',[8]],
 ['TOURISM','Turismo',[29]],['DEFENCE','Defesa e Segurança',[9]],['SPACE','Espaço',[16]],
 ['BUSINESS','Empreendedorismo e Empresas',[13]],['RESEARCH','Investigação e Inovação',[]],['HOUSING','Habitação',[]],
 ['PUBLIC_ADMINISTRATION','Administração Pública',[]],['TECHNICAL_ASSISTANCE','Assistência Técnica',[]],
 ['MIGRATION','Migração e Integração',[]],['TERRITORY','Cidades e Território',[5]]
];
// Space is a separate family; FinTech is the digital reference at index 17.
definitions[0][2]=[4,6,7,17,21,22];
const INTERVENTION_AREAS=Object.freeze(definitions.map(([code,label,refs])=>Object.freeze({code,label,subareaIds:Object.freeze(refs.map(i=>existingAreas[i].id))})));
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const expressions={
 DIGITAL:'digital|digitalizacao|ciberseguranca|cybersecurity|inteligencia artificial|artificial intelligence|big data|computacao em nuvem|internet das coisas|iot|ehealth',
 HEALTH:'saude|health|healthcare|biomedica|biomedical|clinico|clinica',
 BIOTECHNOLOGY:'biotecnologia|biotechnology|biotech|genomica|genomics',
 ENERGY:'energia|energias|energetica|energetico|energeticos|energy|renovaveis|renewable|hidrogenio',
 ENVIRONMENT:'ambiente natural|protecao do ambiente|ambiental|ambientais|clima|climaticas|climaticos|climate|biodiversidade|economia circular|agua|aguas|residuos|protecao e defesa do litoral|descarbonizacao',
 INDUSTRY:'industria|producao industrial|transformacao industrial|manufatura|manufacturing|materiais avancados|advanced materials|nanotecnologia|robotica|fotonica|semicondutores',
 EDUCATION:'cursos de especializacao|educacao|ensino|escolar|escolares|formacao|aprendizagem|education|training|internships|students|digital skills',
 EMPLOYMENT:'emprego|empregabilidade|inclusao|igualdade|deficiencia|vida independente|envelhecimento ativo|privacao material|employment|social inclusion',
 AGRICULTURE:'agricultura|agricola|agricolas|agriculture|farming',SEA:'pesca|pescas|piscatorias|aquicultura|oceanos|ocean|maritimo|maritima|aquaculture',
 TRANSPORT:'mobilidade|transportes|transporte|ferroviaria|ferroviario|rte-t|mobility|transport',
 CULTURE:'cultura|cultural|patrimonio|heritage|culture',TOURISM:'turismo|tourism',
 DEFENCE:'defesa nacional|industria de defesa|capacidades de defesa|defesa e seguranca|defence|defense|militar',
 SPACE:'satelites|aeroespacial|satellite|earth observation|exploracao espacial',
 BUSINESS:'empreendedorismo|empresas|empresarial|empresariais|pme|pmes|entrepreneurship|startup|smes',
 RESEARCH:'investigacao|investigacao e desenvolvimento|i&d|research|inovacao|innovation',HOUSING:'habitacao|housing',
 PUBLIC_ADMINISTRATION:'administracao publica|servicos publicos|public administration',TECHNICAL_ASSISTANCE:'assistencia tecnica|technical assistance',
 MIGRATION:'migracao|imigracao|imigrantes|migrantes|aima|cnaim|migration',TERRITORY:'cidades inteligentes|smart cities|desenvolvimento integrado urbano'
};
const objectiveCodes={
 'ESO4.8':['EMPLOYMENT'],'RSO2.6':['ENVIRONMENT'],'RSO2.5':['ENVIRONMENT'],'RSO4.7':['HOUSING'],'RSO5.3':['HOUSING'],
 'RSO2.4':['ENVIRONMENT'],'RSO2.2':['ENERGY'],'RSO2.1':['ENERGY'],'RSO1.3':['BUSINESS'],'RSO3.1':['TRANSPORT'],
 'TASO7.1':['TECHNICAL_ASSISTANCE'],'RSO4.5':['HEALTH'],'ESO4.3':['EMPLOYMENT'],'ESO4.6':['EDUCATION'],
 'ESO4.4':['EMPLOYMENT'],'RSO2.8':['TRANSPORT'],'RSO1.1':['RESEARCH'],'FSO1.5':['SEA'],'ESO4.1':['EMPLOYMENT'],
 'ESO4.7':['EDUCATION'],'RSO2.3':['ENERGY'],'RSO4.2':['EDUCATION'],'RSO1.2':['DIGITAL'],
 'RSO1.7':['DEFENCE'],'FSO3.1':['SEA'],'HSO9.2':['MIGRATION'],'FSO2.2':['SEA'],'ESO4.13':['EMPLOYMENT'],'RSO2.12':['ENERGY']
};
const present=f=>f?.state==='PRESENT'?f.value:null;
function classifyInterventionAreas(snapshot,presentation=null){
 const evidence=new Map(),url=snapshot.sourceRecords?.[0]?.url||null;
 const add=(code,ruleId,sourcePath,excerpt,sourceUrl=url)=>{
  if(!evidence.has(code))evidence.set(code,[]);
  evidence.get(code).push({ruleId,sourcePath,excerpt:String(excerpt).slice(0,500),sourceUrl});
 };
 if(snapshot.schemaVersion===1&&snapshot.interventionArea){
  const area=INTERVENTION_AREAS.find(a=>a.code===snapshot.interventionArea);
  if(area)return {taxonomyVersion,rulesVersion,sourceDigest:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),status:'CLASSIFIED',areas:[{...area,evidence:[{ruleId:'editorial:selection',sourcePath:'/interventionArea',excerpt:area.label,sourceUrl:null}]}]};
 }
 const texts=[];
 if(snapshot.schemaVersion===2){
  for(const key of ['title','summary']){const value=present(snapshot.description?.[key]);if(typeof value==='string')texts.push(['/description/'+key+'/value',value]);}
  for(const concept of present(snapshot.classification?.themes)||[])if(concept.label)texts.push(['/classification/themes/value',concept.label]);
  const pt=snapshot.sourceRecords?.some(s=>s.namespace==='PORTUGAL2030_PLAN');
  for(const objective of present(snapshot.classification?.specificObjectives)||[]){
   if(pt&&objective.scheme==='PT2030_SPECIFIC_OBJECTIVE'&&objectiveCodes[objective.code]){
    for(const code of objectiveCodes[objective.code])add(code,'pt2030:'+objective.code,'/classification/specificObjectives/value',[objective.code,objective.label].filter(Boolean).join(' — '));
   }
  }
 }else for(const key of ['title','summary'])if(typeof snapshot[key]==='string')texts.push(['/'+key,snapshot[key]]);
 const archived=presentation?.presentation?.areas;
 if(archived?.source==='archived'&&typeof archived.value==='string')texts.push([archived.sourcePointer||'archived/areas',archived.value,archived.sourceUrl]);
 for(const [sourcePath,text,sourceUrl] of texts){
  const normalized=normalize(text);
  for(const [code,expression] of Object.entries(expressions)){
   const match=new RegExp('(?:^|[^a-z0-9])('+expression+')(?![a-z0-9])').exec(normalized);
   if(match){const start=Math.max(0,match.index-60);add(code,'explicit:'+code,sourcePath,text.slice(start,start+220),sourceUrl||url);}
  }
 }
 const areas=INTERVENTION_AREAS.filter(a=>evidence.has(a.code)).map(a=>({...a,evidence:evidence.get(a.code)}));
 return {taxonomyVersion,rulesVersion,sourceDigest:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),status:areas.length?'CLASSIFIED':'UNCLASSIFIED',areas};
}
module.exports={INTERVENTION_AREAS,taxonomyVersion,rulesVersion,classifyInterventionAreas};
