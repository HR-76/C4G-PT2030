import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LogoutResult from '../pages/LogoutResult'
import { clearLogoutResult, saveLogoutResult, readLogoutResult, logoutPageState } from '../api/logoutResult'
import App from '../App'
import { authApi } from '../api/api'
afterEach(()=>{cleanup();clearLogoutResult();vi.restoreAllMocks()})
it.each(['complete','incomplete','unknown'])('shows explicit reentry without auto login (%s)',status=>{
 render(<LogoutResult status={status}/>);
 const link=screen.getByRole('link',{name:'Voltar a entrar'});
 expect(link.getAttribute('href')).toBe('/api/auth/oidc/login?returnTo=%2F')
 if(status==='incomplete')expect(screen.getByText(/selecione «Sair» novamente/)).toBeTruthy()
 if(status!=='complete')expect(screen.queryByText('Saída concluída')).toBeNull()
})
it('intercepts the federated return before session lookup, including during server outage',()=>{
 saveLogoutResult('incomplete');const me=vi.spyOn(authApi,'me');
 render(<MemoryRouter initialEntries={['/login']}><App/></MemoryRouter>);
 expect(screen.getByRole('heading',{name:'Saída incompleta'})).toBeTruthy();expect(me).not.toHaveBeenCalled()
})
it('never infers completion from a URL and expires presentation receipts',()=>{
 expect(logoutPageState('/saida','?logout=complete')).toBe('unknown')
 expect(logoutPageState('/login','?logout=complete')).toBeNull()
 saveLogoutResult('complete');expect(logoutPageState('/login')).toBe('complete')
 const time=Date.now();vi.spyOn(Date,'now').mockReturnValue(time+600001)
 expect(readLogoutResult()).toBeNull();expect(logoutPageState('/saida')).toBe('unknown')
})
it('clears the result only on explicit reentry and never blocks logout when storage is unavailable',()=>{
 saveLogoutResult('complete');render(<LogoutResult status="complete"/>);
 const link=screen.getByRole('link',{name:'Voltar a entrar'});link.addEventListener('click',event=>event.preventDefault());fireEvent.click(link);expect(readLogoutResult()).toBeNull()
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked')});expect(()=>saveLogoutResult('incomplete')).not.toThrow()
})
