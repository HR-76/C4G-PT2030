import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './components/ToastProvider'
import CatalogExposureGate from './pages/Opportunities/CatalogExposureGate'
import CentralOpportunities from './pages/Opportunities/CentralOpportunities'
import './index.css'
import './c4g-shell.css'
import './c4g-surfaces.css'
function IsolatedRoutes(){const {loading,user,organization}=useAuth();if(loading)return <p role="status">A verificar sessão…</p>;if(!user)return <p role="alert">Sessão indisponível no ambiente isolado.</p>;const routes=<Routes><Route path="/catalogo" element={<CentralOpportunities/>}/><Route path="/catalogo/:id" element={<CentralOpportunities/>}/><Route path="/login" element={<p role="alert">Sessão terminada. Utilize a autenticação institucional na integração habitual.</p>}/><Route path="*" element={<Navigate to="/catalogo" replace/>}/></Routes>;return typeof __GCNI_CONTROLLED_REHEARSAL__!=='undefined' && __GCNI_CONTROLLED_REHEARSAL__?<CatalogExposureGate scope={`${user.id}:${organization?.id || ''}`}>{routes}</CatalogExposureGate>:routes}
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><ToastProvider><AuthProvider><IsolatedRoutes/></AuthProvider></ToastProvider></BrowserRouter></React.StrictMode>)
