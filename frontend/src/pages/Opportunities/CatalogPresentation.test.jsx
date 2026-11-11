import {afterEach,expect,it} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {CatalogStatus,CatalogMoney,formatCatalogAmount,CallInformation} from './CatalogPresentation'
afterEach(cleanup)
it('formats EUR exactly without displaying the default-currency notice',()=>{
 expect(formatCatalogAmount('120000','EUR')).toBe('120\u202f000,00 €')
 expect(formatCatalogAmount('0','EUR')).toBe('0,00 €')
 expect(formatCatalogAmount('999999999999999999999999.12345678','USD')).toBe('999\u202f999\u202f999\u202f999\u202f999\u202f999\u202f999\u202f999,12345678 USD')
 const money={amount:'120000',currency:null};render(<CatalogMoney money={money}/>);expect(document.querySelector('.cr-money').textContent).toBe('120\u202f000,00 €');expect(screen.queryByText(/EUR por regra geral/)).toBeNull();expect(money.currency).toBeNull()
})
it.each(['open','closed','planned','conditional','cancelled','suspended','unknown'])('keeps status text alongside colour for %s',code=>{
 render(<CatalogStatus status={{code,label:'Estado legível'}}/>);expect(screen.getByText('Estado legível').className).toContain('cr-status-'+code)
})
it('always displays all four detail fields without inventing missing values or interpreting HTML',()=>{
 render(<CallInformation information={{topic:{value:'DIGITAL-TOPIC',source:'canonical'},eligibleCandidates:{value:'<img src=x onerror=alert(1)>',source:'archived'}}}/>);
 for(const name of ['Topic','Candidatos elegíveis','Duração','Localização'])screen.getByText(name)
 expect(screen.getAllByText('Não indicado nos dados disponíveis')).toHaveLength(2);expect(document.querySelector('img')).toBeNull()
})

it('formats typed canonical currencies without silently converting conflicts or explicit USD',()=>{
 expect(formatCatalogAmount('120000',{state:'NOT_FOUND',value:null})).toBe('120\u202f000,00 €')
 expect(formatCatalogAmount('12.3456',{state:'PRESENT',value:'USD'})).toBe('12,3456 USD')
 expect(formatCatalogAmount('12',{state:'CONFLICT',value:null})).toContain('moeda divergente')
 expect(formatCatalogAmount('12',{state:'CONFLICT',value:null})).not.toContain('€')
})
