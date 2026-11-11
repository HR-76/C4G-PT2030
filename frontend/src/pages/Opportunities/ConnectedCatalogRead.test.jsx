import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ConnectedCatalogRead, { CatalogReadEntry } from './ConnectedCatalogRead'
import { catalogReadApi } from '../../api/api'
vi.mock('../../api/api', () => ({ catalogReadApi: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, organization: { id: 'o' } }) }))
vi.mock('./CatalogReadWorkspace', () => ({ default: ({ basePath, isolated }) => <p>Leitor {basePath} {String(isolated)}</p> }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const allowed=()=>({version:'gcni-catalog-exposure/1.0',available:true,revision:1,validUntil:new Date(Date.now()+30000).toISOString()})
it('keeps the new entry absent on default OFF without replacing existing management',async()=>{
 catalogReadApi.mockRejectedValue({response:{status:503}})
 render(<MemoryRouter><p>Gestão atual</p><CatalogReadEntry scope="u:o" /></MemoryRouter>)
 await act(async()=>{await Promise.resolve()})
 expect(screen.getByText('Gestão atual')).toBeTruthy();expect(screen.queryByRole('link')).toBeNull();expect(screen.queryByRole('alert')).toBeNull()
})
it('shows the normal route only on valid server availability',async()=>{
 catalogReadApi.mockResolvedValue(allowed())
 render(<MemoryRouter><CatalogReadEntry scope="u:o" /></MemoryRouter>)
 expect((await screen.findByRole('link',{name:'Explorar catálogo unificado'})).getAttribute('href')).toBe('/catalogo/consulta')
})
it('keeps a return to management while direct access is refused',async()=>{
 catalogReadApi.mockRejectedValue({response:{status:403}})
 render(<MemoryRouter><ConnectedCatalogRead /></MemoryRouter>)
 expect(await screen.findByRole('heading',{name:'Catálogo temporariamente indisponível'})).toBeTruthy()
 expect(screen.getByRole('link',{name:/Gestão de oportunidades/}).getAttribute('href')).toBe('/catalogo')
 expect(screen.queryByText(/Leitor/)).toBeNull()
})
it('binds authorized workspace navigation to the new namespace',async()=>{
 catalogReadApi.mockResolvedValue(allowed())
 render(<MemoryRouter><ConnectedCatalogRead /></MemoryRouter>)
 expect(await screen.findByText('Leitor /catalogo/consulta false')).toBeTruthy()
})
