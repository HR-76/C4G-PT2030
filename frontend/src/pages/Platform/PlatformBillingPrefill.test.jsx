import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingView } from './PlatformBilling'
import { profileDifferences, profileSuggestions } from './billingAccountPrefill'

afterEach(cleanup)

const response = data => Promise.resolve({ data })
const organization = { id: '11111111-1111-4111-8111-111111111111', name: 'Empresa Norte', legalName: 'Empresa Norte, Lda.' }
const fields = { nif: '501234567', address: 'Rua da Ficha, 10', addressComplement: '2.º Esq.', postalCode: '4000-200', locality: 'Porto', institutionalEmail: 'geral@example.pt', responsibleName: 'Ana Responsável' }
const profile = { organization, registration: { fields, revision: 2, complete: true } }
const accountEmpty = { organizationId: organization.id, organizationName: organization.name, organizationLegalName: organization.legalName, organizationStatus: 'ACTIVE', account: null }
const version = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', legalName: organization.legalName, taxCountry: 'PT', taxIdentifier: '501234567', addressLine1: 'Rua Antiga, 1', addressLine2: '2.º Esq.', postalCode: '4000-200', locality: 'Porto', region: null, billingEmail: 'financeiro@example.pt', contactName: null, externalSource: null, externalCustomerRef: null, paymentTermsDays: 45, notes: null }
const accountReady = { ...accountEmpty, account: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1, currentVersion: 1, version } }

