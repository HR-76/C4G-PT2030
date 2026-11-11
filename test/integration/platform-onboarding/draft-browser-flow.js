'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function verify({p,id,origin,http,report}){
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-registration');fs.mkdirSync(out,{recursive:true});
 await p.setViewportSize({width:1440,height:1000});await p.goto(origin+'/adesao/'+id);await p.getByRole('heading',{name:'Completar ficha da entidade'}).waitFor();
 await p.getByRole('button',{name:'Continuar',exact:true}).click();await p.getByRole('alert').waitFor();assert.equal(await p.locator(':focus').getAttribute('name'),'legalName');
 await p.getByLabel('Nome legal',{exact:false}).fill('Associação Horizonte');await p.getByRole('button',{name:'Usar o nome legal'}).click();await p.getByLabel('Tipo de entidade',{exact:false}).selectOption('ASSOCIATION');await p.getByLabel('NIF',{exact:false}).fill('500000000');
 await p.getByRole('button',{name:'Guardar rascunho',exact:true}).click();await p.getByText('Rascunho guardado.',{exact:true}).waitFor();await p.reload();await p.getByLabel('Nome legal',{exact:false}).waitFor();assert.equal(await p.getByLabel('Nome legal',{exact:false}).inputValue(),'Associação Horizonte');
 await p.screenshot({path:path.join(out,'identification-1440.png'),fullPage:true});
 await p.getByRole('button',{name:'Continuar',exact:true}).click();await p.getByLabel('Morada *',{exact:true}).fill('Rua da Escola, 10');await p.getByLabel('Código postal',{exact:false}).fill('1000-001');await p.getByLabel('Localidade',{exact:false}).fill('Lisboa');await p.getByRole('button',{name:'Usar o email do administrador'}).click();await p.getByLabel('Telefone institucional',{exact:false}).fill('+351 210 000 000');
 await p.getByRole('button',{name:'Continuar',exact:true}).click();await p.getByRole('button',{name:'Usar o telefone institucional'}).click();await p.getByLabel('Número de trabalhadores',{exact:false}).fill('0');await p.getByLabel('Data de referência',{exact:false}).fill('2026-01-31');
 for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.screenshot({path:path.join(out,`administrator-${width}.png`),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await p.getByRole('button',{name:'Continuar',exact:true}).click();await p.getByRole('button',{name:'Validar e guardar ficha',exact:true}).click();await p.getByText('Ficha completa e guardada.',{exact:false}).waitFor();
 await p.screenshot({path:path.join(out,'review-390.png'),fullPage:true});
 const stored=await http(p,`/api/admissions/${id}/draft`);assert.equal(stored.status,200);assert.equal(stored.data.fields.workerCount,0);assert.equal(stored.data.fields.legalName,'Associação Horizonte');assert.equal(stored.data.fields.institutionalPhone,'+351210000000');assert.equal(stored.data.phase,'FILLING');
 assert.equal((await http(p,'/api/central-opportunities')).status,403);
  await p.getByRole('link',{name:'Segurança da conta',exact:true}).click();await p.getByRole('heading',{name:'Segurança da conta',exact:true}).waitFor();await p.getByRole('link',{name:'Voltar à ficha da entidade'}).click();await p.getByRole('heading',{name:'Completar ficha da entidade',exact:true}).waitFor();
 const browserStorage=await p.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));assert(!browserStorage.includes('Horizonte'));assert(!browserStorage.includes('1000-001'));
 report.checks.push('Four-step Portuguese form, server errors and focus, partial save and reload, zero workers, complete validation; no operational access');
 fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({result:'PASS',realKeycloak:true,realPostgres:true,viewports:[1440,390],storedInBrowser:false},null,2));
}
module.exports={verify};
