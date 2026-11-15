import React from 'react'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import EntityProfileCard from './EntityProfileCard'
afterEach(cleanup)
const organization={id:'org',legalName:'C4G Staging',name:'C4G Staging',typeCode:'UNSPECIFIED'}
it('changes an undefined type without completing the profile',async()=>{
 const onSave=vi.fn(),onSaveType=vi.fn().mockResolvedValue({fields:{typeCode:'CONSULTANCY'},revision:0,complete:false})
 render(<EntityProfileCard organization={organization} canEdit onSave={onSave} onSaveType={onSaveType}/> )
 expect(screen.getByText('Por definir')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Alterar tipo'}))
 fireEvent.change(screen.getByLabelText('Tipo de entidade'),{target:{value:'CONSULTANCY'}})
 fireEvent.click(screen.getByRole('button',{name:'Guardar tipo'}))
 await waitFor(()=>expect(onSaveType).toHaveBeenCalledWith({expectedRevision:0,expectedTypeCode:'UNSPECIFIED',typeCode:'CONSULTANCY',requestId:expect.any(String)}))
 await screen.findByText('Tipo atualizado.')
 expect(screen.getByText('Consultoria')).toBeTruthy()
 expect(screen.getByText('Por completar')).toBeTruthy()
 expect(onSave).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Preencher ficha'}))
 expect(screen.getByRole('button',{name:'Guardar ficha'}).disabled).toBe(false)
})
it('hides type editing without permission',()=>{
 render(<EntityProfileCard organization={organization} canEdit={false} onSaveType={vi.fn()}/> )
 expect(screen.queryByRole('button',{name:'Alterar tipo'})).toBeNull()
})
it('retries the exact command after an uncertain response',async()=>{
 const onSaveType=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({fields:{typeCode:'COMPANY'},revision:1})
 render(<EntityProfileCard organization={organization} canEdit onSaveType={onSaveType}/> )
 fireEvent.click(screen.getByRole('button',{name:'Alterar tipo'}))
 fireEvent.change(screen.getByLabelText('Tipo de entidade'),{target:{value:'COMPANY'}})
 fireEvent.click(screen.getByRole('button',{name:'Guardar tipo'}))
 fireEvent.click(await screen.findByRole('button',{name:'Repetir o mesmo envio'}))
 await screen.findByText('Tipo atualizado.')
 expect(onSaveType.mock.calls[0][0]).toEqual(onSaveType.mock.calls[1][0])
})
