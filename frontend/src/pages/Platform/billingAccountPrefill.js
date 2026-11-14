// Correspondence between the entity profile (ficha) and the billing account.
// The profile only suggests: nothing here writes, and the account stays the
// versioned source for what is invoiced.
export const accountLabels = { legalName: 'Denominação legal', taxIdentifier: 'NIF / identificação fiscal', addressLine1: 'Morada', addressLine2: 'Complemento', postalCode: 'Código postal', locality: 'Localidade', billingEmail: 'Email de faturação', contactName: 'Contacto' }
// Limits of the billing account contract (backend/src/platformBilling/contracts.js).
export const accountLimits = { legalName: 200, taxIdentifier: 32, addressLine1: 200, addressLine2: 200, postalCode: 32, locality: 120, billingEmail: 254, contactName: 160 }
// Same meaning in both records.
const equivalent = [['taxIdentifier', 'nif'], ['addressLine1', 'address'], ['addressLine2', 'addressComplement'], ['postalCode', 'postalCode'], ['locality', 'locality']]
// Plausible starting values only: the billing email and contact may differ.
const tentative = [['billingEmail', 'institutionalEmail'], ['contactName', 'responsibleName']]
const text = value => typeof value === 'string' ? value.trim() : ''
const usable = registration => Boolean(registration?.complete && text(registration.fields?.nif))

export function profileSuggestions(registration) {
  if (!usable(registration)) return null
  const values = {}, fromProfile = [], suggested = []
  for (const [list, pairs] of [[fromProfile, equivalent], [suggested, tentative]]) for (const [field, source] of pairs) {
    const value = text(registration.fields[source])
    if (value) { values[field] = value; list.push(field) }
  }
  return { values, fromProfile, suggested }
}

export function profileDifferences(version, registration, organizationLegalName) {
  if (!version || !usable(registration)) return []
  const expected = [['legalName', text(organizationLegalName)], ...(version.taxCountry === 'PT' ? equivalent : equivalent.slice(1)).map(([field, source]) => [field, text(registration.fields[source])])]
  return expected.filter(([field, value]) => (field !== 'legalName' || value) && text(version[field]) !== value)
    .map(([field, value]) => ({ field, label: accountLabels[field], account: text(version[field]), profile: value }))
}

export const overLimit = form => Object.keys(accountLimits).filter(field => String(form[field] ?? '').length > accountLimits[field])
