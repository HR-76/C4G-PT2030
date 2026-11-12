// Temporary visual harness: real screens, simulated API. Not part of the app.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BillingView } from './pages/Platform/PlatformBilling'
import { CustomerBillingView } from './pages/Billing/CustomerBilling'
import './index.css'
import './c4g-shell.css'
import './c4g-surfaces.css'
import './c4g-foundations.css'
import './icon-tones.css'

const view = new URLSearchParams(location.search).get('view') || 'admin-new'
const response = data => Promise.resolve({ data })
const organization = { id: '11111111-1111-4111-8111-111111111111', name: 'Empresa Norte', legalName: 'Empresa Norte, Lda.' }
const fields = { nif: '501234567', address: view === 'admin-long' ? 'Avenida '.repeat(30) : 'Rua da Ficha, 10', addressComplement: '2.º Esq.', postalCode: '4000-200', locality: 'Porto', institutionalEmail: 'geral@example.pt', responsibleName: 'Ana Responsável' }
const registration = { fields, revision: 2, complete: true }
const version = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', legalName: organization.legalName, taxCountry: 'PT', taxIdentifier: '501234567', addressLine1: 'Rua Antiga, 1', addressLine2: null, postalCode: '4000-200', locality: 'Maia', region: null, billingEmail: 'financeiro@example.pt', contactName: 'Rui Contacto', externalSource: null, externalCustomerRef: null, paymentTermsDays: 45, notes: null }
const empty = { organizationId: organization.id, organizationName: organization.name, organizationLegalName: organization.legalName, organizationStatus: 'ACTIVE', account: null }
const ready = { ...empty, account: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1, currentVersion: 1, version } }
const adminApi = { summary: () => response({ currencies: [] }), cycles: () => response({ items: [], total: 0, page: 1, pageSize: 25 }), account: () => response(view === 'admin-diff' ? ready : empty), accountWrite: () => response({ revision: 1 }) }
const adminDirectory = { entities: () => response({ items: [organization] }), entityProfile: () => view === 'admin-failed' ? Promise.reject(new Error('x')) : response({ organization, registration }) }
const row = { cycleId: 'cycle', number: 'FT 2026/1', serviceDescription: 'Subscrição', periodStart: '2026-01-01', periodEnd: '2026-12-31', issueDate: '2026-10-01', dueDate: '2026-11-01', currency: 'EUR', total: '1000', paidAmount: '700', balanceAmount: '300', paymentState: 'PARTIALLY_PAID', documentState: 'ISSUED', overdue: true }
const { id, version: _version, externalSource, externalCustomerRef, paymentTermsDays, notes, ...customerAccount } = version
void [id, _version, externalSource, externalCustomerRef, paymentTermsDays, notes]
const customerApi = { invoices: () => response({ items: [row], total: 1, page: 1, pageSize: 25 }), summary: () => response({ currencies: [{ currency: 'EUR', billedAmount: '1000', paidAmount: '700', balanceAmount: '300', overdueAmount: '300' }] }), account: () => view === 'client-failed' ? Promise.reject(new Error('x')) : response({ account: view === 'client-empty' ? null : customerAccount, origin: 'MANUAL_C4G' }) }
const customerDirectory = { context: () => response(view === 'client-diff' ? { organization, registration } : { organization, registration: { ...registration, fields: { ...fields, address: 'Rua Antiga, 1', addressComplement: '', locality: 'Maia' } } }) }

ReactDOM.createRoot(document.getElementById('root')).render(
  <div style={{ padding: 24 }}><MemoryRouter initialEntries={[view.startsWith('admin') ? '/administracao/faturacao' : '/faturacao']}><Routes>
    <Route path="/administracao/faturacao" element={<BillingView api={adminApi} directoryApi={adminDirectory}/>}/>
    <Route path="/faturacao" element={<CustomerBillingView organizationId="org" api={customerApi} directoryApi={customerDirectory}/>}/>
  </Routes></MemoryRouter></div>
)