function billingApi(account) {
  return { summary: vi.fn(() => response({ currencies: [] })), cycles: vi.fn(() => response({ items: [], total: 0, page: 1, pageSize: 25 })), account: vi.fn(() => response(account)), accountWrite: vi.fn(() => response({ revision: 1 })) }
}
async function open(api, entityProfile) {
  const directoryApi = { entities: vi.fn(() => response({ items: [organization] })), entityProfile }
  render(<MemoryRouter initialEntries={['/administracao/faturacao']}><Routes><Route path="/administracao/faturacao" element={<BillingView api={api} directoryApi={directoryApi}/>}/></Routes></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar faturação' }))
  fireEvent.change(await screen.findByLabelText('Entidade'), { target: { value: organization.id } })
  return directoryApi
}

describe('pré-preenchimento da conta de faturação', () => {
  it('abre o formulário com os dados da ficha e assinala as sugestões', async () => {
    const api = billingApi(accountEmpty), directoryApi = await open(api, vi.fn(() => response(profile)))
    await screen.findByRole('group', { name: 'Configurar conta de faturação' })
    expect(directoryApi.entityProfile).toHaveBeenCalledWith(organization.id)
    expect(screen.getByLabelText('NIF / identificação fiscal').value).toBe('501234567')
    expect(screen.getByLabelText('Morada').value).toBe('Rua da Ficha, 10')
    expect(screen.getByLabelText('Complemento').value).toBe('2.º Esq.')
    expect(screen.getByLabelText('Código postal').value).toBe('4000-200')
    expect(screen.getByLabelText('Localidade').value).toBe('Porto')
    expect(screen.getByLabelText('Email de faturação').value).toBe('geral@example.pt')
    expect(screen.getByLabelText('Contacto').value).toBe('Ana Responsável')
    const note = screen.getByTestId('billing-profile-note').textContent
    expect(note).toContain('ficha da entidade'); expect(note).toContain('Email de faturação'); expect(note).toContain('Contacto')
    expect(api.accountWrite).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dados de faturação' }))
    await waitFor(() => expect(api.accountWrite).toHaveBeenCalledOnce())
    expect(api.accountWrite.mock.calls[0][1]).toMatchObject({ expectedRevision: 0, taxIdentifier: '501234567', addressLine1: 'Rua da Ficha, 10', addressLine2: '2.º Esq.', postalCode: '4000-200', locality: 'Porto', billingEmail: 'geral@example.pt', contactName: 'Ana Responsável', paymentTermsDays: 30 })
  })

  it('abre como antes quando a ficha está incompleta ou não pôde ser consultada', async () => {
    await open(billingApi(accountEmpty), vi.fn(() => response({ organization, registration: { fields: {}, revision: 0, complete: false } })))
    await screen.findByRole('group', { name: 'Configurar conta de faturação' })
    expect(screen.getByLabelText('Denominação legal').value).toBe(organization.legalName)
    expect(screen.getByLabelText('Morada').value).toBe('')
    expect(screen.queryByTestId('billing-profile-note')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    await open(billingApi(accountEmpty), vi.fn(() => Promise.reject({ response: { status: 503 } })))
    await screen.findByRole('group', { name: 'Configurar conta de faturação' })
    expect(screen.getByLabelText('Morada').value).toBe('')
    expect(screen.getByText(/Não foi possível consultar a ficha da entidade/)).toBeTruthy()
  })

  it('não trunca valores acima do limite da conta e impede guardar até serem corrigidos', async () => {
    const long = 'R'.repeat(230), api = billingApi(accountEmpty)
    await open(api, vi.fn(() => response({ ...profile, registration: { ...profile.registration, fields: { ...fields, address: long } } })))
    await screen.findByRole('group', { name: 'Configurar conta de faturação' })
    expect(screen.getByLabelText('Morada').value).toBe(long)
    expect(screen.getByRole('alert').textContent).toContain('Morada')
    expect(screen.getByRole('button', { name: 'Guardar dados de faturação' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Morada'), { target: { value: 'Rua curta' } })
    expect(screen.getByRole('button', { name: 'Guardar dados de faturação' }).disabled).toBe(false)
  })

  it('avisa quando a conta existente difere da ficha e só aplica os valores a pedido', async () => {
    const api = billingApi(accountReady); await open(api, vi.fn(() => response(profile)))
    expect((await screen.findByTestId('billing-profile-difference')).textContent).toContain('Morada')
    expect(screen.getByText('Rua Antiga, 1', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rever diferenças' }))
    await screen.findByRole('group', { name: 'Editar dados de faturação' })
    expect(screen.getByLabelText('Morada').value).toBe('Rua Antiga, 1')
    expect(screen.getByLabelText('Email de faturação').value).toBe('financeiro@example.pt')
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar valores da ficha' }))
    expect(screen.getByLabelText('Morada').value).toBe('Rua da Ficha, 10')
    expect(screen.getByLabelText('Email de faturação').value).toBe('financeiro@example.pt')
    expect(screen.getByLabelText('Prazo de pagamento (dias)').value).toBe('45')
    expect(screen.queryByTestId('billing-profile-difference')).toBeNull()
    expect(api.accountWrite).not.toHaveBeenCalled()
  })

  it('não avisa quando conta e ficha coincidem', async () => {
    await open(billingApi({ ...accountReady, account: { ...accountReady.account, version: { ...version, addressLine1: 'Rua da Ficha, 10' } } }), vi.fn(() => response(profile)))
    await screen.findByRole('group', { name: 'Novo ciclo' })
    expect(screen.queryByTestId('billing-profile-difference')).toBeNull()
  })
})

describe('regras de correspondência entre ficha e conta', () => {
  it('ignora fichas sem NIF confirmado e não compara email nem contacto', () => {
    expect(profileSuggestions({ fields: { address: 'Rua' }, complete: false })).toBeNull()
    expect(profileSuggestions(null)).toBeNull()
    expect(profileDifferences(version, { fields: { address: 'Outra' }, complete: false }, organization.legalName)).toEqual([])
    const same = { ...version, addressLine1: fields.address }
    expect(profileDifferences(same, profile.registration, organization.legalName)).toEqual([])
    expect(profileDifferences(same, profile.registration, 'Outra Denominação, S.A.').map(item => item.field)).toEqual(['legalName'])
    expect(profileDifferences({ ...same, addressLine2: null }, profile.registration, organization.legalName).map(item => item.field)).toEqual(['addressLine2'])
  })
})
