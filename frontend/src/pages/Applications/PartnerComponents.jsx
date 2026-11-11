import { Pencil, Trash2, UserPlus } from 'lucide-react'
export const EMPTY_PARTNER = {
  entity_name: '',
  country: '',
  research_area_interest: '',
  responsible_person: '',
  contact: '',
  email: '',
  people: [],
}

const EMPTY_PARTNER_PERSON = {
  name: '',
  role: 'OUTRO',
  research_area: '',
  contact: '',
  email: '',
}

const PARTNER_PERSON_ROLE_LABELS = {
  RESPONSAVEL: 'Responsável',
  INVESTIGADOR: 'Investigador',
  OUTRO: 'Outro',
}


function DL({label,value}) { return value ? <div className="dl-row"><dt>{label}</dt><dd>{value}</dd></div> : null }
export function PartnerForm({ form, saving, editing, onChange, onCancel, onSubmit }) {
  const set = (key, value) => onChange({ ...form, [key]: value })
  const people = form.people || []
  const setPerson = (index, key, value) => {
    onChange({
      ...form,
      people: people.map((person, i) => i === index ? { ...person, [key]: value } : person),
    })
  }
  const addPerson = () => people.length<50&&onChange({ ...form, people: [...people, { ...EMPTY_PARTNER_PERSON }] })
  const removePerson = index => onChange({ ...form, people: people.filter((_, i) => i !== index) })

  return (
    <form className="edit-form partner-form" onSubmit={onSubmit}>
      <div className="field-grid">
        <div className="field">
          <label>Nome da entidade *<input aria-label="Nome da entidade *" type="text" maxLength={200} value={form.entity_name} onChange={e => set('entity_name', e.target.value)} required /></label>
        </div>
        <div className="field">
          <label>País<input aria-label="País" type="text" maxLength={100} value={form.country} onChange={e => set('country', e.target.value)} /></label>
        </div>
        <div className="field field-full">
          <label>Área de investigação / Interesse no projeto<textarea aria-label="Área de investigação / Interesse no projeto" maxLength={2000} rows={2} value={form.research_area_interest} onChange={e => set('research_area_interest', e.target.value)} /></label>
        </div>
        <div className="field">
          <label>Pessoa responsável<input aria-label="Pessoa responsável" type="text" maxLength={200} value={form.responsible_person} onChange={e => set('responsible_person', e.target.value)} /></label>
        </div>
        <div className="field">
          <label>Contacto<input aria-label="Contacto" type="text" maxLength={200} value={form.contact} onChange={e => set('contact', e.target.value)} /></label>
        </div>
        <div className="field">
          <label>Email<input aria-label="Email" type="email" maxLength={254} value={form.email} onChange={e => set('email', e.target.value)} /></label>
        </div>
      </div>

      <div className="partner-people-form">
        <div className="subsection-head">
          <h3>Pessoas afetas ao parceiro</h3>
          <button type="button" className="btn btn-outline btn-sm" onClick={addPerson} disabled={saving||people.length>=50}>
            <UserPlus size={14} /> Adicionar pessoa
          </button>
        </div>

        {people.length>=50&&<p role="status">Limite de 50 pessoas por parceiro atingido.</p>}
        {people.length > 0 ? (
          <div className="partner-person-list">
            {people.map((person, index) => (
              <div key={index} className="partner-person-row">
                <div className="field">
                  <label>Nome *<input aria-label="Nome *" type="text" required maxLength={200} value={person.name} onChange={e => setPerson(index, 'name', e.target.value)} /></label>
                </div>
                <div className="field">
                  <label>Papel<select aria-label="Papel" value={person.role || 'OUTRO'} onChange={e => setPerson(index, 'role', e.target.value)}>
                    <option value="RESPONSAVEL">Responsável</option>
                    <option value="INVESTIGADOR">Investigador</option>
                    <option value="OUTRO">Outro</option>
                  </select></label>
                </div>
                <div className="field">
                  <label>Área<input aria-label="Área" type="text" maxLength={2000} value={person.research_area || ''} onChange={e => setPerson(index, 'research_area', e.target.value)} /></label>
                </div>
                <div className="field">
                  <label>Contacto<input aria-label="Contacto" type="text" maxLength={200} value={person.contact || ''} onChange={e => setPerson(index, 'contact', e.target.value)} /></label>
                </div>
                <div className="field">
                  <label>Email<input aria-label="Email" type="email" maxLength={254} value={person.email || ''} onChange={e => setPerson(index, 'email', e.target.value)} /></label>
                </div>
                <button type="button" className="btn btn-danger btn-sm btn-icon partner-person-remove" onClick={() => removePerson(index)} title="Remover pessoa" aria-label="Remover pessoa">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-row">Ainda não há pessoas adicionadas a este parceiro.</div>
        )}
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Fechar e continuar depois</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'A guardar...' : editing ? 'Guardar parceiro' : 'Adicionar parceiro'}
        </button>
      </div>
    </form>
  )
}

export function PartnerCards({partners,canEditPartners,editPartner,removePartner}) { return (
          <div className="partner-grid">
            {partners.map(partner => (
              <article key={partner.id} className="partner-card">
                <div className="partner-card-hd">
                  <div>
                    <div className="partner-name">{partner.entity_name}</div>
                    <div className="partner-country">{partner.country || 'País não indicado'}</div>
                  </div>
                  {canEditPartners && (
                    <div className="partner-actions">
                      <button className="btn-icon" onClick={() => editPartner(partner)} title="Editar">
                        <Pencil size={14} />
                      </button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => removePartner(partner.id)} title="Remover" aria-label="Remover">
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
                <dl className="partner-dl">
                  <DL label="Interesse" value={partner.research_area_interest} />
                  <DL label="Responsável" value={partner.responsible_person} />
                  <DL label="Contacto" value={partner.contact} />
                  <DL label="Email" value={partner.email} />
                </dl>
                {partner.people?.length > 0 && (
                  <div className="partner-people">
                    <div className="partner-people-title">Pessoas afetas</div>
                    {partner.people.map(person => (
                      <div key={person.id || `${person.name}-${person.role}`} className="partner-person-card">
                        <div>
                          <div className="partner-person-name">{person.name}</div>
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            {PARTNER_PERSON_ROLE_LABELS[person.role] || person.role}
                            {person.research_area ? ` - ${person.research_area}` : ''}
                          </div>
                        </div>
                        {(person.contact || person.email) && (
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            {[person.contact, person.email].filter(Boolean).join(' | ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
) }
