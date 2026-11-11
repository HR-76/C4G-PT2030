import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Sidebar from '../../components/Layout/Sidebar'

const auth={user:{name:'Admin',platformRoles:['C4G_ADMIN']},organization:null,logout:vi.fn(),isAdmin:true}
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>auth}))
afterEach(cleanup)

describe('navegação de faturação',()=>{
 beforeEach(()=>{auth.user={name:'Admin',platformRoles:['C4G_ADMIN']};auth.organization=null})
 it('usa caminhos JSX explícitos e com o casing real nos imports lazy',()=>{const source=fs.readFileSync(path.resolve(process.cwd(),'src/App.jsx'),'utf8');expect(source).toContain("import('./pages/Platform/PlatformBilling.jsx')");expect(source).toContain("import('./pages/Platform/PlatformBillingDetail.jsx')");expect(source).not.toContain("import('./pages/Platform/platformBilling.js')")})
 it('mostra Faturação ao administrador C4G mesmo sem organização selecionada',()=>{render(<MemoryRouter><Sidebar open mobile={false} onClose={()=>{}}/></MemoryRouter>);expect(screen.getByRole('link',{name:'Faturação'}).getAttribute('href')).toBe('/administracao/faturacao')})
 it('não expõe Faturação a um membro de entidade',()=>{auth.user={name:'Membro',platformRoles:[]};auth.organization={id:'org'};render(<MemoryRouter><Sidebar open mobile={false} onClose={()=>{}}/></MemoryRouter>);expect(screen.queryByRole('link',{name:'Faturação'})).toBeNull()})
})

