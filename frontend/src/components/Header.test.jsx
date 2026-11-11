import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const auth=vi.hoisted(()=>({user:{id:'u',name:'Ana',platformRoles:[]},organization:{id:'org',name:'Entidade',profileLabel:'Gestor'},logout:vi.fn()}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>auth}))
vi.mock('../api/api',()=>({organizationNotificationsApi:{list:vi.fn(()=>Promise.resolve({data:{unread_count:0}})),refreshList:vi.fn(()=>Promise.resolve({data:{unread_count:0}}))}}))
import Header from './Layout/Header'
afterEach(cleanup)
function mount(){return render(<MemoryRouter><Header title="Dashboard" onMenuToggle={()=>{}} /></MemoryRouter>)}
it('offers account links, alert and logout',()=>{mount();fireEvent.click(screen.getByLabelText('Menu de perfil'));expect(screen.getByText('Ana')).toBeTruthy();expect(screen.getByRole('link',{name:'Perfil pessoal'}).getAttribute('href')).toBe('/perfil');expect(screen.getByRole('link',{name:/Alertas/})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Sair'}));expect(auth.logout).toHaveBeenCalled()})
it('searches context pages without exposing customer billing',()=>{HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};mount();fireEvent.click(screen.getByRole('button',{name:'Pesquisar páginas'}));fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar páginas'}),{target:{value:'candidaturas'}});expect(screen.getByRole('link',{name:'Candidaturas'}).getAttribute('href')).toBe('/candidaturas');fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar páginas'}),{target:{value:'faturação'}});expect(screen.getByText('Nenhuma página encontrada.')).toBeTruthy()})


it('closes search with Escape while its search field contains text and restores the opener',()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true}
 HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'))}
 mount();const opener=screen.getByRole('button',{name:'Pesquisar páginas'});fireEvent.click(opener)
 const dialog=screen.getByRole('dialog',{name:'Pesquisar páginas'}),input=screen.getByRole('searchbox',{name:'Pesquisar páginas'})
 fireEvent.change(input,{target:{value:'teste'}});fireEvent.keyDown(input,{key:'Escape'})
 expect(dialog.open).toBe(false);expect(document.activeElement).toBe(opener)
})

it('keeps platform source administration out of organization page search',()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true}
 HTMLDialogElement.prototype.close=function(){this.open=false}
 mount();fireEvent.click(screen.getByRole('button',{name:'Pesquisar páginas'}))
 fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar páginas'}),{target:{value:'Fontes'}})
 expect(screen.getByText('Nenhuma página encontrada.')).toBeTruthy()
})
