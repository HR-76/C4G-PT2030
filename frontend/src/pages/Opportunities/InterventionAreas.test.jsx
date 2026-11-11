import React from 'react'
import {afterEach,expect,it} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {OpportunityTable,OpportunityOverview} from './OpportunityPresentation'
afterEach(cleanup)
it('replaces the central description column with intervention areas and preserves the full detail',()=>{
 const item={opportunityId:'one',title:'Digitalização',interventionClassification:{status:'CLASSIFIED',areas:[{code:'DIGITAL',label:'Digital',evidence:[]}]}};
 const view=render(<MemoryRouter><OpportunityTable central showApplications={false} items={[item]}/></MemoryRouter>);
 screen.getByRole('columnheader',{name:'Áreas de intervenção'});screen.getByText('Digital');
 expect(screen.queryByRole('columnheader',{name:'Descrição da call'})).toBeNull();expect(screen.queryByRole('columnheader',{name:'Áreas',exact:true})).toBeNull();view.unmount();
 render(<MemoryRouter><OpportunityOverview central fields={{title:'Digitalização',summary:'Descrição integral preservada'}} interventionClassification={item.interventionClassification}/></MemoryRouter>);
 screen.getByText('Descrição integral preservada');expect(screen.getAllByText('Digital').length).toBeGreaterThan(0);
});
it('shows Por classificar instead of inventing an area',()=>{
 render(<MemoryRouter><OpportunityTable central showApplications={false} items={[{opportunityId:'unknown',title:'Aviso sem informação',interventionClassification:{status:'UNCLASSIFIED',areas:[]}}]}/></MemoryRouter>);
 screen.getByText('Por classificar');
});
