'use strict';
// G1 has rate components but no typed ranges/unit fields. Preserve published
// terms as explicit conditions; never reinterpret a published rate as a base,
// bonus or cap. Original typed values remain in the immutable v2 revision.
const units={PER_PROJECT:'por projeto',PER_PERSON:'por pessoa',PER_MONTH:'por mês',PER_PERSON_MONTH:'por pessoa e mês',OTHER:'unidade não especificada'};
const labels={support:'Apoio individual',rates:'Taxa publicada',eligibleCosts:'Custos elegíveis'};
function financialRules(financing,id,refs){
 const rows=[];
 if(financing.allocations.state==='PRESENT')for(const item of financing.allocations.value){
  // Keep qualifiers and many-to-many programme/fund references visible when
  // FundingLine's single-valued fields cannot carry them without choosing one.
  if(item.aggregation==='STANDALONE'&&!item.qualifiers.length&&item.money.interpretation==='PUBLISHED_AMOUNT'&&item.programmeRefs.length<=1&&item.fundRefs.length<=1)continue;
  const evidenceIds=[...new Set([...refs(financing.allocations),...refs(item.money.currency)])];
  const absent={state:'NOT_APPLICABLE',value:null,evidenceIds};
  rows.push({id:id('financial-rule','allocation:'+item.key),scopeLabel:'Qualificação da dotação — '+item.key,baseRate:absent,bonusPercentagePoints:absent,capRate:absent,
   conditions:[`Âmbito publicado: ${item.scope}.`,`Agregação: ${item.aggregation}; não somar automaticamente.`,`Interpretação do montante: ${item.money.interpretation}.`,`Qualificadores: ${item.qualifiers.join(', ')||'nenhum'}.`,`Grupo partilhado: ${item.sharedGroup||'não indicado'}.`].join('\n'),evidenceIds});
  for(const [key,label] of [['programmeRefs','Programa'],['fundRefs','Fundo']])if(item[key].length>1)item[key].forEach((value,index)=>rows.push({id:id('financial-rule',`allocation:${item.key}:${key}:${index}`),scopeLabel:'Referência da dotação — '+item.key,baseRate:absent,bonusPercentagePoints:absent,capRate:absent,conditions:`${label}: ${value}.`,evidenceIds}));
 }
 for(const name of Object.keys(labels)){
  const fact=financing[name];
  if(fact.state!=='PRESENT'){
   if(fact.state==='CONFLICT'){
    const value={state:'CONFLICT',value:null,evidenceIds:refs(fact)};
    rows.push({id:id('financial-rule',name),scopeLabel:labels[name],baseRate:value,bonusPercentagePoints:value,capRate:value,conditions:'Valores publicados em conflito; consultar as evidências.',evidenceIds:refs(fact)});
   }
   continue;
  }
  fact.value.forEach((item,index)=>{
   const rate=name==='rates';
   const minimum=rate?item.minimumPercent:item.minimum,maximum=rate?item.maximumPercent:item.maximum;
   const evidenceIds=[...new Set([...refs(fact),...(item.currency?refs(item.currency):[])])];
   const absent={state:rate?'UNSUPPORTED':'NOT_APPLICABLE',value:null,evidenceIds};
   const lines=[`${labels[name]}.`,
    `Mínimo publicado: ${minimum===null?'não indicado':minimum}${rate&&minimum!==null?'%':''}.`,
    `Máximo publicado: ${maximum===null?'não indicado':maximum}${rate&&maximum!==null?'%':''}.`];
   if(item.currency)lines.push(`Moeda: ${item.currency.state==='PRESENT'?item.currency.value:'não confirmada ('+item.currency.state+')'}.`);
   if(item.unit)lines.push(`Unidade: ${units[item.unit]} (${item.unit}).`);
   if(item.scope)lines.push(`Âmbito: ${item.scope}.`);
   if(rate)lines.push('A fonte não identifica estes limites como taxa base, majoração ou teto regulamentar.');
   if(item.conditions)lines.push(`Condições da fonte: ${item.conditions}`);
   rows.push({id:id('financial-rule',`${name}:${index}`),scopeLabel:labels[name]+(item.scope?' — '+item.scope:item.unit?' — '+units[item.unit]:''),baseRate:absent,bonusPercentagePoints:absent,capRate:absent,conditions:lines.join('\n'),evidenceIds});
  });
 }
 return rows;
}
module.exports={financialRules};
