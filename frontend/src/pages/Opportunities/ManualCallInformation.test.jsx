import React from 'react'
import {afterEach,expect,it} from 'vitest'
import {cleanup,render,screen,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import OpportunityReadModelOverview,{OpportunityReadModelDetails} from './OpportunityReadModelView'
import {readManualIntention,saveManualIntention} from './manualIntentions'

afterEach(()=>{cleanup();sessionStorage.clear()})
const information={geographySummary:'Portugal\nLocal: Coimbra',eligibleGroups:'PME\nEntidades de investigação',eligibilitySummary:'Plano de trabalhos\n<img src=x onerror=alert(1)>'}
const request={userId:'admin',requestId:'71300000-0000-4000-8000-000000000003',fields:{title:'Manual call',funderName:'Funder',...information}}
it('persists and recovers the complete command without changing paragraphs or request identity',()=>{
 saveManualIntention(request)
 expect(readManualIntention('admin')).toEqual(request)
 expect(readManualIntention('other')).toBeNull()
})
it.each([['geographySummary',2000],['eligibleGroups',4000],['eligibilitySummary',4000]])('accepts the limit and rejects excessive or non-text %s in recovery', (field,limit)=>{
 const command={...request,fields:{...request.fields,[field]:'x'.repeat(limit)}}
 saveManualIntention(command);expect(readManualIntention('admin')).toEqual(command)
 expect(()=>saveManualIntention({...command,fields:{...command.fields,[field]:'x'.repeat(limit+1)}})).toThrow()
 sessionStorage.setItem('c4g.central-manual.intention.v1:admin',JSON.stringify({...command,fields:{...command.fields,[field]:[]}}))
 expect(()=>readManualIntention('admin')).toThrow()
})
it('keeps the recovery whitelist closed and older commands valid',()=>{
 const legacy={...request,fields:{title:'Before the change',funderName:'Same funder'}}
 saveManualIntention(legacy);expect(readManualIntention('admin')).toEqual(legacy)
 expect(()=>saveManualIntention({...legacy,fields:{...legacy.fields,organizationId:'foreign'}})).toThrow()
})
it.each([false,true])('shows manual call information as literal multiline text in detail (compact=%s)',compact=>{
 const Component=compact?OpportunityReadModelDetails:OpportunityReadModelOverview
 render(<MemoryRouter><Component source="C4G_MANUAL" fields={{title:'Manual call',...information}}/></MemoryRouter>)
 const region=screen.getByRole('region',{name:'Destinatários e requisitos'})
 for(const [label,value] of Object.entries({'Geografia/Local':information.geographySummary,'Grupos elegíveis':information.eligibleGroups,'Requisitos aplicáveis à call':information.eligibilitySummary})){
  const body=within(region).getByText(label).nextElementSibling
  expect(body.textContent).toBe(value)
  expect(getComputedStyle(body).whiteSpace).toBe('pre-wrap')
 }
 expect(region.querySelector('img,script,input[type="checkbox"]')).toBeNull()
})
it('makes missing manual information explicit without changing imported eligibility semantics',()=>{
 const first=render(<MemoryRouter><OpportunityReadModelOverview source="C4G_MANUAL" fields={{title:'Old manual'}}/></MemoryRouter>)
 expect(within(screen.getByRole('region',{name:'Destinatários e requisitos'})).getAllByText('Não indicado')).toHaveLength(3)
 first.unmount()
 render(<MemoryRouter><OpportunityReadModelOverview source="PT2030" fields={{title:'Imported',eligibilitySummary:'Entidades públicas'}}/></MemoryRouter>)
 expect(screen.queryByRole('region',{name:'Destinatários e requisitos'})).toBeNull()
})
it('recognizes explicit new fields only when the source is absent or manual',()=>{
 const first=render(<MemoryRouter><OpportunityReadModelOverview fields={{title:'Manual fixture',...information}}/></MemoryRouter>)
 expect(screen.getByRole('region',{name:'Destinatários e requisitos'})).toBeTruthy();first.unmount()
 render(<MemoryRouter><OpportunityReadModelOverview source="PT2030" fields={{title:'Imported',...information}}/></MemoryRouter>)
 expect(screen.queryByRole('region',{name:'Destinatários e requisitos'})).toBeNull()
})
