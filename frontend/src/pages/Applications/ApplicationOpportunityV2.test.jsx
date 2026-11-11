import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ApplicationOpportunityContext } from './ApplicationPresentation'
import eu from '../../../../context/references/opportunity-v2/examples/eu-11145.json'
import plan from '../../../../context/references/opportunity-v2/examples/pt2030-8614.json'
afterEach(cleanup)
function record(snapshot) {
 const { identity, sourceRecords, provenance, quality, schemaVersion, contractVersion, ...projection } = snapshot
 return { snapshot, readModel: { version:'opportunity-read-v2.0',sourceVersion:2,identity,sourceRecords,projection,
  temporal:{effectiveState:snapshot.publication.value==='PLANNED'?'PLANNED':'OPEN',nextDeadline:snapshot.schedule.deadlines.value?.[0]||null,finalDeadline:snapshot.schedule.deadlines.value?.at(-1)||null,nextDeadlineCandidates:[]} } }
}
it('application context displays the source title and exact confirmed UTC cutoff from the common model',()=>{
 render(<ApplicationOpportunityContext opportunity={record(eu)}/>)
 expect(screen.getByText('Gnomon Internships Offer')).toBeTruthy()
 expect(screen.getByText(/Prazo oficial:/).textContent).toContain('UTC')
 expect(screen.getByRole('link',{name:'Fonte oficial'}).href).toContain('/11145')
})
it('application context labels a forecast as planned and never calls it an official deadline',()=>{
 render(<ApplicationOpportunityContext opportunity={record(plan)}/>)
 expect(screen.getByText(/Fecho previsto:/)).toBeTruthy()
 expect(screen.queryByText(/Prazo oficial:/)).toBeNull()
 expect(screen.getByText(plan.description.title.value)).toBeTruthy()
})
